/**
 * The session preferences (src/prefs.ts): the host proposes, the panel
 * disposes, nothing is persisted — and the two marker colours can never
 * come out the same however they were asked for.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OUTPUT_DETAIL,
  OUTPUT_DETAILS,
  annoKitPreferences,
  chooseAccent,
  chooseOutputDetail,
  chooseTextTone,
  forgetPreferences,
  hideUntilRestart,
  isOutputDetail,
  outputDetailLabel,
  outputDetailSummary,
  setAgentBanner,
  setBlockSendWhileWorking,
  setClearOnSend,
  setPreferenceDefaults,
  setServerQueuesTasks,
  subscribeToPreferences,
} from "../src/prefs";
import { DEFAULT_ACCENTS } from "../src/accent";
import { DEFAULT_TEXT_TONE } from "../src/text-tone";

beforeEach(() => {
  forgetPreferences();
});

describe("out of the box", () => {
  it("is standard detail, the default colours, visible, keeps the queue, and shows the agent banner", () => {
    expect(annoKitPreferences()).toEqual({
      outputDetail: DEFAULT_OUTPUT_DETAIL,
      agentAccent: DEFAULT_ACCENTS.agent,
      teamAccent: DEFAULT_ACCENTS.team,
      textTone: DEFAULT_TEXT_TONE,
      hidden: false,
      clearOnSend: false,
      // On by default: the banner only appears when a server says work is
      // happening, so it costs nothing on a server that never says it.
      agentBanner: true,
      // The careful answer by default: losing an edit with nothing on
      // screen to say so is worse than a Send button that waits.
      blockSendWhileWorking: true,
    });
  });

  it("names the three detail levels and says what each sends", () => {
    expect([...OUTPUT_DETAILS]).toEqual(["minimal", "standard", "full"]);
    expect(OUTPUT_DETAILS.map(outputDetailLabel)).toEqual(["Minimal", "Standard", "Full"]);
    for (const detail of OUTPUT_DETAILS) {
      expect(outputDetailSummary(detail).length).toBeGreaterThan(10);
    }
    expect(isOutputDetail("standard")).toBe(true);
    expect(isOutputDetail("verbose")).toBe(false);
  });

  // The panel is where someone decides what leaves the device. Nearby text
  // is sent from Standard up (src/payload.ts), so that is where it is named.
  it("names nearby text at the level that starts sending it", () => {
    expect(outputDetailSummary("minimal")).not.toMatch(/nearby text/i);
    expect(outputDetailSummary("standard")).toMatch(/nearby text/i);
    expect(outputDetailSummary("full")).not.toMatch(/nearby text/i);
  });
});

describe("precedence: host props, then the panel", () => {
  it("takes the host's defaults when nothing has been chosen", () => {
    setPreferenceDefaults({ outputDetail: "full", agentAccent: "teal", teamAccent: "rose" });
    expect(annoKitPreferences().outputDetail).toBe("full");
    expect(annoKitPreferences().agentAccent).toBe("teal");
    expect(annoKitPreferences().teamAccent).toBe("rose");
  });

  it("lets the panel override each of them", () => {
    setPreferenceDefaults({ outputDetail: "full", agentAccent: "teal" });
    chooseOutputDetail("minimal");
    chooseAccent("agent", "violet");
    expect(annoKitPreferences().outputDetail).toBe("minimal");
    expect(annoKitPreferences().agentAccent).toBe("violet");
  });

  it("hands a row back to the host when the choice is cleared", () => {
    setPreferenceDefaults({ agentAccent: "teal" });
    chooseAccent("agent", "violet");
    chooseAccent("agent", null);
    expect(annoKitPreferences().agentAccent).toBe("teal");
  });

  it("ignores host props that are not values at all", () => {
    setPreferenceDefaults({ outputDetail: "loud", agentAccent: "chartreuse", teamAccent: 7 });
    expect(annoKitPreferences().outputDetail).toBe(DEFAULT_OUTPUT_DETAIL);
    expect(annoKitPreferences().agentAccent).toBe(DEFAULT_ACCENTS.agent);
    expect(annoKitPreferences().teamAccent).toBe(DEFAULT_ACCENTS.team);
  });

  // A parallel-worktree server is the README's case for turning the block
  // off from code; before these were props, it could only be done by hand.
  it("takes the banner and send-block defaults from the host, and lets the panel override them", () => {
    setPreferenceDefaults({ agentBanner: false, blockSendWhileWorking: false });
    expect(annoKitPreferences().agentBanner).toBe(false);
    expect(annoKitPreferences().blockSendWhileWorking).toBe(false);

    setAgentBanner(true);
    setBlockSendWhileWorking(true);
    expect(annoKitPreferences().agentBanner).toBe(true);
    expect(annoKitPreferences().blockSendWhileWorking).toBe(true);
  });

  it("keeps both on when the host passes nothing usable", () => {
    setPreferenceDefaults({ agentBanner: "no", blockSendWhileWorking: 0 });
    expect(annoKitPreferences().agentBanner).toBe(true);
    expect(annoKitPreferences().blockSendWhileWorking).toBe(true);
  });
});

describe("the two marks can never collide", () => {
  it("moves the team's colour when a host asks for the same one twice", () => {
    // The panel disables the taken swatch, so this can only arrive through
    // props — and two identical marks must not be drawable at all.
    setPreferenceDefaults({ agentAccent: "teal", teamAccent: "teal" });
    const prefs = annoKitPreferences();
    expect(prefs.agentAccent).toBe("teal");
    expect(prefs.teamAccent).not.toBe("teal");
  });

  it("still moves it when the collision is on the default colours", () => {
    setPreferenceDefaults({ agentAccent: "orange", teamAccent: "orange" });
    const prefs = annoKitPreferences();
    expect(prefs.agentAccent).toBe("orange");
    expect(prefs.teamAccent).not.toBe("orange");
  });
});

describe("the session switches", () => {
  it("hides the overlay, with no way back but a restart", () => {
    expect(annoKitPreferences().hidden).toBe(false);
    hideUntilRestart();
    expect(annoKitPreferences().hidden).toBe(true);
    // There is deliberately no unhide: the row promises a restart.
    expect(Object.keys({ hideUntilRestart })).toEqual(["hideUntilRestart"]);
  });

  it("toggles the agent banner, which starts on", () => {
    expect(annoKitPreferences().agentBanner).toBe(true);
    setAgentBanner(false);
    expect(annoKitPreferences().agentBanner).toBe(false);
    setAgentBanner(true);
    expect(annoKitPreferences().agentBanner).toBe(true);
  });

  it("lets a host that knows better stop the send block", () => {
    // The client cannot tell a serial server from one with a worktree per
    // task; the person running it can.
    expect(annoKitPreferences().blockSendWhileWorking).toBe(true);
    setBlockSendWhileWorking(false);
    expect(annoKitPreferences().blockSendWhileWorking).toBe(false);
  });

  it("toggles clear-on-send", () => {
    setClearOnSend(true);
    expect(annoKitPreferences().clearOnSend).toBe(true);
    setClearOnSend(false);
    expect(annoKitPreferences().clearOnSend).toBe(false);
  });
});

describe("as a store", () => {
  it("notifies subscribers on a change and not on a no-op", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPreferences(listener);
    chooseOutputDetail("full");
    expect(listener).toHaveBeenCalledTimes(1);
    // The same value again is not a change, and re-rendering everything for
    // it is exactly what useSyncExternalStore punishes.
    chooseOutputDetail("full");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    chooseOutputDetail("minimal");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps a stable snapshot identity between changes", () => {
    const first = annoKitPreferences();
    expect(annoKitPreferences()).toBe(first);
    chooseOutputDetail("minimal");
    expect(annoKitPreferences()).not.toBe(first);
  });
});

describe("text tone", () => {
  it("takes the host's tone, lets the panel override it, and hands it back on null", () => {
    setPreferenceDefaults({ textTone: "warm" });
    expect(annoKitPreferences().textTone).toBe("warm");
    chooseTextTone("contrast");
    expect(annoKitPreferences().textTone).toBe("contrast");
    chooseTextTone(null);
    expect(annoKitPreferences().textTone).toBe("warm");
  });

  it("ignores a tone it does not offer", () => {
    setPreferenceDefaults({ textTone: "purple" });
    expect(annoKitPreferences().textTone).toBe(DEFAULT_TEXT_TONE);
  });
});

describe("a server that queues tasks", () => {
  it("does not block Send by default", () => {
    setServerQueuesTasks(true);
    expect(annoKitPreferences().blockSendWhileWorking).toBe(false);
  });

  it("still loses to the host's prop and to the panel", () => {
    setServerQueuesTasks(true);
    setPreferenceDefaults({ blockSendWhileWorking: true });
    expect(annoKitPreferences().blockSendWhileWorking).toBe(true);
    setBlockSendWhileWorking(false);
    expect(annoKitPreferences().blockSendWhileWorking).toBe(false);
  });

  it("is forgotten with the rest", () => {
    setServerQueuesTasks(true);
    forgetPreferences();
    expect(annoKitPreferences().blockSendWhileWorking).toBe(true);
  });
});
