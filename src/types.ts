import type { AnnotationReference } from "./attachments";
import type { InspectorHit } from "./inspector";
import type { ThreadMessage } from "./thread";

/** A captured tap awaiting composition. */
export interface PendingCapture {
  /** Tap point, window coordinates. */
  x: number;
  y: number;
  /** Inspector identity (null when the hit-test found nothing). */
  hit: InspectorHit | null;
  /**
   * Further elements banked via multi-select ("Add another"), in banking
   * order. The primary element stays `hit` — markers, push geometry and the
   * identity line all keep reading one element; these ride into the
   * payload's `elements[]` (src/payload.ts).
   */
  extraHits?: InspectorHit[];
  /**
   * The drawn rectangle of an AREA capture (src/area.ts), window
   * coordinates. When present it IS the annotation's boundingBox — the
   * region is the subject; `hit`/`extraHits` are the components sampled
   * inside it (hit may be null: an area over empty space is the point).
   */
  areaRect?: { x: number; y: number; width: number; height: number };
  /** Route at capture time. */
  routeName: string | null;
  /**
   * Whether a screenshot COULD be taken for this capture: the peer resolved,
   * the host has not switched screenshots off, and the server has a route
   * for one. Says nothing about whether one has been taken — that is
   * `screenshotUri`. The composer draws its switch from this, because the
   * shot is now taken when the switch goes on, not before the sheet opens.
   */
  canScreenshot?: boolean;
  /**
   * The screenshot temp URI, once one has been taken. Null until the user
   * asks for one (or a headless host calls `captureScreenshot`) — capture
   * follows the choice rather than preceding it.
   */
  screenshotUri: string | null;
  /**
   * The client id the agent task will be created under. Minted once, when
   * the capture is made, so every retry of the same capture posts the SAME
   * id and a server that stored a timed-out attempt sees a repeat rather
   * than a second task. Optional for host-built captures: src/submit.ts
   * mints one per capture object when it is absent.
   */
  id?: string;
}

/** Server-side annotation as returned by the pending/list routes. */
export interface ServerAnnotation {
  id: string;
  comment?: string;
  content?: string;
  text?: string;
  element?: string;
  /**
   * The captured element's testID, when the server kept what was sent.
   * Re-anchoring reads it to find the element again after a reload
   * (src/reanchor.ts) — without it an anchorless mark stays hidden.
   */
  testID?: string;
  /**
   * Where the element is written, when the server kept what was sent. The
   * detail header shows it: "app/src/FeedRow.tsx:9" is the one piece of
   * context a developer opening a task actually navigates by.
   */
  source?: { file: string; line: number } | null;
  x?: number;
  y?: number;
  /**
   * The captured element's frame in window coordinates, as it was at
   * capture time (protocol v1 sends it; a server that keeps it hands it
   * back). Read by push mode in the detail pane, which uses it to lift the
   * app until this rectangle clears the sheet — and refuses to move at all
   * when it is absent or cannot belong to the current window (src/push.ts).
   */
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
  routeName?: string;
  /**
   * Owning-scroll-container offset at capture, when the server kept what
   * was sent. Its presence WITH a tag (or a non-zero offset) is how the
   * marker layer knows this mark lived inside a scrollable — and therefore
   * that its stored window coordinates cannot be trusted without a live
   * re-measure anchor (src/anchor-registry.ts, markerPositionTrusted).
   */
  scroll?: { scrollViewTag?: number; offsetY?: number; offsetX?: number } | null;
  status?: string;
  /**
   * What the agent is doing right now, in one short line ("Editing
   * app/Button.tsx"), while `status` is `working`. Optional and additive
   * (docs/protocol.md, *Annotations*): the overlay shows it under the
   * banner, in the queue and in the detail pane, and ignores it otherwise.
   */
  progress?: string;
  /**
   * When a human reply last put this task back into `pending` — the server's
   * answer to "reply to refine" (docs/protocol.md, *Reopening a task*). Additive:
   * `status` is still just `pending`, so nothing has to understand this
   * field; the overlay reads it only to show a reopened task differently
   * from one that has never been sent.
   */
  reopenedAt?: string;
  /** How many times that has happened. Absent = never. */
  reopenCount?: number;
  platform?: string;
  /** Attached context (assets, data APIs, screenshots). Server-maintained. */
  references?: AnnotationReference[];
  /** Follow-up conversation; absent until the first reply is posted. */
  thread?: ThreadMessage[];
  /** Server-stamped ISO creation time, when the server keeps one. */
  createdAt?: string;
  /** Epoch-ms fallback some servers stamp instead of `createdAt`. */
  timestamp?: number;
  /** The team note this task was made from, when it came from one. */
  sourceCommentId?: string;
  /**
   * The note's messages this task quotes (protocol-v1 additive). It is what
   * lets the discussion draw a back-link on the exact bubbles that spawned
   * a task; absent on older tasks and on servers that do not persist it, in
   * which case the bubble degrades to a plain mark (src/message-task.ts).
   */
  sourceMessageIds?: string[];
  /** Server-stamped ISO time of the last change, when the server keeps one. */
  updatedAt?: string;
  /**
   * Every time an agent worked on this task, oldest first (src/runs.ts,
   * docs/protocol.md *Run history*). Optional; read with `readRuns`.
   */
  runs?: unknown;
}
