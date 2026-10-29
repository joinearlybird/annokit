/**
 * Bounds on user- and server-controlled content.
 *
 * WHOSE JOB THIS IS: the server's, ultimately. Nothing here is a security
 * control — a client limit is trivially bypassed by anything that is not
 * this client, and the protocol requires servers to enforce their own
 * (docs/audit/high-priority-security-privacy.md, "Specify server-side
 * validation obligations"). These exist for the two things a client CAN
 * own: telling the user before they lose work, and refusing to let a
 * hostile or broken server grow the overlay's memory without limit.
 *
 * The numbers are deliberately generous. A change request is a sentence or
 * two; four thousand characters is far more than anyone types, and the
 * point of the cap is that it EXISTS, not that it pinches.
 */

/** An annotation's change request, and a thread or comment reply. */
export const TEXT_MAX = 4_000;

/** A name typed into the identity prompt or sent as an author hint. */
export const AUTHOR_NAME_MAX = 80;

/** References (attachments) one annotation may carry. */
export const REFERENCES_MAX = 20;

/** Items one attachment source may contribute to the picker. */
export const ATTACHMENT_ITEMS_MAX = 200;

/** Any single string inside a server-supplied item or reference. */
export const FIELD_MAX = 2_000;

/**
 * Cut a string to `max` characters, counting by code POINT rather than
 * code unit so a surrogate pair is never split into a lone half — which is
 * how a truncated emoji becomes an unpaired surrogate and, downstream, a
 * JSON encoding error or a replacement character.
 */
export function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  return Array.from(value).slice(0, max).join("");
}

/**
 * The first `max` items of a list. Returns the SAME array when nothing is
 * dropped, so callers can keep their identity checks and re-renders.
 */
export function clampList<T>(items: readonly T[], max: number): readonly T[] {
  return items.length <= max ? items : items.slice(0, max);
}

/** Is this within bounds? For callers that must reject rather than trim. */
export function withinLimit(value: string, max: number): boolean {
  return Array.from(value).length <= max;
}
