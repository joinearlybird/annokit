/**
 * Agent run history (src/runs.ts): read defensively, said in two short
 * lines, and the Done tab's list of finished tasks.
 */
import { describe, expect, it } from "vitest";
import { doneRow, doneTasks, isFinishedTask, readRuns, runDuration, runLines } from "../src/runs";
import type { ServerAnnotation } from "../src/types";

const RUN = {
  id: "r1",
  agent: { id: "codex", label: "Codex" },
  model: "gpt-5.6-terra",
  effort: "high",
  startedAt: "2026-10-28T10:00:00.000Z",
  finishedAt: "2026-10-28T10:01:40.000Z",
  outcome: "done",
  files: [{ path: "app/Button.tsx", added: 3, removed: 1 }, { path: "app/theme.ts" }],
  summary: "Made the button darker.",
};

describe("reading runs", () => {
  it("takes the documented shape, oldest first", () => {
    const later = { ...RUN, id: "r2", startedAt: "2026-10-28T11:00:00.000Z", finishedAt: undefined, outcome: "running" };
    const runs = readRuns([later, RUN]);
    expect(runs.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(runs[0]).toEqual(RUN);
  });

  it("drops what is not a run, and keeps going", () => {
    expect(readRuns(null)).toEqual([]);
    expect(readRuns("x")).toEqual([]);
    const runs = readRuns([
      7,
      { ...RUN, outcome: "exploded" },
      { ...RUN, agent: null },
      { ...RUN, startedAt: "" },
      { ...RUN, files: [{ path: "" }, { path: "ok.ts", added: "3" }] },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.files).toEqual([{ path: "ok.ts" }]);
  });
});

describe("saying a run", () => {
  it("says who ran it and how it went", () => {
    expect(runLines(readRuns([RUN])[0]!)).toEqual({ who: "Codex · gpt-5.6-terra · high", how: "Done · 2 files · 1m 40s", tone: "ok" });
  });

  it("leaves out what it does not know", () => {
    const [r] = readRuns([{ ...RUN, agent: { id: "claude" }, model: null, effort: null, files: [], finishedAt: undefined, outcome: "running" }]);
    expect(runLines(r!)).toEqual({ who: "claude", how: "Running", tone: "busy" });
    const [f] = readRuns([{ ...RUN, outcome: "failed", files: undefined }]);
    expect(runLines(f!).how).toBe("Failed · 1m 40s");
    expect(runLines(f!).tone).toBe("bad");
  });

  it("measures how long it took", () => {
    const at = (s: number) => new Date(Date.parse(RUN.startedAt) + s * 1000).toISOString();
    const d = (s: number) => runDuration({ ...readRuns([RUN])[0]!, finishedAt: at(s) });
    expect([d(12), d(60), d(100), d(7500)]).toEqual(["12s", "1m", "1m 40s", "2h 5m"]);
    expect(runDuration({ ...readRuns([RUN])[0]!, finishedAt: undefined })).toBeNull();
  });
});

describe("the Done tab", () => {
  const task = (id: string, status: string | undefined, extra: Partial<ServerAnnotation> = {}): ServerAnnotation => ({ id, status, ...extra });

  it("lists what has left the queue, not what is waiting or being worked on", () => {
    expect(isFinishedTask(task("a", "sent"))).toBe(true);
    expect(isFinishedTask(task("b", "resolved"))).toBe(true);
    expect(isFinishedTask(task("c", "pending"))).toBe(false);
    expect(isFinishedTask(task("d", "working"))).toBe(false);
    expect(isFinishedTask(task("e", undefined))).toBe(false);
  });

  it("puts the most recently finished first", () => {
    const list = doneTasks([
      task("old", "sent", { createdAt: "2026-10-28T09:00:00.000Z" }),
      task("queued", "pending", { createdAt: "2026-10-28T12:00:00.000Z" }),
      task("ran", "sent", { createdAt: "2026-10-28T08:00:00.000Z", runs: [RUN] }),
      task("updated", "resolved", { createdAt: "2026-10-28T07:00:00.000Z", updatedAt: "2026-10-28T11:00:00.000Z" }),
    ]);
    expect(list.map((t) => t.id)).toEqual(["updated", "ran", "old"]);
  });
});

describe("a Done row", () => {
  it("is the request and its last run", () => {
    const later = { ...RUN, id: "r2", startedAt: "2026-10-28T11:00:00.000Z", finishedAt: "2026-10-28T11:00:30.000Z", outcome: "failed", files: [] };
    expect(doneRow({ id: "t", comment: "  Darker  ", status: "sent", runs: [RUN, later] })).toEqual({
      id: "t", text: "Darker", who: "Codex · gpt-5.6-terra · high", how: "Failed · 30s", tone: "bad", runCount: 2,
      at: "2026-10-28T11:00:30.000Z",
    });
  });

  it("is the request and its status, from a server without history", () => {
    expect(doneRow({ id: "t", comment: "x", status: "resolved", createdAt: "2026-10-28T09:00:00.000Z" })).toEqual({
      id: "t", text: "x", how: "Resolved", tone: "muted", at: "2026-10-28T09:00:00.000Z",
    });
  });

  it("is only the request of a task made from a note", () => {
    const comment = "Remove the reset hint row\n\nFrom the discussion:\n\nDana: The hint row is noise";
    expect(doneRow({ id: "t", comment, status: "resolved" }).text).toBe("Remove the reset hint row");
    expect(doneRow({ id: "t", comment, status: "sent", runs: [{ ...RUN, title: "Removed the hint row" }] }).request).toBe(
      "Remove the reset hint row",
    );
  });
});

describe("the agent's title", () => {
  it("names the task in Done, with the request under it", () => {
    const titled = { ...RUN, title: "Darker primary button" };
    const failedAfter = {
      ...RUN, id: "r2", startedAt: "2026-10-28T11:00:00.000Z", finishedAt: "2026-10-28T11:00:30.000Z", outcome: "failed", files: [], title: undefined,
    };
    expect(doneRow({ id: "t", comment: "Make it darker", status: "sent", runs: [titled, failedAfter] })).toEqual(
      expect.objectContaining({ text: "Darker primary button", request: "Make it darker", how: "Failed · 30s" }),
    );
    expect(doneRow({ id: "t", comment: "Make it darker", status: "sent", runs: [RUN] }).request).toBeUndefined();
  });
});

describe("a continued run", () => {
  it("says it carried on from the run before", () => {
    expect(runLines(readRuns([{ ...RUN, resumed: true }])[0]!).how).toBe("Done · continued · 2 files · 1m 40s");
    expect(readRuns([{ ...RUN, resumed: "yes" }])[0]!.resumed).toBeUndefined();
  });
});
