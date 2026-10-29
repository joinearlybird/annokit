/**
 * WHERE a composed capture goes — the choice the user makes at SUBMIT time,
 * not before aiming.
 *
 * WHY THIS EXISTS AT ALL. The overlay used to arm twice: a pencil that armed
 * "annotate" and a quote mark that armed "comment", each with its own FAB
 * colour, its own confirm word, and its own composer. That forced the
 * decision at the worst possible moment — before the user had even picked
 * the element, let alone typed the sentence that decides who should read it.
 * The web overlay never worked that way (ui/src/components/annotation-overlay
 * in the web template: ONE popup, `handleSubmit("comment")` next to
 * `handleSubmit("agent")`), and this module is the phone's version of that
 * model: you mark something once, then choose the destination on the way out.
 *
 * THE WORDS ARE THE FEATURE. "Annotation" and "comment" are synonyms to
 * anyone who has not read the protocol — both are "a note on the screen" —
 * so naming them that way made the user pick between two words that mean
 * the same thing (product owner, device testing: "it is not apparent what
 * comments and annotations are"). The real difference is WHO ACTS ON IT, so
 * that is what the UI says everywhere: "Ask the agent" vs "Note for the
 * team". The wire format and the internal type names are untouched —
 * `annotation` and `comment` are still what the server stores.
 *
 * THE LABELS CARRY IT ALONE. Each of those labels once had an explaining
 * sentence under it ("the agent will make this change" / "teammates see
 * this; the agent won't act on it"), repeated in the composer, in both
 * detail panes and over the notes list. Once the labels said who acts, the
 * sentence was the same fact a second time, in more words, on every screen
 * (product owner, device testing) — so the VISIBLE copy is the label, and
 * the full sentence survives only in the accessibility labels, where there
 * is no blue-or-orange, no icon and no segment to read it from.
 *
 * The options are DATA, and the enable/disable rules are pure predicates,
 * because they are exactly the part that is easy to get wrong and invisible
 * until it is: a comment posted to a server with no comment routes, an
 * attachment silently thrown away, a submit button that looks pressable and
 * is not.
 */

import { DARK_PALETTE } from "./theme";
import type { AnnoKitPalette } from "./theme";


/** The two destinations a composed capture can go to. */
export type SubmitDestination = "agent" | "comment";

export interface SubmitState {
  /** What the user has typed (untrimmed — the check trims). */
  text: string;
  /** Assets + Data-API references picked in the attach panel. */
  attachmentCount?: number;
  /** A screenshot was taken AND its toggle is on. */
  hasScreenshot?: boolean;
  /** False once a comments read has failed: the routes are not there. */
  commentsAvailable?: boolean;
  submitting?: boolean;
}

/**
 * Can this destination be submitted to right now?
 *
 * AGENT mirrors the web overlay's Add-Task rule: text OR evidence is enough,
 * because a screenshot with attachments is already an instruction.
 * COMMENT needs words — there is nothing for a teammate to read otherwise —
 * and needs a server that answers /comments at all.
 */
export function canSubmitTo(destination: SubmitDestination, state: SubmitState): boolean {
  if (state.submitting) return false;
  const hasText = state.text.trim().length > 0;
  if (destination === "comment") return hasText && state.commentsAvailable !== false;
  return hasText || (state.attachmentCount ?? 0) > 0 || state.hasScreenshot === true;
}

/** Why a destination is unavailable, for the line under the buttons. */
export function submitBlockedReason(
  destination: SubmitDestination,
  state: SubmitState,
): string | null {
  if (canSubmitTo(destination, state)) return null;
  if (destination === "comment" && state.commentsAvailable === false) {
    return "Team notes unavailable — this server has no comment routes";
  }
  return null;
}

/**
 * The destination a stored item BELONGS to, in the same words the composer
 * offered. Detail views, list rows and markers all label themselves from
 * here so the vocabulary cannot drift between the place you choose and the
 * places you read it back.
 */
export interface DestinationBadge {
  /** Short label for a chip: "Agent task" / "Team note". */
  label: string;
  /** Blue for the agent's half, orange for the team's — the marker colours. */
  color: string;
}

/**
 * The two accent fills, as tokens rather than literals.
 *
 * They come from the palette (src/theme.ts) so there is ONE place where
 * "the agent's colour" is decided, and they take the palette as an argument
 * so this module stays pure — a caller inside the React tree passes the
 * theme in force, and a caller outside it (a test, a row builder) gets the
 * dark default rather than nothing.
 */
export type DestinationPalette = Pick<AnnoKitPalette, "agent" | "team">;

export function destinationBadge(
  destination: SubmitDestination,
  palette: DestinationPalette = DARK_PALETTE,
): DestinationBadge {
  return destination === "comment"
    ? { label: "Team note", color: palette.team }
    : { label: "Agent task", color: palette.agent };
}

/** The separator between a kind prefix and the thing it names. One, everywhere. */
export const KIND_SEPARATOR = "·";

/** A title line that names its own kind: "Team note · FeedRow". */
export interface DestinationTitle {
  /** The kind, in the destination's colour. Never truncated. */
  prefix: string;
  separator: string;
  /** The thing itself. This is what ellipsizes when the line is too long. */
  title: string;
  color: string;
  /** One sentence, so a screen reader hears a phrase and not two fragments. */
  accessibilityLabel: string;
}

/**
 * THE KIND, INLINE WITH THE TITLE, instead of stacked above it.
 *
 * It used to be its own row — a coloured dot and an uppercase label on the
 * line under the title — which spent a whole line of a bottom sheet saying
 * one word (product owner). As a prefix it costs no vertical space and still
 * reads at a glance, because the colour rides on the prefix itself.
 *
 * WHAT TRUNCATES IS THE TITLE. The prefix is the part a reader cannot
 * reconstruct from context, so it is fixed; the element name is the part
 * they are already looking at, so it is the part that ellipsizes. A line
 * that clipped to "Team no…" would have thrown away the only word it added.
 */
export function destinationTitle(
  destination: SubmitDestination,
  title: string,
  palette: DestinationPalette = DARK_PALETTE,
): DestinationTitle {
  const badge = destinationBadge(destination, palette);
  const name = title.trim();
  return {
    prefix: badge.label,
    separator: KIND_SEPARATOR,
    title: name,
    color: badge.color,
    accessibilityLabel: name ? `${badge.label}: ${name}` : badge.label,
  };
}
