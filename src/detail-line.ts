/**
 * THE ONE MUTED LINE UNDER A DETAIL PANE'S TITLE — where this thing lives.
 *
 * WHY THIS EXISTS. The detail header had grown three stacked lines of chrome
 * before any content: the element name as a big title, a badge row naming the
 * kind, and a meta line that opened with the element name AGAIN and ended in a
 * bare "/" (product owner, with a screenshot: "it's not obvious what's
 * happening or what the text means"). Every one of those is a real problem:
 *
 *   · "FeedRow / FeedRow · /" says the element twice and the route in a way
 *     no reader recognises as a route;
 *   · the element name is not a TITLE — it answers "what did I tap", not
 *     "what am I looking at", so the sheet never said it was a discussion;
 *   · three lines of chrome on a sheet capped at 80% of a phone is a lot of
 *     screen spent saying very little.
 *
 * So the header is two lines: the KIND and the element together
 * (`destinationTitle`, which makes the sheet self-describing), and then this
 * — where it came from, in the terms a developer actually uses: the source
 * file and line, then the screen. The element name does not appear here at
 * all; it is already directly above.
 *
 * Pure, and separated from the components, because "what does the header say
 * when the server sent no source, or no route, or neither" is four cases that
 * are trivial to get wrong and invisible until someone opens the one note the
 * server was missing a field for.
 */

/** The pathname a router-less host, or a routeless capture, reports. */
const NO_ROUTE = "";

/**
 * A route as a person reads it.
 *
 * "/" IS THE PROBLEM THIS SOLVES. Rendered literally it is a single slash —
 * indistinguishable from a stray separator, which is exactly how it read in
 * the header the owner sent. Every other pathname already looks like what it
 * is ("/settings" is obviously a screen), so only the root is translated, and
 * it is translated to the word every app already calls it.
 *
 * ONE CONVENTION, EVERYWHERE. The notes list, its route headings and both
 * detail panes all render routes through here, so the root is never "/" in
 * one place and "Home" in another.
 */
export function routeDisplay(routeName: string | null | undefined): string {
  const value = typeof routeName === "string" ? routeName.trim() : NO_ROUTE;
  if (!value) return NO_ROUTE;
  return value === "/" ? "Home" : value;
}

/** Where a capture came from, as the server recorded it. */
export interface DetailOrigin {
  source?: { file: string; line: number } | null;
  routeName?: string | null;
}

/** "app/src/components/FeedRow.tsx:9 · Home", or as much of it as exists. */
export function sourceRef(source: DetailOrigin["source"]): string {
  if (!source || typeof source.file !== "string" || !source.file.trim()) return "";
  const file = source.file.trim();
  return Number.isFinite(source.line) ? `${file}:${source.line}` : file;
}

/**
 * The context line, or "" when there is nothing to say.
 *
 * EMPTY MEANS DRAW NOTHING. With no source and no route the old header still
 * rendered its separator, which is a line of punctuation explaining itself.
 * The callers check for "" and omit the whole Text.
 */
export function detailContextLine(origin: DetailOrigin): string {
  return [sourceRef(origin.source), routeDisplay(origin.routeName)]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The same line as a sentence, for the screen reader that has just heard the
 * title. Fragments joined by a middle dot read as noise aloud.
 */
export function detailContextLabel(origin: DetailOrigin): string {
  const parts: string[] = [];
  const ref = sourceRef(origin.source);
  const route = routeDisplay(origin.routeName);
  if (ref) parts.push(`from ${ref}`);
  if (route) parts.push(`on ${route}`);
  return parts.join(", ");
}
