/**
 * "THE AGENT IS WORKING ON IT" — derived from the server, never guessed.
 *
 * A task handed over is not a task finished, and until now nothing said so:
 * the sheet closed, the row sat in the queue, and whether anything was
 * happening was unknowable from the device that asked. This is the state
 * behind the banner that answers that.
 *
 * THE SIGNAL IS A PROTOCOL STATUS, `"working"`, set by a server that is
 * actually running an agent (see docs/protocol.md, *Annotations*). It is optional and
 * additive: a server that only stores annotations never sets it, the banner
 * never appears, and nothing else changes. The alternative — showing a
 * banner because THIS device pressed Send — would be a guess that survives
 * neither a reload nor a second device, and would keep claiming work was
 * happening long after an agent had died.
 *
 * Pure, so the wording and the counting are tested without a tree.
 */
import type { ServerAnnotation } from "./types";

/** The protocol status a server sets while an agent has the task. */
export const WORKING_STATUS = "working";

export interface AgentActivity {
  /** How many tasks the server says are being worked on right now. */
  count: number;
  /** The banner's line, already pluralised. Empty when nothing is working. */
  label: string;
  /**
   * The element of the single task in flight, when there is exactly one.
   */
  element?: string;
  /**
   * What that task asked for, in the words it was written in. The banner
   * leads with this: "PrimaryButton" says where the agent is, but not which
   * of the three tasks on that button it has.
   */
  task?: string;
  /** That task's id, so the banner can open it. */
  taskId?: string;
  /** What the agent says it is doing on it (`taskProgress`). */
  progress?: string;
}

/** Long enough for "Editing app/components/PrimaryButton.tsx", no longer. */
const PROGRESS_MAX = 120;

/**
 * The agent's latest step on a task, or undefined. Only while the task is
 * `working`: a step left on a finished task is history, not news, and a
 * server that forgets to clear it must not leave "Editing…" on screen.
 */
export function taskProgress(a: ServerAnnotation | null | undefined): string | undefined {
  if (!a || a.status !== WORKING_STATUS || typeof a.progress !== "string") return undefined;
  const line = a.progress.trim().replace(/\s+/g, " ");
  if (!line) return undefined;
  return line.length > PROGRESS_MAX ? `${line.slice(0, PROGRESS_MAX - 1)}…` : line;
}

const NONE: AgentActivity = { count: 0, label: "" };

/** What the banner should say, given the annotations the client has. */
export function agentActivity(annotations: readonly ServerAnnotation[] | null | undefined): AgentActivity {
  if (!annotations?.length) return NONE;
  const working = annotations.filter((a) => a?.status === WORKING_STATUS);
  if (working.length === 0) return NONE;

  if (working.length === 1) {
    const a = working[0]!;
    const element = typeof a.element === "string" ? a.element.trim() : "";
    const written = a.comment ?? a.content ?? a.text;
    const task = typeof written === "string" ? written.trim().replace(/\s+/g, " ") : "";
    const progress = taskProgress(a);
    const extra = {
      ...(typeof a.id === "string" ? { taskId: a.id } : {}),
      ...(progress ? { progress } : {}),
    };
    if (task) {
      return { count: 1, label: `Working on “${task}”`, task, ...(element ? { element } : {}), ...extra };
    }
    return element
      ? { count: 1, label: `Working on ${element}…`, element, ...extra }
      : { count: 1, label: "Working on your task…", ...extra };
  }
  return { count: working.length, label: `Working on ${working.length} tasks…` };
}

/** Screen readers get the same fact without the ellipsis's implied motion. */
export function agentActivityA11y(activity: AgentActivity): string {
  if (activity.count === 0) return "";
  if (activity.count === 1) {
    const now = activity.progress ? `. ${activity.progress}` : "";
    if (activity.task) return `The agent is working on: ${activity.task}${now}`;
    return activity.element ? `The agent is working on ${activity.element}` : "The agent is working on your task";
  }
  return `The agent is working on ${activity.count} tasks`;
}
