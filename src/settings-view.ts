/**
 * What the settings panel SAYS — every rule it applies, with none of the
 * react-native it applies them in (src/settings.tsx renders this).
 *
 * Three jobs, and all three are the kind that is quietly wrong for months
 * if nobody tests them:
 *
 *   · WHOSE NAME IS THIS. The overlay has five identity tiers (src/viewer.ts)
 *     and exactly ONE of them is this device's to change. A settings panel
 *     that let you type over a server-side identity would be lying about
 *     what the control does — the next message would still come back in the
 *     server's name.
 *   · WHAT IS THE HOST WIRED TO. The endpoint HOST, never the token, and
 *     never the query string a token might one day ride in.
 *   · WHICH OPTIONAL PEERS RESOLVED. The three that silently degrade
 *     features (src/svg.ts, src/screenshot.ts, src/shake.ts) — the answer
 *     to "why is there no screenshot on my task", read off the device
 *     instead of guessed at from a bug report.
 */

import { ACCENTS } from "./accent";
import { endpointHost } from "./log";
import type { AccentKey } from "./accent";
import { DEFAULT_TEXT_TONE, TEXT_TONE_SPECS } from "./text-tone";
import type { TextTone } from "./text-tone";
import { outputDetailLabel } from "./prefs";
import type { OutputDetail } from "./prefs";
import { themePreferenceLabel } from "./theme";
import type { ThemePreference } from "./theme";
import type { ViewerIdentity, ViewerSource } from "./viewer";
import { agentSummary } from "./agent-config";
import type { AgentConfig } from "./agent-config";

// ── Pages ────────────────────────────────────────────────────────────────

/**
 * The panel is a two-level stack, not one long scroll.
 *
 * Six sections in a sheet that occupies half the screen meant everything
 * below "marker colours" was found by accident, if at all. Splitting costs
 * one tap to reach a setting and buys a root list you can read in a glance —
 * the right trade for controls that are set once and then left alone.
 *
 * `root` is the menu; every other value is a page reachable from it.
 */
export type SettingsPage = "root" | "appearance" | "agent" | "output" | "session" | "you" | "about";

/** A page, as the root menu advertises it. */
export interface SettingsRootRow {
  page: Exclude<SettingsPage, "root">;
  title: string;
  /**
   * The CURRENT VALUE, not a description. A menu row that says "choose how
   * much context rides along" tells you nothing you can act on; one that
   * says "Standard" answers the question that made you open the panel.
   */
  summary: string;
}

/** The title shown in the header while a page is open. */
export function settingsPageTitle(page: SettingsPage): string {
  switch (page) {
    case "root":
      return "Settings";
    case "appearance":
      return "Appearance";
    case "agent":
      return "Agent";
    case "output":
      return "What gets sent";
    case "session":
      return "This session";
    case "you":
      return "You";
    case "about":
      return "About";
  }
}

export interface RootRowsInput {
  theme: ThemePreference;
  agentAccent: AccentKey;
  teamAccent: AccentKey;
  textTone: TextTone;
  outputDetail: OutputDetail;
  clearOnSend: boolean;
  identity: ViewerIdentity;
  version: string;
  /** The server's `/agent`, or null/absent when it has none: no Agent row. */
  agent?: AgentConfig | null;
}

/**
 * The root menu: one row per page, each showing where that page currently
 * stands. Order is by how often it is touched — appearance first (the
 * reason most people open this), diagnostics last (the reason nobody does).
 */
export function settingsRootRows(input: RootRowsInput): SettingsRootRow[] {
  return [
    {
      page: "appearance",
      title: settingsPageTitle("appearance"),
      // Theme, both marks and the text tone, in the order the page
      // presents them. The tone only when it is not the default: the row
      // has one line, and "Neutral text" says nothing.
      summary: `${themePreferenceLabel(input.theme)} · ${ACCENTS[input.agentAccent].label} & ${
        ACCENTS[input.teamAccent].label
      }${input.textTone === DEFAULT_TEXT_TONE ? "" : ` · ${TEXT_TONE_SPECS[input.textTone].label} text`}`,
    },
    // Second: which agent does the work is the next thing people come to
    // change. Only when the server can say — a server without /agent has
    // nothing to show here.
    ...(input.agent
      ? [{ page: "agent" as const, title: settingsPageTitle("agent"), summary: agentSummary(input.agent) }]
      : []),
    {
      page: "output",
      title: settingsPageTitle("output"),
      summary: outputDetailLabel(input.outputDetail),
    },
    {
      page: "session",
      title: settingsPageTitle("session"),
      summary: input.clearOnSend ? "Clears the queue after sending" : "Keeps sent tasks in the queue",
    },
    {
      page: "you",
      title: settingsPageTitle("you"),
      // The stand-in when nothing has named you, same as the page itself.
      summary: input.identity.name ?? ANONYMOUS_NAME,
    },
    {
      page: "about",
      title: settingsPageTitle("about"),
      summary: `v${input.version}`,
    },
  ];
}

// ── Identity ─────────────────────────────────────────────────────────────

