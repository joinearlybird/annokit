/**
 * AGENT RUN HISTORY — every time an agent worked on a task, and how it went.
 *
 * A task can be run more than once: a reply refines it, the server re-runs
 * it, a failed run is tried again. Each run is one entry in the task's
 * `runs[]` (docs/protocol.md, *Run history*), appended by the server and
 * never rewritten once finished: which agent, model and effort, when it
 * started and stopped, how it ended, what it changed, and its one-line
 * summary. The thread still carries the agent's reply; this is the record
 * of the work behind it.
 *
 * Where it is read: the queue panel's **Done** tab lists the session's
 * finished tasks (they leave the pending list, so without it they left the
 * app), and a task's detail pane shows its runs above the thread.
 *
 * OPTIONAL, like the rest of the agent fields: a server that keeps no
 * history sends no `runs`, the detail pane shows none, and Done still lists
 * finished tasks by their status and reply. Pure; read defensively.
 */

import { splitTaskBody } from "./message-task";
import type { ServerAnnotation } from "./types";

export type RunOutcome = "running" | "done" | "failed" | "stopped";

export interface RunFile {
  path: string;
  added?: number;
  removed?: number;
}

export interface TaskRun {
  /** Unique within the task. */
  id: string;
  agent: { id: string; label?: string };
  /** Null: the agent's default model. */
  model?: string | null;
  effort?: string | null;
  startedAt: string;
  /** Absent while it runs. */
  finishedAt?: string;
  outcome: RunOutcome;
  /** What it changed, when the server can tell. */
  files?: RunFile[];
  /** The agent's own one-line account of what it did. */
  summary?: string;
  /** A few words naming the change, written by the agent: what Done calls the task. */
  title?: string;
  /** Why it failed or stopped, in one line. */
  error?: string;
  /** It continued the agent's own session from the run before, not a fresh start. */
  resumed?: boolean;
}

const OUTCOMES: readonly RunOutcome[] = ["running", "done", "failed", "stopped"];

const str = (v: unknown, max = 300): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/** A server's `runs`, as runs: anything malformed is dropped, oldest first. */
export function readRuns(raw: unknown): TaskRun[] {
  if (!Array.isArray(raw)) return [];
  const runs: TaskRun[] = [];
  for (const r of raw as unknown[]) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const a = o.agent as Record<string, unknown> | undefined;
    const agentId = a && typeof a === "object" ? str(a.id, 40) : undefined;
    const startedAt = str(o.startedAt, 40);
    const outcome = OUTCOMES.includes(o.outcome as RunOutcome) ? (o.outcome as RunOutcome) : undefined;
    if (!agentId || !startedAt || !outcome) continue;
    const files = Array.isArray(o.files)
      ? (o.files as unknown[]).flatMap((f) => {
          const ff = f as Record<string, unknown> | null;
          const path = ff && typeof ff === "object" ? str(ff.path, 300) : undefined;
          if (!path) return [];
          return [{
            path,
            ...(typeof ff!.added === "number" ? { added: ff!.added } : {}),
            ...(typeof ff!.removed === "number" ? { removed: ff!.removed } : {}),
          }];
        })
      : undefined;
    runs.push({
      id: str(o.id, 80) ?? `${startedAt}-${runs.length}`,
      agent: { id: agentId, ...(str(a!.label, 60) ? { label: str(a!.label, 60) } : {}) },
      ...(str(o.model, 200) ? { model: str(o.model, 200) } : {}),
      ...(str(o.effort, 20) ? { effort: str(o.effort, 20) } : {}),
      startedAt,
      ...(str(o.finishedAt, 40) ? { finishedAt: str(o.finishedAt, 40) } : {}),
      outcome,
      ...(files ? { files } : {}),
      ...(str(o.summary) ? { summary: str(o.summary) } : {}),
      ...(str(o.title, 60) ? { title: str(o.title, 60) } : {}),
      ...(o.resumed === true ? { resumed: true } : {}),
      ...(str(o.error) ? { error: str(o.error) } : {}),
    });
  }
  return runs.sort((x, y) => Date.parse(x.startedAt) - Date.parse(y.startedAt));
}

