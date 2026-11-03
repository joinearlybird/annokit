/** Fix or Question (src/intent.ts): the one set of words every surface uses for what a task wants. */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTENT,
  finishedWord,
  intentBadge,
  intentLabel,
  intentPlaceholder,
  intentSubmitA11y,
  intentSubmitLabel,
  intentToggleA11y,
  isTaskIntent,
  readIntent,
} from "../src/intent";

describe("reading an intent", () => {
  it("is fix unless the task says question", () => {
    expect(DEFAULT_INTENT).toBe("fix");
    expect(readIntent({ intent: "question" })).toBe("question");
    expect(readIntent({ intent: "fix" })).toBe("fix");
    expect(readIntent({})).toBe("fix");
    expect(readIntent({ intent: "approve" })).toBe("fix");
    expect(readIntent(null)).toBe("fix");
    expect(isTaskIntent("question")).toBe(true);
    expect(isTaskIntent("Question")).toBe(false);
  });
});

describe("the words", () => {
  it("name the commit, the hint and the chip by intent", () => {
    expect(intentLabel("fix")).toBe("Fix");
    expect(intentLabel("question")).toBe("Question");
    expect(intentSubmitLabel("fix")).toBe("Create Agent Task");
    expect(intentSubmitLabel("question")).toBe("Ask the Agent");
    expect(intentSubmitLabel("question", true)).toBe("Saving…");
    expect(intentPlaceholder("fix", false)).toBe("Describe the change…");
    expect(intentPlaceholder("fix", true)).toBe("Describe the change, or paste an image…");
    expect(intentPlaceholder("question", false)).toBe("Ask about this element…");
    expect(intentBadge("fix")).toBeNull();
    expect(intentBadge("question")).toEqual({ label: "Question", glyph: "?" });
    expect(finishedWord("fix")).toBe("Done");
    expect(finishedWord("question")).toBe("Answered");
  });

  it("tell a screen reader what each choice does, and which is on", () => {
    expect(intentSubmitA11y("question")).toMatch(/change nothing/);
    expect(intentSubmitA11y("fix")).toMatch(/make this change/);
    expect(intentToggleA11y("fix", true)).toMatch(/Selected$/);
    expect(intentToggleA11y("question", false)).not.toMatch(/Selected/);
  });
});
