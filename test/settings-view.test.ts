/**
 * What the settings panel is allowed to say (src/settings-view.ts): which
 * identities may be typed over, and what the diagnostics block does — and
 * does not — put on screen.
 */

import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_NAME,
  diagnosticsRows,
  endpointHost,
  identityActionLabel,
  identityView,
  peerStatus,
  settingsPageTitle,
  settingsRootRows,
  viewerNameEditable,
} from "../src/settings-view";
import type { ViewerIdentity, ViewerSource } from "../src/viewer";

function identity(source: ViewerSource | null, name: string | null = "Ada"): ViewerIdentity {
  return { id: source ? "u1" : null, name, avatarUrl: null, source };
}

describe("whose name may be edited here", () => {
  it("lets you change a name THIS device chose", () => {
    expect(viewerNameEditable("prompt")).toBe(true);
    const view = identityView(identity("prompt"));
    expect(view.editable).toBe(true);
    expect(view.name).toBe("Ada");
    expect(view.sourceLabel).toBe("Chosen on this device");
    // An editable field explains itself; a note under it would be noise.
    expect(view.readOnlyNote).toBeNull();
  });

  it("lets you set one when nothing has answered yet", () => {
    // Typing it here is what the first-post prompt would have asked for;
    // offering it up front is a courtesy, not an override.
    expect(viewerNameEditable(null)).toBe(true);
    const view = identityView(identity(null, null));
    expect(view.editable).toBe(true);
    expect(view.hasName).toBe(false);
    expect(view.name).toBe(ANONYMOUS_NAME);
  });

  it("refuses to let a local edit masquerade as a server identity", () => {
    // The tiers above the prompt outrank it (src/viewer.ts), so a field
    // here would either be ignored outright or — worse — look like it
    // worked while every message kept coming back under the real name.
    for (const source of ["prop", "viewer", "env", "server"] as ViewerSource[]) {
      expect(viewerNameEditable(source)).toBe(false);
      const view = identityView(identity(source));
      expect(view.editable, `${source} must be read-only`).toBe(false);
      expect(view.readOnlyNote, `${source} must say where it came from`).toBeTruthy();
    }
  });

  it("explains a server that knows you but has no name for you", () => {
    // The ordinary state against a server that authenticates without
    // display names: the echoed id outranks the name typed here and the
    // name is dropped (src/viewer.ts). "Not set" with no explanation reads
    // as a bug.
    const view = identityView({ id: "u1", name: null, avatarUrl: null, source: "server" });
    expect(view.name).toBe(ANONYMOUS_NAME);
    expect(view.editable).toBe(false);
    expect(view.readOnlyNote).toContain("no display name");
  });

  it("names the source in the user's terms, not the protocol's", () => {
    expect(identityView(identity("prop")).sourceLabel).toBe("From the host app");
    expect(identityView(identity("viewer")).sourceLabel).toBe("From the server");
    expect(identityView(identity("env")).sourceLabel).toBe("From the preview environment");
  });

  it("offers to SET a name when there is none, and to CHANGE one when there is", () => {
    expect(identityActionLabel(identity("prompt", null))).toBe("Set a name");
    expect(identityActionLabel(identity("prompt", "Ada"))).toBe("Change");
  });
});

describe("the endpoint, shown as a host and nothing more", () => {
  it("keeps the host and the port", () => {
    expect(endpointHost("https://sandbox.example.dev/sessions/abc/agentation")).toBe(
      "sandbox.example.dev",
    );
    // The port is the part that matters against a local stub.
    expect(endpointHost("http://localhost:4788/agentation")).toBe("localhost:4788");
  });

  it("drops the path, the query and the fragment", () => {
    // A capability URL is itself a credential, and a token could one day
    // ride in a query string. Neither belongs in a screenshot.
    expect(endpointHost("https://host.dev/s/secret-capability-id?token=hunter2#x")).toBe(
      "host.dev",
    );
    expect(endpointHost("https://host.dev?token=hunter2")).toBe("host.dev");
  });

  it("drops userinfo credentials", () => {
    expect(endpointHost("https://user:pass@host.dev/path")).toBe("host.dev");
  });

  it("answers null rather than half a URL", () => {
    expect(endpointHost(null)).toBeNull();
    expect(endpointHost("")).toBeNull();
    expect(endpointHost("   ")).toBeNull();
    expect(endpointHost(undefined)).toBeNull();
  });
});

