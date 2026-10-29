/**
 * The HEADLESS SEAM's decision, as pure functions — what happens the moment
 * a capture is ready: hand it to the host's `onCapture`, or open the
 * built-in composer.
 *
 * Extracted from the provider (src/index.tsx keeps only the JSX plumbing:
 * clear-the-aim on "handled", setCapture on "open-composer") so the two
 * behaviors that would otherwise only be testable with a component renderer
 * — the falsy passthrough and the helper wiring — are ordinary unit tests,
 * in keeping with the package's pure-modules-plus-device-verification
 * discipline.
 *
 * FAIL-SOFT RULE: a host callback that THROWS is treated as "not handled"
 * (warn + open the composer). The alternative — letting the throw ride up
 * into the capture pipeline — would silently swallow the user's capture to
 * punish the host's bug, which is backwards.
 */

import type { AttachmentSource } from "./attachments";
import { submitBlockedReason } from "./destination";
import { releaseScreenshot } from "./screenshot";
import { buildCaptureBody, submitAgentCapture, submitCommentCapture } from "./submit";
import type { AgentSubmitOptions, CommentSubmitOptions } from "./submit";
import type { AnnotationBody } from "./payload";
import type { AnnoKitTransport } from "./transport";
import type { PendingCapture } from "./types";

// The public shapes live here (index.tsx re-exports them) so this module
// has no import back into the provider.

/** What `onCapture` receives beside the capture itself. */
export interface CaptureHelpers {
  /** The exact protocol-v1 body `submitAgent` would send (own-backend hosts). */
  buildBody: (comment: string, options?: AgentSubmitOptions) => AnnotationBody;
  /** Create the agent task through the package's transport. Resolves to the final id or null. */
  submitAgent: (comment: string, options?: AgentSubmitOptions) => Promise<string | null>;
  /**
   * Post a team note. Resolves to the comment id or null.
   *
   * `options.attachScreenshot` uploads the capture to the note, the same
   * way the agent half does — pass it only when you have actually taken
   * one (`captureScreenshot`).
   */
  submitComment: (
    comment: string,
    authorName?: string | null,
    options?: CommentSubmitOptions,
  ) => Promise<string | null>;
  /** Clear the aim without posting anything. */
  dismiss: () => void;
  /**
   * Take the screenshot NOW, and resolve to its URI (null if it could not
   * be taken). Capture follows the choice: nothing is written to disk until
   * something asks, so a host rendering its own UI must ask before
   * `submitAgent({ attachScreenshot: true })` has anything to send.
   *
   * The package hides its own chrome for a beat while the shot is taken.
   * Hide yours too if it is covering the screen — otherwise the evidence is
   * your sheet rather than the app under it.
   */
  captureScreenshot: () => Promise<string | null>;
  /**
   * Delete this capture's screenshot temp file.
   *
   * OWNERSHIP: while a host holds the capture it holds the file too. Both
   * submit helpers above release it for you, and so does `dismiss` — this
   * is for the host that takes the capture somewhere else entirely (its
   * own backend via `buildBody`, its own upload) and is finished with it.
   * Safe to call twice, or not at all on web (src/screenshot.ts).
   */
  releaseScreenshot: () => void;
}

/**
 * A host's own composer. Called at the moment the built-in sheet would
 * open (aim confirmed, screenshot — when available — already taken).
 * Return TRUTHY to take over: the aim clears and no sheet opens. Return
 * falsy to let the built-in flow proceed (which also makes this a passive
 * tap into the capture pipeline).
 */
export type OnCapture = (capture: PendingCapture, helpers: CaptureHelpers) => boolean | void;

/** What the helpers need from the provider. */
export interface CaptureFlowDeps {
  transport: AnnoKitTransport;
  /** The EFFECTIVE session id (server-assigned in agentation compat). */
  sessionId: string;
  /** Successful agent submit — the provider refreshes its pending list. */
  onAgentSubmitted: () => void;
  /** Successful comment submit — the provider refreshes its notes. */
  onCommentSubmitted: () => void;
  /** The aim-clearing dismiss. */
  dismiss: () => void;
  /** Take the screenshot on demand (src/index.tsx captureScreenshotNow). */
  captureScreenshot: () => Promise<string | null>;
}

/**
 * The helpers a host receives: thin bindings over the ONE submit path
 * (src/submit.ts), plus the provider's refresh notifications — success
 * refreshes, failure does not (the host keeps its sheet and the words).
 */
