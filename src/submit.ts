/**
 * THE ONE SUBMIT PATH for a composed capture — shared by the built-in
 * composer and by headless hosts (the `onCapture` helpers), so the two can
 * never drift on the parts that are easy to fork and painful to debug:
 *
 *   agent  — protocol-v1 body build → Output-Detail trim → agentation-compat
 *            mapping (src/agentation.ts) → POST → THE RESPONSE ID IS THE ID
 *            (our server echoes the client id; agentation's assigns its own)
 *            → scroll-anchor registration → optional screenshot upload.
 *   comment — POST /comments (server-signed author, no attachments, no
 *            client id) → scroll-anchor registration.
 *
 * Pure-ish on purpose: everything here takes an explicit context (transport
 * + effective session id + the capture) and returns the final id or null —
 * no React, no state, no refresh side-effects. Callers own "what happens
 * after" (the composer closes a sheet; a headless host closes its own).
 */

import { serverFlavor, toAgentationAnnotation } from "./agentation";
import { registerScrollAnchor } from "./anchor-registry";
import { commentScreenshotPath, createComment } from "./comments";
import { annoKitPreferences } from "./prefs";
import type { OutputDetail } from "./prefs";
import { applyOutputDetail, buildAnnotationBody } from "./payload";
import type { AnnotationBody } from "./payload";
import type { AnnotationReference } from "./attachments";
import type { AgentRun } from "./agent-config";
import { buildScreenshotPart, releaseScreenshot } from "./screenshot";
import { annotationScreenshotPath, sessionAnnotationsPath } from "./url";
import { makeId } from "./transport";
import type { AnnoKitTransport } from "./transport";
import type { PendingCapture } from "./types";

/** What every submit needs to know. */
export interface SubmitCaptureContext {
  transport: AnnoKitTransport;
  /** The EFFECTIVE session id (server-assigned in agentation compat). */
  sessionId: string;
  capture: PendingCapture;
}

export interface AgentSubmitOptions {
  /** Attached context (`references[]`); omitted when empty. */
  references?: AnnotationReference[];
  /**
   * Upload `capture.screenshotUri` after the create. Default false — the
   * shot is opt-in everywhere (SCREENSHOT_ATTACHED_BY_DEFAULT).
   */
  attachScreenshot?: boolean;
  /** Trim level. Default: the session's Output Detail preference. */
  outputDetail?: OutputDetail;
  /**
   * The agent, model and effort this task asks for (src/agent-config.ts).
   * Omitted: the server runs it on its current agent.
   */
  agent?: AgentRun | null;
}

/**
 * What a TEAM NOTE submit may carry beyond its text.
 *
 * Only the screenshot: picked references stay with agent tasks, because a
 * reference is context for something that will act on it. A picture is
 * context for a person, which is what a note is for.
 */
export interface CommentSubmitOptions {
  attachScreenshot?: boolean;
  /** Pasted images, already uploaded as assets (src/paste.ts). */
  references?: AnnotationReference[];
}

// Host-built captures may arrive without an id. One is minted per capture
// OBJECT, so retrying the same object still repeats it.
const mintedIds = new WeakMap<PendingCapture, string>();

/** The id this capture is created under — the same on every attempt. */
function captureClientId(capture: PendingCapture): string {
  if (capture.id) return capture.id;
  let id = mintedIds.get(capture);
  if (!id) {
    id = makeId();
    mintedIds.set(capture, id);
  }
  return id;
}

/**
 * The protocol-v1 body for this capture, trimmed to the given (or session)
 * Output Detail — the exact body `submitAgentCapture` would send. Exposed
 * so a host with its OWN backend can still speak the wire format.
 */