/** How the settings panel presents "who you are". */
export interface IdentityView {
  /** The display name, or a stand-in when no tier has supplied one. */
  name: string;
  /** True when there is actually a name (vs the stand-in). */
  hasName: boolean;
  /**
   * Can the user type a new one here?
   *
   * ONLY for a name this device chose, or when there is no identity at all.
   * Every other tier outranks the prompt (src/viewer.ts), so an edit would
   * either be ignored outright or — worse — appear to work locally while
   * every message kept coming back under the real name.
   */
  editable: boolean;
  /** Where it came from, in the panel's own words. */
  sourceLabel: string;
  /**
   * The one line under a READ-ONLY identity saying why it cannot be typed
   * over. Null when the field is editable — an editable field explains
   * itself by being editable.
   */
  readOnlyNote: string | null;
}

const SOURCE_LABEL: Record<ViewerSource, string> = {
  prop: "From the host app",
  viewer: "From the server",
  env: "From the preview environment",
  server: "From the server",
  prompt: "Chosen on this device",
};

const READ_ONLY_NOTE: Record<ViewerSource, string> = {
  prop: "The app passed this in (the author prop) — change it there.",
  viewer: "The server signed you in as this; a local edit would not change it.",
  env: "Baked into this preview environment, not into this device.",
  server: "The server attributed your messages to this; a local edit would not change it.",
  prompt: "",
};

/** Nothing has said who this is — the panel still has to render something. */
export const ANONYMOUS_NAME = "Not set";

/**
 * A server that knows WHO you are but not what to call you.
 *
 * This is the ordinary state on a server that authenticates without display
 * names (the local stub, for one): the moment it echoes an author id, the
 * id outranks the name typed on this device and the name is dropped —
 * src/viewer.ts, "a tier that loses the id loses the person". The panel has
 * to say that, because "Not set" beside a read-only field with no
 * explanation looks like the overlay lost something.
 */
const NAMELESS_SERVER_NOTE =
  "This server knows who you are but has no display name for you.";

/**
 * Whether the name field is a field at all.
 *
 * `null` (no tier answered yet) counts as editable: typing a name there is
 * exactly what the first-post prompt would have asked for, and doing it up
 * front is a courtesy, not an override.
 */
export function viewerNameEditable(source: ViewerSource | null): boolean {
  return source === null || source === "prompt";
}

export function identityView(identity: ViewerIdentity): IdentityView {
  const source = identity.source;
  const editable = viewerNameEditable(source);
  return {
    name: identity.name ?? ANONYMOUS_NAME,
    hasName: !!identity.name,
    editable,
    sourceLabel: source ? SOURCE_LABEL[source] : "Not set",
    readOnlyNote: editable || !source
      ? null
      : !identity.name && (source === "viewer" || source === "server")
        ? NAMELESS_SERVER_NOTE
        : READ_ONLY_NOTE[source],
  };
}

/**
 * The label on the "identity" row's action.
 *
 * "Change" for a name already chosen here, "Set a name" for none — the same
 * control, but a user with no name is being offered something new rather
 * than being asked to correct something.
 */
export function identityActionLabel(identity: ViewerIdentity): string {
  return identity.name ? "Change" : "Set a name";
}

// ── Diagnostics ──────────────────────────────────────────────────────────

/** One read-only fact. */
export interface DiagnosticRow {
  key: string;
  label: string;
  value: string;
}

export interface DiagnosticsInput {
  /** The package's own version (src/env.ts PACKAGE_VERSION). */
  version: string;
  /** What /health answered, or null before/without a successful handshake. */
  protocolVersion: number | null;
  /** The configured base URL. Only its HOST is ever shown. */
  endpoint: string | null;
  /** Whether each optional peer resolved. */
  peers: { svg: boolean; viewShot: boolean; sensors: boolean };
}

/**
 * THE HOST, AND NOTHING ELSE — re-exported from src/log.ts, which now owns
 * redaction because the transport needs the same rule for its logs.
 *
 * A capability URL is a secret (src/env.ts: some servers treat the whole
 * endpoint as the credential), and a token could one day ride in a query
 * string. So the path, the query, the fragment and any userinfo are all
 * dropped and only the host — with its port, which is the part that matters
 * on a local stub — survives. Null for anything unparseable, because a
 * half-parsed URL in a diagnostics block is worse than a dash.
 */
export { endpointHost };

/** "resolved" / "not installed", in the panel's words. */
export function peerStatus(resolved: boolean): string {
  return resolved ? "resolved" : "not installed";
}

/**
 * The diagnostics block, in the order it is read: what this is, what it is
 * speaking, what it is speaking TO, then what it could not find.
 *
 * Every value is a string here — a panel that formats numbers itself ends
 * up with "protocol 1" in one place and "v1" in another.
 */
export function diagnosticsRows(input: DiagnosticsInput): DiagnosticRow[] {
  return [
    { key: "version", label: "Package", value: `v${input.version}` },
    {
      key: "protocol",
      label: "Protocol",
      // Before the handshake answers there is genuinely no negotiated
      // version, and saying "1" from the constant would be us reporting our
      // own hope back to ourselves.
      value: input.protocolVersion === null ? "not negotiated" : `v${input.protocolVersion}`,
    },
    { key: "endpoint", label: "Endpoint", value: endpointHost(input.endpoint) ?? "—" },
    { key: "peer-svg", label: "react-native-svg", value: peerStatus(input.peers.svg) },
    {
      key: "peer-view-shot",
      label: "react-native-view-shot",
      value: peerStatus(input.peers.viewShot),
    },
    { key: "peer-sensors", label: "expo-sensors", value: peerStatus(input.peers.sensors) },
  ];
}
