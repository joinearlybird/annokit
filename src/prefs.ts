/**
 * THE OVERLAY'S PREFERENCES, held for the session and nowhere else.
 *
 * Same shape as the identity store next door (src/viewer.ts): a module-level
 * snapshot, a subscribe function for `useSyncExternalStore`, and two tiers —
 * what the HOST asked for (props on <AnnoKitProvider>) and what the person
 * holding the device chose in the settings panel. The panel wins, and
 * because nothing is written to disk, a reload hands control back to the
 * host. No storage peer for a dev overlay; docs/settings.md says so out loud.
 *
 * WHAT IS IN HERE, and why each one earns its row:
 *   · OUTPUT DETAIL — how much context rides along with a task. The knob
 *     for anyone who finds the payload noisy, and for anyone who cares
 *     what leaves their app. Shapes the wire body in src/payload.ts.
 *   · THE TWO MARKER COLOURS — which hue means "the agent will act" and
 *     which means "people are talking" (src/accent.ts).
 *   · HIDDEN — put the overlay away for this run. Worth more on a phone
 *     than on the web, where a floating button is not sitting on 400pt of
 *     screen. Deliberately un-undoable without a restart, which is exactly
 *     what the row says it does.
 *   · CLEAR ON SEND — drop the queue's tasks once the server has taken
 *     them, instead of leaving a list of things already handed over.
 *
 * Pure and react-native-free, so the precedence rules are unit tested
 * rather than eyeballed.
 */

import { DEFAULT_ACCENTS, isAccentKey } from "./accent";
import type { AccentKey, AccentRole } from "./accent";
import { DEFAULT_TEXT_TONE, isTextTone } from "./text-tone";
import type { TextTone } from "./text-tone";

/** How much context a task carries. See `applyOutputDetail` in payload.ts. */
export type OutputDetail = "minimal" | "standard" | "full";

export const OUTPUT_DETAILS: readonly OutputDetail[] = ["minimal", "standard", "full"];

export const DEFAULT_OUTPUT_DETAIL: OutputDetail = "standard";

export function isOutputDetail(value: unknown): value is OutputDetail {
  return value === "minimal" || value === "standard" || value === "full";
}

/** The label and the one line under it, in the panel. */
export function outputDetailLabel(detail: OutputDetail): string {
  return detail === "minimal" ? "Minimal" : detail === "full" ? "Full" : "Standard";
}

export function outputDetailSummary(detail: OutputDetail): string {
  if (detail === "minimal") return "Route, position and your words.";
  // Must match applyOutputDetail (src/payload.ts). Nearby text is ON-SCREEN
  // CONTENT and has ridden at Standard since 2026-09-22; a panel that says
  // otherwise tells someone keeping it on the device that it is.
  if (detail === "full") return "Standard, plus the component stack, styles and accessibility.";
  return "Element, source file, testID, nearby text, route and position.";
}

/** What the host asked for, and what the user chose. */
export interface AnnoKitPreferences {
  outputDetail: OutputDetail;
  agentAccent: AccentKey;
  teamAccent: AccentKey;
  /** The text ramp (src/text-tone.ts). */
  textTone: TextTone;
  hidden: boolean;
  clearOnSend: boolean;
  /**
   * Show the "agent is working" banner. ON BY DEFAULT: it only appears when
   * a server actually says work is happening, so the default costs nothing
   * on a server that never says it — turning it off is for someone who
   * finds it noisy, not something anyone should have to opt into.
   */
  agentBanner: boolean;
  /**
   * Refuse to send a new task while the agent is working. ON BY DEFAULT.
   *
   * The agents this was built for edit one working tree, where a second one
   * started mid-run can overwrite the first. But that is a fact about the
   * SERVER, not about the protocol — one that runs each task in its own
   * worktree, or simply queues them (the example stub does), can take
   * another task safely, and the block is then only in the way.
   *
   * The client cannot know which it is talking to unless the server says,
   * so the person who does gets a switch. A server that queues tasks says
   * so in `/health` (`queuesTasks`, src/handshake.ts), and the default
   * follows it. Otherwise it defaults to the careful answer: losing an edit
   * with nothing on screen to say so is far worse than a Send button that
   * waits.
   */
  blockSendWhileWorking: boolean;
}

/** The host's props. Everything optional; anything invalid is ignored. */
export interface PreferenceDefaults {
  outputDetail?: unknown;
  agentAccent?: unknown;
  teamAccent?: unknown;
  textTone?: unknown;
  agentBanner?: unknown;
  blockSendWhileWorking?: unknown;
}

interface Choices {
  outputDetail: OutputDetail | null;
  agentAccent: AccentKey | null;
  teamAccent: AccentKey | null;
  textTone: TextTone | null;
  hidden: boolean;
  clearOnSend: boolean;
  /** Null: the panel has not touched it, so the host's prop (or true) stands. */
  agentBanner: boolean | null;
  blockSendWhileWorking: boolean | null;
}