export function buildCaptureHelpers(
  capture: PendingCapture,
  deps: CaptureFlowDeps,
): CaptureHelpers {
  // THE CAPTURE AS IT IS NOW, not as it was handed over. A screenshot is
  // taken after the capture exists, so the helpers have to see it land:
  // reading the original object meant `submitAgent({ attachScreenshot })`
  // always found `screenshotUri: null` and silently sent without one —
  // including a tier-2 handler that awaits captureScreenshot() and then
  // submits through the same, pre-screenshot props.
  let current = capture;
  const ctx = () => ({ transport: deps.transport, sessionId: deps.sessionId, capture: current });
  return {
    buildBody: (comment, options) => buildCaptureBody(current, comment, options),
    submitAgent: async (comment, options) => {
      const id = await submitAgentCapture(ctx(), comment, options);
      if (id) deps.onAgentSubmitted();
      return id;
    },
    submitComment: async (comment, authorName, options) => {
      const id = await submitCommentCapture(ctx(), comment, authorName, options);
      if (id) deps.onCommentSubmitted();
      return id;
    },
    dismiss: () => {
      // Dismissal is an exit: the capture is not going anywhere.
      releaseScreenshot(current.screenshotUri);
      deps.dismiss();
    },
    captureScreenshot: async () => {
      // A server with no screenshot route (agentation compat) or a host
      // that switched screenshots off: nothing would ever upload it.
      if (current.canScreenshot === false) return null;
      const uri = await deps.captureScreenshot();
      if (!uri) return null;
      // A second shot replaces the first, which was never uploaded.
      if (current.screenshotUri && current.screenshotUri !== uri) {
        releaseScreenshot(current.screenshotUri);
      }
      current = { ...current, screenshotUri: uri };
      return uri;
    },
    releaseScreenshot: () => releaseScreenshot(current.screenshotUri),
  };
}

/**
 * The decision. "handled" ⇒ the caller clears the aim and stops;
 * "open-composer" ⇒ the built-in sheet opens as if no hook existed.
 */
export function resolveCaptureHandling(
  onCapture: OnCapture | undefined,
  capture: PendingCapture,
  helpers: CaptureHelpers,
): "handled" | "open-composer" {
  if (!onCapture) return "open-composer";
  try {
    return onCapture(capture, helpers) ? "handled" : "open-composer";
  } catch (e) {
    console.warn("[annokit] onCapture threw — opening the built-in composer:", e);
    return "open-composer";
  }
}

// ── Tier 2: the composer SLOT ───────────────────────────────────────────────
//
// `renderComposer` replaces the built-in sheet wholesale while the package
// keeps running everything around it — capture, markers, queue, panes. The
// props hand the host the DECISIONS, not just callbacks: whether comments
// can exist here at all (and the sentence saying why not), submits that
// close the flow on success and leave the host's sheet standing on failure,
// and the same wire helpers tier 1 exposes.

/** What a replaced composer receives. */
export interface ComposerSlotProps {
  capture: PendingCapture;
  /** False when this server has no comment routes — disable that commit. */
  canComment: boolean;
  /** The user-facing sentence for canComment === false, else null. */
  commentsUnavailableReason: string | null;
  /**
   * Create the agent task. ON SUCCESS the package closes the flow (aim +
   * capture state) and refreshes its lists — resolve means "done, sheet
   * gone". Null means failure: nothing closed, keep the user's words.
   */
  submitAgent: (comment: string, options?: AgentSubmitOptions) => Promise<string | null>;
  /** Post a team note; same close-on-success contract. */
  submitComment: (
    comment: string,
    authorName?: string | null,
    options?: CommentSubmitOptions,
  ) => Promise<string | null>;
  /** The protocol body, for own-backend hosts (no network, no close). */
  buildBody: (comment: string, options?: AgentSubmitOptions) => AnnotationBody;
  /** Close without posting — the sheet's Cancel/backdrop. Releases the screenshot. */
  dismiss: () => void;
  /** Delete this capture's screenshot temp file (see CaptureHelpers). */
  releaseScreenshot: () => void;
  /** Take the screenshot on demand (see CaptureHelpers). */
  captureScreenshot: () => Promise<string | null>;
  /** The attach-panel sources in force (built-in assets + host extras). */
  attachmentSources: AttachmentSource[];
}

/** What the slot needs from the provider beyond the tier-1 deps. */
export interface ComposerSlotDeps extends CaptureFlowDeps {
  /** Server capability, as the provider tracks it. */
  commentsAvailable: boolean;
  /** Close the flow: clear the capture state AND the aim. */
  close: () => void;
  attachmentSources: AttachmentSource[];
}

export function buildComposerSlotProps(
  capture: PendingCapture,
  deps: ComposerSlotDeps,
): ComposerSlotProps {
  const helpers = buildCaptureHelpers(capture, deps);
  return {
    capture,
    canComment: deps.commentsAvailable,
    commentsUnavailableReason: submitBlockedReason("comment", {
      // The reason is about SERVER capability, not about what the host's
      // input currently holds — probe with non-empty text so the only
      // possible answer is the capability one.
      text: "x",
      commentsAvailable: deps.commentsAvailable,
    }),
    submitAgent: async (comment, options) => {
      const id = await helpers.submitAgent(comment, options);
      if (id) deps.close();
      return id;
    },
    submitComment: async (comment, authorName, options) => {
      const id = await helpers.submitComment(comment, authorName, options);
      if (id) deps.close();
      return id;
    },
    buildBody: helpers.buildBody,
    dismiss: () => {
      helpers.releaseScreenshot();
      deps.close();
    },
    releaseScreenshot: helpers.releaseScreenshot,
    captureScreenshot: helpers.captureScreenshot,
    attachmentSources: deps.attachmentSources,
  };
}