export function buildCaptureBody(
  capture: PendingCapture,
  comment: string,
  options: AgentSubmitOptions = {},
): AnnotationBody {
  const body = applyOutputDetail(
    buildAnnotationBody(capture, comment.trim(), captureClientId(capture), options.references),
    options.outputDetail ?? annoKitPreferences().outputDetail,
  );
  // Not detail: which agent runs the task is not context about the element,
  // so no Output Detail level trims it.
  const run = options.agent;
  if (!run) return body;
  return {
    ...body,
    agent: { id: run.agent, ...(run.model ? { model: run.model } : {}), ...(run.effort ? { effort: run.effort } : {}) },
  };
}

/**
 * Create the agent task. Returns the FINAL id (the response's — see the
 * header) or null when the POST failed; the scroll anchor is registered so
 * the marker the pending list will draw can re-anchor immediately.
 */
export async function submitAgentCapture(
  ctx: SubmitCaptureContext,
  comment: string,
  options: AgentSubmitOptions = {},
): Promise<string | null> {
  const body = buildCaptureBody(ctx.capture, comment, options);
  // Compat mapping AFTER the trim, so the user's Output Detail preference
  // governs both wire shapes the same way.
  const wireBody =
    serverFlavor() === "agentation" ? toAgentationAnnotation(body, Date.now()) : body;
  const { status, data: res } = await ctx.transport.postJsonAt<{ id?: unknown }>(
    sessionAnnotationsPath(ctx.sessionId),
    wireBody,
  );
  // Created is decided by the STATUS. A server may answer 201 or 204 with
  // no body; treating that as failure kept the sheet open and invited the
  // retry that used to create a second task.
  if (status < 200 || status >= 300) return null;
  const finalId = res && typeof res.id === "string" && res.id ? res.id : body.id;
  registerScrollAnchor(finalId, ctx.capture);
  if (options.attachScreenshot && ctx.capture.screenshotUri) {
    // Native: the RN {uri, name, type} part. Web: a real Blob, because the
    // browser's FormData stringifies that object (see screenshot.ts).
    const part = await buildScreenshotPart(ctx.capture.screenshotUri);
    if (part) {
      const form = new FormData();
      form.append("file", part as unknown as Blob);
      await ctx.transport.postForm(annotationScreenshotPath(finalId), form);
    }
  }
  // The capture has been used, or was never going to be: either way the
  // temp file's job is done. AFTER the upload, and regardless of whether
  // it succeeded — a failed upload does not earn the file a second life,
  // since nothing retries it (screenshot.ts LIFECYCLE).
  releaseScreenshot(ctx.capture.screenshotUri);
  return finalId;
}

/**
 * Post the capture as a TEAM NOTE. Returns the created comment's id or
 * null. Comments carry no client id, no attachments, and the author is
 * resolved server-side (the optional name is the prompt-tier hint).
 */
export async function submitCommentCapture(
  ctx: SubmitCaptureContext,
  comment: string,
  authorName?: string | null,
  options: CommentSubmitOptions = {},
): Promise<string | null> {
  const created = await createComment(ctx.transport, ctx.capture, comment.trim(), authorName, options.references);
  if (!created) return null;
  // The note's marker sticks to scrolled content like a task's does.
  registerScrollAnchor(created.id, ctx.capture);
  if (options.attachScreenshot && ctx.capture.screenshotUri) {
    // The same upload the agent half does, at the note's own route. A
    // server without it answers 404 and the note stands: the picture is a
    // follow-up to something already saved, never a condition of it.
    const part = await buildScreenshotPart(ctx.capture.screenshotUri);
    if (part) {
      const form = new FormData();
      form.append("file", part as unknown as Blob);
      await ctx.transport.postForm(commentScreenshotPath(created.id), form);
    }
  }
  // Used, or never going to be: either way the temp file's job is done and
  // the flow closes on success. (On FAILURE both submit paths keep the
  // file: the sheet stays open with the user's words, and a retry still
  // needs its screenshot. The eventual dismissal releases it.)
  releaseScreenshot(ctx.capture.screenshotUri);
  return created.id;
}
