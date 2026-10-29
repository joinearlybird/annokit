/**
 * Annotation payload construction — the wire contract of the AnnoKit
 * Protocol v1 (`POST {endpoint}/sessions/{sid}/annotations`).
 *
 * Kept out of the composer component so the exact body shape is unit
 * testable without rendering the RN tree: this object is what the server
 * validates, so drift here is a protocol break (see README.md).
 */

import type { AnnotationReference } from "./attachments";
import type { InspectorHit } from "./inspector";
import type { OutputDetail } from "./prefs";
import type { PendingCapture } from "./types";

export interface AnnotationBody {
  /** Client-generated UUID (so screenshot upload can race the response). */
  id: string;
  comment: string;
  /** v1 clients send feedback only. */
  kind: "feedback";
  /** Capture surface; absent/"web" means a DOM capture client. */
  platform: "native";
  element: string;
  /** Root→leaf user-component chain, framework internals filtered. */
  componentStack: string[];
  source?: { file: string; line: number };
  testID?: string;
  routeName?: string;
  x: number;
  y: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
  /**
   * Flattened style of the touched view, as compact JSON. The wire name is
   * the one the server has stored since the WEB overlay's schema
   * (`StoredAnnotation.computedStyles`, a string there too) — reusing it
   * means zero server changes and one field name for agents to learn.
   */
  computedStyles?: string;
  /** Accessibility identity ({label, role, hint, state}) as compact JSON — same reuse story. */
  accessibility?: string;
  /**
   * Owning scroll container offset at capture time — window coordinates
   * have no document scroll on native, so this is what lets a consumer
   * reconcile `y` on a scrolled screen. `{ offsetY: 0 }` when the touched
   * node has no scroll ancestor or the offset was unreadable (src/scroll.ts
   * never guesses). `offsetX` rides along only when non-zero.
   */
  scroll: { scrollViewTag?: number; offsetY: number; offsetX?: number };
  /**
   * True when the annotation covers more than one element (multi-select
   * banking). Wire name shared with the web overlay's schema
   * (`StoredAnnotation.isMultiSelect`).
   */
  isMultiSelect?: boolean;
  /**
   * EVERY covered element, primary first, when `isMultiSelect` — each entry
   * a full per-element identity, so the agent addresses "make these match"
   * without guessing which views "these" are. Absent for the single-element
   * annotation everyone sends most of the time: the top-level fields
   * already carry it, and repeating them as a one-entry list would make
   * every consumer handle two shapes.
   */
  elements?: AnnotationElement[];
  /**
   * Attached context picked in the composer's attach panel (assets, data
   * APIs). OMITTED when nothing was attached — an empty array would read as
   * "the user cleared the references" to a server that PATCHes them.
   * The screenshot reference is not built here: the server appends
   * `{type:"screenshot"}` itself when the multipart upload lands.
   */
  references?: AnnotationReference[];
  /**
   * The agent this task should run on, chosen in the composer or Settings
   * → Agent (docs/protocol.md, *Agent*). Absent: the server's current one.
   * Model and effort absent: that agent's defaults.
   */
  agent?: { id: string; model?: string; effort?: string };
}

/** One element of a multi-select annotation — the per-element identity slice. */
export interface AnnotationElement {
  element: string;
  componentStack: string[];
  source?: { file: string; line: number };
  testID?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
}

/** The identity slice of a hit, as one `elements[]` entry. */
function elementFromHit(hit: InspectorHit): AnnotationElement {
  return {
    element: hit.element,
    componentStack: hit.componentStack,
    source: hit.source,
    testID: hit.testID,
    boundingBox: { x: hit.frame.x, y: hit.frame.y, width: hit.frame.width, height: hit.frame.height },
    nearbyText: hit.nearbyText,
  };
}

