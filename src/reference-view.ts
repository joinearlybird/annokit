/**
 * How an attached reference is SHOWN on a task or a note.
 *
 * The panes used to render every reference as one line of text —
 * `screenshot: https://…presigned…` — which is the least useful possible
 * rendering of a picture: a URL nobody can read, of the one attachment
 * whose entire value is being looked at.
 *
 * Pure, because "which of these is an image, and what do I call it" is a
 * decision worth testing without a component tree (docs/development.md: the
 * suite does not render the RN tree).
 */

import type { AnnotationReference } from "./attachments";

/**
 * A reference the pane should draw as a PICTURE rather than a line.
 *
 * Type first, because the protocol says what the type means and a URL is
 * not evidence of anything — an `asset` may also be a PNG, but it is a
 * pointer the agent embeds in code, not a thing to look at here.
 *
 * The value still has to be present and fetchable: the protocol grants a
 * `screenshot` as "a short-TTL presigned image URL", so a relative path or
 * a `file://` left over from a client that should not have sent one is not
 * something to put in an <Image>.
 */
export function isViewableScreenshot(reference: AnnotationReference): boolean {
  if (reference.type !== "screenshot") return false;
  const value = typeof reference.value === "string" ? reference.value.trim() : "";
  return /^https?:\/\//i.test(value);
}

/**
 * The one-line form, for everything that is not a picture.
 *
 * `label` when the server gave one — it is written for a human — and the
 * raw value only as a fallback, because a bare presigned URL or an API
 * pointer is at least identifiable by its type.
 */
export function referenceLine(reference: AnnotationReference): string {
  const label = typeof reference.label === "string" ? reference.label.trim() : "";
  const value = typeof reference.value === "string" ? reference.value.trim() : "";
  return `${reference.type}: ${label || value}`;
}

/**
 * The URL to DRAW a reference with, or null when it is not a picture: a
 * screenshot's own value, or an image asset's `preview` — a pasted or
 * picked image is looked at, the same as a screenshot, not read as a line.
 */
export function pictureUrl(reference: AnnotationReference): string | null {
  if (isViewableScreenshot(reference)) return reference.value.trim();
  if (reference.type !== "asset" || typeof reference.preview !== "string") return null;
  const preview = reference.preview.trim();
  return /^https?:\/\//i.test(preview) ? preview : null;
}

/** What a screen reader is told a picture thumbnail is. */
export function screenshotA11yLabel(reference: AnnotationReference): string {
  const label = typeof reference.label === "string" ? reference.label.trim() : "";
  const kind = reference.type === "asset" ? "Image" : "Screenshot";
  return label ? `${kind}: ${label}. Open it full size` : `${kind} — open it full size`;
}

/**
 * Split references into the ones to draw and the ones to list, preserving
 * server order within each. Pictures lead: they are the fastest thing to
 * read and the reason the rest is context.
 */
export function splitReferences(references: readonly AnnotationReference[] | undefined): {
  screenshots: AnnotationReference[];
  lines: AnnotationReference[];
} {
  const screenshots: AnnotationReference[] = [];
  const lines: AnnotationReference[] = [];
  for (const reference of references ?? []) {
    if (!reference || typeof reference.type !== "string") continue;
    if (pictureUrl(reference)) screenshots.push(reference);
    else lines.push(reference);
  }
  return { screenshots, lines };
}

/**
 * A reference the pane should let you OPEN, rather than only read.
 *
 * A worktree run puts its result somewhere the device cannot see — a
 * branch, or a pull request — so the one line naming it was a dead end:
 * the phone told you a diff existed and gave you no way to look at it. Any
 * non-screenshot reference carrying an http(s) value is something a browser
 * can render, which for a PR is the diff itself.
 *
 * Screenshots are excluded because they already have a better treatment
 * (they are drawn, and tapping opens the full-size viewer) — sending those
 * out to a browser would be a downgrade.
 */
export function isOpenableLink(reference: AnnotationReference): boolean {
  if (reference.type === "screenshot") return false;
  const value = typeof reference.value === "string" ? reference.value.trim() : "";
  return /^https?:\/\//i.test(value);
}

/** What a screen reader hears on a link it can follow. */
export function openableA11yLabel(reference: AnnotationReference): string {
  const label = typeof reference.label === "string" ? reference.label.trim() : "";
  return `Open ${label || reference.type} in your browser`;
}