const NO_CHOICES: Choices = {
  outputDetail: null,
  agentAccent: null,
  teamAccent: null,
  textTone: null,
  hidden: false,
  clearOnSend: false,
  agentBanner: null,
  blockSendWhileWorking: null,
};

let defaults: PreferenceDefaults = {};
/** What the server said about itself, below the host's props. */
let serverQueuesTasks = false;
let choices: Choices = { ...NO_CHOICES };
let snapshot: AnnoKitPreferences = resolve();
const listeners = new Set<() => void>();

function resolve(): AnnoKitPreferences {
  const agent = choices.agentAccent ?? pickAccent(defaults.agentAccent) ?? DEFAULT_ACCENTS.agent;
  let team = choices.teamAccent ?? pickAccent(defaults.teamAccent) ?? DEFAULT_ACCENTS.team;
  // THE ONE INVARIANT (src/accent.ts): the two marks may not be the same
  // colour. The panel disables the taken swatch so this cannot normally
  // happen — but a host CAN pass the same key for both props, and the
  // overlay must not draw two identical marks because of it. The team
  // moves, because the agent's is the one the FAB and the aim chrome wear.
  if (team === agent) team = agent === DEFAULT_ACCENTS.team ? DEFAULT_ACCENTS.agent : DEFAULT_ACCENTS.team;
  return {
    outputDetail:
      choices.outputDetail ?? pickDetail(defaults.outputDetail) ?? DEFAULT_OUTPUT_DETAIL,
    agentAccent: agent,
    teamAccent: team,
    textTone: choices.textTone ?? pickTextTone(defaults.textTone) ?? DEFAULT_TEXT_TONE,
    hidden: choices.hidden,
    clearOnSend: choices.clearOnSend,
    agentBanner: choices.agentBanner ?? pickBoolean(defaults.agentBanner) ?? true,
    // Panel, then the host's prop, then what the server said, then careful.
    blockSendWhileWorking:
      choices.blockSendWhileWorking ??
      pickBoolean(defaults.blockSendWhileWorking) ??
      !serverQueuesTasks,
  };
}

function pickBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function pickAccent(value: unknown): AccentKey | null {
  return isAccentKey(value) ? value : null;
}

function pickTextTone(value: unknown): TextTone | null {
  return isTextTone(value) ? value : null;
}

function pickDetail(value: unknown): OutputDetail | null {
  return isOutputDetail(value) ? value : null;
}

function recompute(): void {
  const next = resolve();
  const prev = snapshot;
  if (
    next.outputDetail === prev.outputDetail &&
    next.agentAccent === prev.agentAccent &&
    next.teamAccent === prev.teamAccent &&
    next.textTone === prev.textTone &&
    next.hidden === prev.hidden &&
    next.clearOnSend === prev.clearOnSend &&
    next.agentBanner === prev.agentBanner &&
    next.blockSendWhileWorking === prev.blockSendWhileWorking
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

/** The resolved preferences. Stable identity between changes. */
export function annoKitPreferences(): AnnoKitPreferences {
  return snapshot;
}

export function subscribeToPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tier 1: the host's props, re-stated whenever they change. */
export function setPreferenceDefaults(next: PreferenceDefaults): void {
  defaults = next ?? {};
  recompute();
}

/** Tier 0: the server's `/health` said it queues tasks (src/handshake.ts). */
export function setServerQueuesTasks(queues: boolean): void {
  serverQueuesTasks = queues === true;
  recompute();
}

/** Tier 2: the panel. Null on an accent/detail hands the row back to the host. */
export function chooseOutputDetail(detail: OutputDetail | null): void {
  choices = { ...choices, outputDetail: pickDetail(detail) };
  recompute();
}

export function chooseAccent(role: AccentRole, key: AccentKey | null): void {
  const picked = pickAccent(key);
  choices =
    role === "agent" ? { ...choices, agentAccent: picked } : { ...choices, teamAccent: picked };
  recompute();
}

export function chooseTextTone(tone: TextTone | null): void {
  choices = { ...choices, textTone: pickTextTone(tone) };
  recompute();
}

/** Put the overlay away until the app is restarted. There is no way back. */
export function hideUntilRestart(): void {
  choices = { ...choices, hidden: true };
  recompute();
}

export function setClearOnSend(on: boolean): void {
  choices = { ...choices, clearOnSend: on === true };
  recompute();
}

export function setAgentBanner(on: boolean): void {
  choices = { ...choices, agentBanner: on === true };
  recompute();
}

export function setBlockSendWhileWorking(on: boolean): void {
  choices = { ...choices, blockSendWhileWorking: on === true };
  recompute();
}

/** Tests, and anything that swaps servers under us. */
export function forgetPreferences(): void {
  defaults = {};
  serverQueuesTasks = false;
  choices = { ...NO_CHOICES };
  recompute();
}