/** "1m 40s", "12s", "2h 5m"; null while running or when the times do not parse. */
export function runDuration(run: TaskRun): string | null {
  if (!run.finishedAt) return null;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

const OUTCOME_WORD: Record<RunOutcome, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/**
 * One run, in two lines: who ran it ("Codex · gpt-5.6-terra · high") and
 * how it went ("Done · 2 files · 1m 40s"). The tone colours the second.
 */
export function runLines(run: TaskRun): { who: string; how: string; tone: "ok" | "busy" | "bad" | "muted" } {
  const who = [run.agent.label ?? run.agent.id, run.model, run.effort].filter(Boolean).join(" · ");
  const files = run.files?.length ? `${run.files.length} file${run.files.length === 1 ? "" : "s"}` : null;
  const how = [OUTCOME_WORD[run.outcome], run.resumed ? "continued" : null, files, runDuration(run)].filter(Boolean).join(" · ");
  const tone = run.outcome === "done" ? "ok" : run.outcome === "running" ? "busy" : run.outcome === "failed" ? "bad" : "muted";
  return { who, how, tone };
}

/** Still the agent's or the queue's: what the Done tab leaves out. */
const UNFINISHED = new Set(["pending", "working"]);

/** A task that has left the queue for good (for now): sent, resolved, or the server's own word. */
export function isFinishedTask(a: ServerAnnotation): boolean {
  return typeof a.status === "string" && a.status !== "" && !UNFINISHED.has(a.status);
}

/** When a task last moved: its last run's end, else its last update, else its creation. */
function lastMoved(a: ServerAnnotation): number {
  const runs = readRuns(a.runs);
  const last = runs[runs.length - 1];
  const at = last?.finishedAt ?? last?.startedAt ?? a.updatedAt ?? a.createdAt;
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** The Done tab: finished tasks, most recently finished first. */
export function doneTasks(all: readonly ServerAnnotation[]): ServerAnnotation[] {
  return all.filter((a) => a && typeof a.id === "string" && isFinishedTask(a)).sort((x, y) => lastMoved(y) - lastMoved(x));
}

/** One Done row: the request, then its last run (or just its status), and when. */
export interface DoneRow {
  id: string;
  /** The agent's title for what it did, else the request. */
  text: string;
  /** The request, under a title; absent when `text` already is the request. */
  request?: string;
  /** "Codex · gpt-5.6-terra · high"; absent with no run history. */
  who?: string;
  /** "Done · 2 files · 1m 40s", or the status ("Sent") with no history. */
  how: string;
  tone: "ok" | "busy" | "bad" | "muted";
  /** How many runs, when more than one. */
  runCount?: number;
  /** ISO time it last moved, for the caller to format. */
  at?: string;
}

export function doneRow(a: ServerAnnotation): DoneRow {
  const value = a.comment ?? a.content ?? a.text;
  // The request alone, as in the queue: a note's quoted discussion is in the detail.
  const text = typeof value === "string" && value.trim() ? splitTaskBody(value).request : "(no change text)";
  const runs = readRuns(a.runs);
  const last = runs[runs.length - 1];
  const at = last?.finishedAt ?? last?.startedAt ?? a.updatedAt ?? a.createdAt;
  if (!last) {
    const status = a.status ? a.status.charAt(0).toUpperCase() + a.status.slice(1) : "Done";
    return { id: a.id, text, how: status, tone: "muted", ...(at ? { at } : {}) };
  }
  const { who, how, tone } = runLines(last);
  // The newest title any run gave: a failed re-run says nothing new about
  // what the task became.
  const title = [...runs].reverse().find((r) => r.title)?.title;
  return {
    id: a.id,
    text: title ?? text,
    ...(title ? { request: text } : {}),
    who,
    how,
    tone,
    ...(runs.length > 1 ? { runCount: runs.length } : {}),
    ...(at ? { at } : {}),
  };
}
