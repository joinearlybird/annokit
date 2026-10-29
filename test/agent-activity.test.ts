/**
 * What the "agent is working" banner says (src/agent-activity.ts). The
 * signal is a server-set status, never a guess about what this device did.
 */
import { describe, expect, it } from "vitest";
import { agentActivity, agentActivityA11y, taskProgress, WORKING_STATUS } from "../src/agent-activity";
import type { ServerAnnotation } from "../src/types";

const task = (over: Partial<ServerAnnotation> = {}): ServerAnnotation =>
  ({ id: "a1", status: "pending", ...over }) as ServerAnnotation;

describe("agentActivity", () => {
  it("says nothing when no task is being worked on", () => {
    expect(agentActivity([]).count).toBe(0);
    expect(agentActivity(null).label).toBe("");
    expect(agentActivity([task(), task({ status: "sent" })]).label).toBe("");
  });

  it("names the task in its own words when exactly one is in flight", () => {
    const a = agentActivity([
      task({ status: WORKING_STATUS, element: "PrimaryButton", comment: "  Make it\n blue " }),
    ]);
    expect(a).toEqual({
      count: 1,
      label: "Working on “Make it blue”",
      task: "Make it blue",
      element: "PrimaryButton",
      taskId: "a1",
    });
    expect(agentActivityA11y(a)).toBe("The agent is working on: Make it blue");
  });

  it("names the element when the task has no words", () => {
    const a = agentActivity([task({ status: WORKING_STATUS, element: "PrimaryButton" })]);
    expect(a).toEqual({ count: 1, label: "Working on PrimaryButton…", element: "PrimaryButton", taskId: "a1" });
  });

  it("falls back to a generic line when the task has no element", () => {
    // An area capture or a server that dropped the field: still say work is
    // happening rather than saying nothing at all.
    expect(agentActivity([task({ status: WORKING_STATUS })]).label).toBe("Working on your task…");
    expect(agentActivity([task({ status: WORKING_STATUS, element: "   " })]).label).toBe(
      "Working on your task…",
    );
  });

  it("counts when several are in flight, and ignores the ones that are not", () => {
    const a = agentActivity([
      task({ status: WORKING_STATUS, element: "A" }),
      task({ status: WORKING_STATUS, element: "B" }),
      task({ status: "pending" }),
      task({ status: "resolved" }),
    ]);
    expect(a.count).toBe(2);
    expect(a.label).toBe("Working on 2 tasks…");
    // No single element to name when there is more than one.
    expect(a.element).toBeUndefined();
  });

  it("survives a server that sends junk in place of annotations", () => {
    const junk = [null, undefined, {}, { status: 7 }] as unknown as ServerAnnotation[];
    expect(agentActivity(junk).count).toBe(0);
  });

  it("reads the same fact to a screen reader, without the ellipsis", () => {
    expect(agentActivityA11y(agentActivity([task({ status: WORKING_STATUS, element: "Card" })])))
      .toBe("The agent is working on Card");
    expect(agentActivityA11y(agentActivity([task({ status: WORKING_STATUS })])))
      .toBe("The agent is working on your task");
    expect(agentActivityA11y(agentActivity([
      task({ status: WORKING_STATUS }), task({ status: WORKING_STATUS }),
    ]))).toBe("The agent is working on 2 tasks");
    expect(agentActivityA11y(agentActivity([]))).toBe("");
  });
});

describe("progress", () => {
  it("is the server's latest step, tidied, only while the task is working", () => {
    expect(taskProgress(task({ status: WORKING_STATUS, progress: "  Editing\n app/Button.tsx " }))).toBe(
      "Editing app/Button.tsx",
    );
    // A step left behind on a finished task is history, not news.
    expect(taskProgress(task({ status: "resolved", progress: "Editing app/Button.tsx" }))).toBeUndefined();
    expect(taskProgress(task({ status: WORKING_STATUS, progress: "   " }))).toBeUndefined();
    expect(taskProgress(task({ status: WORKING_STATUS }))).toBeUndefined();
  });

  it("is cut to one short line", () => {
    const line = taskProgress(task({ status: WORKING_STATUS, progress: "x".repeat(500) }))!;
    expect(line.length).toBe(120);
    expect(line.endsWith("…")).toBe(true);
  });

  it("rides on the banner for a single task, and is read out with it", () => {
    const a = agentActivity([
      task({ status: WORKING_STATUS, comment: "Make it blue", progress: "Editing app/Button.tsx" }),
    ]);
    expect(a.progress).toBe("Editing app/Button.tsx");
    expect(agentActivityA11y(a)).toBe("The agent is working on: Make it blue. Editing app/Button.tsx");
  });

  it("names no single task, and so no progress, when several are in flight", () => {
    const a = agentActivity([
      task({ id: "a1", status: WORKING_STATUS, progress: "one" }),
      task({ id: "a2", status: WORKING_STATUS, progress: "two" }),
    ]);
    expect(a.taskId).toBeUndefined();
    expect(a.progress).toBeUndefined();
  });
});