describe("the diagnostics block", () => {
  const input = {
    version: "0.1.0",
    protocolVersion: 1,
    endpoint: "https://host.dev/sessions/abc/agentation?token=hunter2",
    peers: { svg: true, viewShot: false, sensors: true },
  };

  it("reads as what this is, what it speaks, and what it speaks to", () => {
    const rows = diagnosticsRows(input);
    expect(rows.map((r) => r.key)).toEqual([
      "version",
      "protocol",
      "endpoint",
      "peer-svg",
      "peer-view-shot",
      "peer-sensors",
    ]);
    expect(rows[0]!.value).toBe("v0.1.0");
    expect(rows[1]!.value).toBe("v1");
    expect(rows[2]!.value).toBe("host.dev");
  });

  it("never puts the token on screen", () => {
    const shown = diagnosticsRows(input).map((r) => r.value).join(" ");
    expect(shown).not.toContain("hunter2");
    expect(shown).not.toContain("token");
  });

  it("says the protocol is not negotiated rather than reporting our own hope", () => {
    // Before /health answers there is no negotiated version, and printing
    // SUPPORTED_PROTOCOL_VERSION here would be the client telling itself
    // what it wanted to hear.
    const rows = diagnosticsRows({ ...input, protocolVersion: null });
    expect(rows.find((r) => r.key === "protocol")!.value).toBe("not negotiated");
  });

  it("dashes an endpoint it cannot parse", () => {
    const rows = diagnosticsRows({ ...input, endpoint: null });
    expect(rows.find((r) => r.key === "endpoint")!.value).toBe("—");
  });

  it("says which optional peers resolved", () => {
    const rows = diagnosticsRows(input);
    expect(rows.find((r) => r.key === "peer-svg")!.value).toBe("resolved");
    expect(rows.find((r) => r.key === "peer-view-shot")!.value).toBe("not installed");
    expect(peerStatus(true)).toBe("resolved");
    expect(peerStatus(false)).toBe("not installed");
  });
});

// ── The menu ─────────────────────────────────────────────────────────────

describe("settingsRootRows", () => {
  const base = {
    theme: "system" as const,
    agentAccent: "blue" as const,
    teamAccent: "orange" as const,
    textTone: "neutral" as const,
    outputDetail: "standard" as const,
    clearOnSend: false,
    identity: identity("prompt", "Ada"),
    version: "0.1.0",
  };

  it("offers every page exactly once, in a stable order", () => {
    const pages = settingsRootRows(base).map((r) => r.page);
    expect(pages).toEqual(["appearance", "output", "session", "you", "about"]);
  });

  it("summarises each row with its CURRENT VALUE, not a description", () => {
    const by = Object.fromEntries(settingsRootRows(base).map((r) => [r.page, r.summary]));
    // The whole point of the menu: these answer the question without a tap.
    expect(by.appearance).toBe("System · Blue & Orange");
    expect(by.output).toBe("Standard");
    expect(by.you).toBe("Ada");
    expect(by.about).toBe("v0.1.0");
  });

  it("says which way the session switch is pointing", () => {
    const off = settingsRootRows(base).find((r) => r.page === "session");
    const on = settingsRootRows({ ...base, clearOnSend: true }).find((r) => r.page === "session");
    expect(off?.summary).toBe("Keeps sent tasks in the queue");
    expect(on?.summary).toBe("Clears the queue after sending");
  });

  it("falls back to the stand-in name when no tier has named you", () => {
    const rows = settingsRootRows({ ...base, identity: identity(null, null) });
    expect(rows.find((r) => r.page === "you")?.summary).toBe(ANONYMOUS_NAME);
  });

  it("tracks a changed accent pair", () => {
    const rows = settingsRootRows({ ...base, agentAccent: "teal", teamAccent: "rose" });
    expect(rows.find((r) => r.page === "appearance")?.summary).toBe("System · Teal & Rose");
  });

  it("names the text tone only when it is not the default", () => {
    const rows = settingsRootRows({ ...base, textTone: "contrast" });
    expect(rows.find((r) => r.page === "appearance")?.summary).toBe(
      "System · Blue & Orange · High contrast text",
    );
  });
});

describe("settingsPageTitle", () => {
  it("titles the root with the panel's own name", () => {
    expect(settingsPageTitle("root")).toBe("Settings");
  });

  it("gives every page a title", () => {
    for (const page of ["appearance", "output", "session", "you", "about"] as const) {
      expect(settingsPageTitle(page).length).toBeGreaterThan(0);
    }
  });
});