/** JSON for the wire's string fields; undefined for empty/unserializable. */
function safeJson(value: object | undefined): string | undefined {
  if (!value || Object.keys(value).length === 0) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** Build the protocol-v1 native annotation body for a captured tap. */
export function buildAnnotationBody(
  capture: PendingCapture,
  comment: string,
  annotationId: string,
  references?: AnnotationReference[],
): AnnotationBody {
  const hit = capture.hit;
  // Multi-select: primary hit + banked extras become `elements[]`. A
  // primary-less multi capture cannot happen (banking requires a hit), so
  // extras without a hit are dropped rather than promoted.
  const extras = hit ? (capture.extraHits ?? []) : [];
  const multi = extras.length > 0;
  return {
    id: annotationId,
    comment,
    kind: "feedback",
    platform: "native",
    // An area over empty space has no element — "Area" is the honest name
    // (the boundingBox carries the region); "Screen" stays the tap-found-
    // nothing fallback.
    element: hit?.element ?? (capture.areaRect ? "Area" : "Screen"),
    componentStack: hit?.componentStack ?? [],
    source: hit?.source,
    testID: hit?.testID,
    routeName: capture.routeName ?? undefined,
    x: capture.x,
    y: capture.y,
    // An area capture's box is the DRAWN RECTANGLE — the region is the
    // subject, whatever was sampled inside it.
    boundingBox: capture.areaRect
      ? capture.areaRect
      : hit
        ? { x: hit.frame.x, y: hit.frame.y, width: hit.frame.width, height: hit.frame.height }
        : { x: capture.x, y: capture.y, width: 0, height: 0 },
    nearbyText: hit?.nearbyText,
    computedStyles: safeJson(hit?.styles),
    accessibility: safeJson(hit?.accessibility),
    scroll: hit?.scroll ?? { offsetY: 0 },
    isMultiSelect: multi || undefined,
    elements: multi && hit ? [hit, ...extras].map(elementFromHit) : undefined,
    references: references && references.length > 0 ? references : undefined,
  };
}

/**
 * HOW MUCH OF IT ACTUALLY GOES, per the Output Detail preference
 * (src/prefs.ts).
 *
 * The body above is what the overlay CAN see. Not everyone wants all of it
 * leaving their app, and a payload full of component stacks is noise to an
 * agent that only needed a route and a sentence — so this trims the
 * OPTIONAL context, in one place, on the way out.
 *
 * WHAT SURVIVES AT EVERY LEVEL, and is therefore never a choice: the id,
 * the words, the kind and platform, the route, the position, the bounding
 * box, the scroll offset and the attachments. Those are what makes the task
 * a task — an annotation nobody can locate is not a lighter annotation, it
 * is a broken one. `element` stays too: it is the label the marker, the
 * queue row and the detail header all read.
 *
 *   MINIMAL  — the above, and nothing else. No source file, no testID, no
 *              component stack, no nearby text.
 *   STANDARD — plus `source`, `testID` and `nearbyText`. The default.
 *   FULL     — plus `componentStack`, `computedStyles` and `accessibility`:
 *              appearance context. Styles ride here and not at STANDARD
 *              because they are the most app-revealing field this overlay
 *              captures, and the trim levels exist for exactly that judgment.
 *
 * WHY `nearbyText` IS AT STANDARD. `source` points at where a component is
 * DEFINED, and a reusable component gets its words from where it is USED:
 * `PrimaryButton.tsx` holds `{label}`, while "Save changes" sits at the call
 * site the agent is never told about. The rendered text is what says WHICH
 * button was meant, and it is a search key that lands on the one line to
 * edit — for runtime text (`{user.name}`, a price) it is the only record of
 * what was on screen at all. It used to ride only at FULL, with a composer
 * picker that let the user quote a slice of it at any level; that made the
 * most useful field depend on remembering an extra step, so the picker is
 * gone and the text goes by default. It is ON-SCREEN CONTENT, which is why
 * MINIMAL still strips it: that level is the one to choose when what is on
 * screen should stay on the device.
 *
 * `componentStack` is REQUIRED by the protocol, so the trimmed levels send
 * it empty rather than omitting it — an empty chain is the honest "we did
 * not send one", and a server reading it as "no user components were
 * found" is reading it the way a screen with none would have written it.
 */
export function applyOutputDetail(body: AnnotationBody, detail: OutputDetail): AnnotationBody {
  if (detail === "full") return body;
  // The same judgment, per element: what a level hides about THE element it
  // must hide about EVERY element, or multi-select becomes the leak.
  // `element` and `boundingBox` always stay — they are what makes each
  // entry addressable at all (and `isMultiSelect` without its elements
  // would be a count with no members).
  const trimElement = (e: AnnotationElement): AnnotationElement => ({
    ...e,
    componentStack: [],
    ...(detail === "minimal" ? { nearbyText: undefined, source: undefined, testID: undefined } : {}),
  });
  const trimmed: AnnotationBody = {
    ...body,
    componentStack: [],
    computedStyles: undefined,
    accessibility: undefined,
    elements: body.elements?.map(trimElement),
  };
  if (detail === "standard") return trimmed;
  return { ...trimmed, nearbyText: undefined, source: undefined, testID: undefined };
}
