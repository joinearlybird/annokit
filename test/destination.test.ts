/**
 * The submit-time destination choice (src/destination.ts) — the rules behind
 * the composer's two buttons.
 *
 * Three things are worth pinning down, and all three are invisible until
 * they are wrong on a phone:
 *
 *   THE WORDS. The whole change exists because "annotation" and "comment"
 *   read as synonyms. So the copy is asserted, not just the keys: each
 *   destination has to name who acts on it.
 *   WHAT IS PRESSABLE. A comment with no text has nothing for a teammate to
 *   read; an agent task with a screenshot and no text is already an
 *   instruction (the web overlay's rule, mirrored).
 *   WHAT IS LOST. Choosing the team note with attachments in hand must
 *   announce what it drops BEFORE the tap.
 */

import { describe, expect, it } from "vitest";
import {
  KIND_SEPARATOR,
  canSubmitTo,
  destinationBadge,
  destinationTitle,
  submitBlockedReason,
} from "../src/destination";
import { DARK_PALETTE, LIGHT_PALETTE } from "../src/theme";

describe("what can be submitted", () => {
  it("needs something before either destination opens", () => {
    const empty = { text: "   " };
    expect(canSubmitTo("agent", empty)).toBe(false);
    expect(canSubmitTo("comment", empty)).toBe(false);
  });

  it("lets the agent take evidence without words, like the web overlay does", () => {
    expect(canSubmitTo("agent", { text: "", hasScreenshot: true })).toBe(true);
    expect(canSubmitTo("agent", { text: "", attachmentCount: 2 })).toBe(true);
    // A team note is words or nothing — there is no picture for a teammate
    // to read, and none would be posted anyway.
    expect(canSubmitTo("comment", { text: "", hasScreenshot: true })).toBe(false);
    expect(canSubmitTo("comment", { text: "", attachmentCount: 2 })).toBe(false);
  });

  it("closes the team path on a server with no comment routes, and says why", () => {
    const state = { text: "spacing looks off", commentsAvailable: false };
    expect(canSubmitTo("comment", state)).toBe(false);
    // The agent half is untouched by that failure.
    expect(canSubmitTo("agent", state)).toBe(true);
    expect(submitBlockedReason("comment", state)).toContain("unavailable");
  });

  it("blocks both while a submit is in flight", () => {
    const state = { text: "hello", submitting: true };
    expect(canSubmitTo("agent", state)).toBe(false);
    expect(canSubmitTo("comment", state)).toBe(false);
  });

  it("offers no reason when a button is simply waiting for text", () => {
    // "Type something" is what the empty input already says; a second line
    // repeating it would be noise.
    expect(submitBlockedReason("comment", { text: "" })).toBeNull();
    expect(submitBlockedReason("agent", { text: "anything" })).toBeNull();
  });
});

describe("badges", () => {
  it("labels the stored kinds in the same vocabulary the composer used", () => {
    expect(destinationBadge("agent").label).toBe("Agent task");
    expect(destinationBadge("comment").label).toBe("Team note");
  });

  it("keeps blue for the agent and orange for the team", () => {
    expect(destinationBadge("agent").color).toBe(DARK_PALETTE.agent);
    expect(destinationBadge("comment").color).toBe(DARK_PALETTE.team);
    expect(destinationBadge("agent").color).not.toBe(destinationBadge("comment").color);
  });

  it("takes its colours from whichever theme is in force", () => {
    // The MEANING is fixed and the value is not: on a light sheet the same
    // two roles are drawn a step darker so white ink still reads on them.
    expect(destinationBadge("agent", LIGHT_PALETTE).color).toBe(LIGHT_PALETTE.agent);
    expect(destinationBadge("comment", LIGHT_PALETTE).color).toBe(LIGHT_PALETTE.team);
    expect(destinationBadge("agent", LIGHT_PALETTE).label).toBe("Agent task");
    // Still two different colours in both — the distinction is the point.
    expect(destinationBadge("agent", LIGHT_PALETTE).color).not.toBe(
      destinationBadge("comment", LIGHT_PALETTE).color,
    );
  });

  describe("as a title prefix", () => {
    it("reads as one line: the kind, a separator, then the thing", () => {
      const note = destinationTitle("comment", "FeedRow");
      expect(note.prefix).toBe("Team note");
      expect(note.separator).toBe(KIND_SEPARATOR);
      expect(note.title).toBe("FeedRow");
      expect(note.color).toBe(DARK_PALETTE.team);

      const task = destinationTitle("agent", "PrimaryButton");
      expect(task.prefix).toBe("Agent task");
      expect(task.color).toBe(DARK_PALETTE.agent);

      // …and the palette rides through the title helper too.
      expect(destinationTitle("agent", "PrimaryButton", LIGHT_PALETTE).color).toBe(
        LIGHT_PALETTE.agent,
      );
    });

    it("says it as a sentence for a screen reader, not two fragments", () => {
      expect(destinationTitle("comment", "FeedRow").accessibilityLabel).toBe(
        "Team note: FeedRow",
      );
      // Nothing to name: the kind alone, with no dangling colon.
      expect(destinationTitle("agent", "   ").accessibilityLabel).toBe("Agent task");
    });

    it("keeps the prefix whole — the TITLE is what gives way", () => {
      // Not a truncation test (that is layout) but the contract the layout
      // relies on: the prefix arrives as its own string, so it can be its
      // own non-shrinking Text.
      const long = destinationTitle("comment", "AVeryLongComponentNameIndeed".repeat(4));
      expect(long.prefix).toBe("Team note");
      expect(long.prefix).not.toContain("…");
    });
  });

  it("is a word and a colour and nothing else — colour is never the only signal", () => {
    // The badge's explaining line is gone from every pane that showed it;
    // the LABEL is what keeps colour from being the only signal.
    for (const d of ["agent", "comment"] as const) {
      const badge = destinationBadge(d);
      expect(badge).not.toHaveProperty("hint");
      expect(badge.label.length).toBeGreaterThan(0);
    }
  });
});
