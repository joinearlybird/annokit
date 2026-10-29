/**
 * @joinearlybird/annokit — in-app annotation overlay for
 * app-builder React Native previews.
 *
 * Mount once around the app's root layout:
 *
 *   <AnnoKitProvider>{children}</AnnoKitProvider>
 *
 * Configuration is PROPS-FIRST ({endpoint, sessionId, token, enabled}) with
 * EXPO_PUBLIC_* env variables as fallback defaults (the Earlybird
 * platform's wiring convention — see src/env.ts and README.md). The
 * provider is a strict no-op (renders children only, zero overhead) unless
 * __DEV__ and an endpoint + sessionId resolve. On activation it GETs
 * {endpoint}/health once and disables itself with a console.warn when
 * protocolVersion !== 1 (fail loud in the dev log, never crash the app).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Animated, Easing, useWindowDimensions, View } from "react-native";
import { forgetServerFlavor, fromAgentationList, serverFlavor } from "./agentation";
import { fetchAgentConfig, forgetAgentRoute } from "./agent-config";
import type { AgentConfig } from "./agent-config";
import { clearScrollAnchors } from "./anchor-registry";
import { reanchorMarkers } from "./reanchor";
import {
  onAnnoKitEvent,
  startAnnoKitEventStream,
  streamLive as readStreamLive,
  subscribeToStreamLive,
} from "./events";
import { aimAnchorTarget, composerOccludedTop, createAimTracker } from "./aim";
import type { AimRect, AimSelection } from "./aim";
import {
  AnnoKitAim,
  AnnoKitAimConfirm,
  AnnoKitAreaBox,
  AnnoKitModeToggle,
} from "./aim-overlay";
import { areaLabel, areaRectFrom, areaSamplePoints, dedupeAreaHits, isAreaMeaningful } from "./area";
import { AnnoKitAreaPad, AnnoKitCaptureRoot } from "./capture";
import { AnnoKitCommentView } from "./comment-view";
import {
  COMMENTS_POLL_INTERVAL_MS,
  fetchComments,
  shouldPollComments,
} from "./comments";
import type { Comment } from "./comments";
import { AnnoKitComposer } from "./composer";
import { resolveAnnoKitConfig } from "./env";
import type { AnnoKitConfig, AnnoKitConfigProps } from "./env";
import { WORKING_STATUS, agentActivity } from "./agent-activity";
import { AnnoKitAgentBanner } from "./agent-banner";
import { AnnoKitFab } from "./fab";
import { AnnoKitSettings } from "./settings";
import { annoKitPreferences, setPreferenceDefaults, subscribeToPreferences } from "./prefs";
import type { OutputDetail } from "./prefs";
import type { AccentKey } from "./accent";
import type { TextTone } from "./text-tone";
import { AnnoKitThemeProvider } from "./theme-context";
import type { ThemePreference } from "./theme";
import { fetchViewer, forgetProtocolVersion, handshakeRetryDelay, probeProtocol, registerSession } from "./handshake";
import { inspectAtPoint } from "./inspector";
import type { ComponentNameFilter, InspectorHit } from "./inspector";
import { resolveOpenMarker } from "./marker-hit";
import { AnnoKitMarkers } from "./markers";
import { commentTaskCounts, mergeTaskLists } from "./message-task";
import { AnnoKitNotes } from "./notes";
import { noteJumpPlan, openNoteCount } from "./notes-list";
import type { NoteRow } from "./notes-list";
import type { SubmitDestination } from "./destination";
import { deleteAnnotation } from "./pending";
import { appPushTranslation, detailPushFrame, pushedAimBounds } from "./push";
import type { DetailPushSubject } from "./push";
import { AnnoKitQueue } from "./queue";
import { AnnoKitThreadView } from "./thread-view";
import { navigateToRoute, routerNavigationAvailable, useRoutePathname } from "./router";
import {
  captureScreenUri,
  releaseScreenshot,
  screenshotsAvailable,
  setScreenshotsEnabled,
} from "./screenshot";
import { subscribeToShake } from "./shake";
import type { AnnoKitTimeouts } from "./transport";
import { AnnoKitTransport, makeId } from "./transport";
import { assetsSource } from "./attachments";
import type { AttachmentSource } from "./attachments";
import { buildCaptureHelpers, buildComposerSlotProps, resolveCaptureHandling } from "./capture-flow";
import type { ComposerSlotProps, OnCapture } from "./capture-flow";
import type { PendingCapture, ServerAnnotation } from "./types";
import { sessionPath, sessionPendingPath } from "./url";
import { forgetViewer, setEnvAuthor, setHostAuthor, setViewerFromServer } from "./viewer";
import { setAnnoKitDebug } from "./log";
import { configKey, createSequencer } from "./sequence";

export type {
  AnnotationReference,
  AssetItem,
  AttachmentItem,
  AttachmentSource,
  AttachmentTransport,
} from "./attachments";
export { assetsSource };
export type { AnnoKitAuthor, AnnoKitConfig, AnnoKitConfigProps } from "./env";
export type { AimRect, AimSelection, AimTarget } from "./aim";
export type { ComponentNameFilter, InspectorHit } from "./inspector";
export type { ScrollInfo } from "./scroll";
// Public compat API: ANY host app can make anchored markers react to its
// scrolls instantly — `<ScrollView onScroll={reportAnnoKitScroll} …>`.
export { reportAnnoKitScroll } from "./scroll-reporter";
export type { AccelerationSample, ShakeDetectorOptions } from "./shake";
export { createShakeDetector, shakeAvailable } from "./shake";
export type { ThreadMessage } from "./thread";
export type {
  Comment,
  CommentAuthor,
  CommentMessage,
  CommentStatus,
} from "./comments";
export type { SubmitDestination } from "./destination";
export type {
  MessageTaskAnnotationBody,
  MessageTaskMark,
  NoteTaskRow,
} from "./message-task";
export type { QueueFilter, QueueRow } from "./queue-list";
export type { NoteGroup, NoteJumpPlan, NoteRow } from "./notes-list";
export type { AnnoKitPalette, ResolvedTheme, ThemePreference } from "./theme";
export { DARK_PALETTE, LIGHT_PALETTE, paletteFor, resolveTheme } from "./theme";
export { useAnnoKitTheme } from "./theme-context";
export type { AccentKey, AccentRole } from "./accent";
export type { TextTone } from "./text-tone";
export type { OutputDetail } from "./prefs";
export type { ViewerIdentity, ViewerSource } from "./viewer";
export { viewerIdentity } from "./viewer";
export type { PendingCapture, ServerAnnotation } from "./types";
// ── Headless capture (bring your own UI over our capture engine) ──────────
// `onCapture` on the provider hands hosts the capture + these helpers; the
// wire-speaking pieces are exported so an own-backend host can still build
// the protocol body without reimplementing it. docs/headless-capture.md.
export { applyOutputDetail, buildAnnotationBody } from "./payload";
export type { AnnotationBody, AnnotationElement } from "./payload";
export { buildCaptureBody, submitAgentCapture, submitCommentCapture } from "./submit";
export type { AgentSubmitOptions, SubmitCaptureContext } from "./submit";
export { AnnoKitTransport, DEFAULT_TIMEOUTS } from "./transport";
export type { AnnoKitTimeouts } from "./transport";
export type { CaptureHelpers, ComposerSlotProps, OnCapture } from "./capture-flow";
export { buildComposerSlotProps } from "./capture-flow";

/** Tier-2 slot: replace the built-in composer sheet (docs/ui-overrides.md). */
export type RenderComposer = (props: ComposerSlotProps) => React.ReactNode;

/**
 * Wait for the UI to actually paint a state change. Used before the
 * screenshot so the "hide our own chrome" render has reached the screen —
 * React resolving setState says nothing about what the pixels show.
 */
/**
 * How long to let the screen settle before capturing, on top of the two
 * frames the opacity change needs: long enough for a dismissing keyboard,
 * short enough not to feel like a pause.
 */
const CAPTURE_SETTLE_MS = 280;

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const raf: (cb: () => void) => unknown =
      typeof requestAnimationFrame === "function"
        ? (cb) => requestAnimationFrame(() => cb())
        : (cb) => setTimeout(cb, 16);
    let left = Math.max(1, count);
    const step = () => {
      left -= 1;
      if (left <= 0) resolve();
      else raf(step);
    };
    raf(step);
  });
}

interface AnnoKitContextValue {
  /** True when the overlay is active (dev build + env + health check passed). */
  enabled: boolean;
  /** Capture mode armed (next tap is captured). */
  armed: boolean;
  setArmed: (armed: boolean) => void;
  /** The team's notes on the current route (empty when unavailable). */
  comments: Comment[];
  /** Every screen's notes, as of the last unscoped read. */
  allComments: Comment[];
  /** False once a comments read has failed — the routes are not there. */
  commentsAvailable: boolean;
  refreshComments: () => void;
  /** This session's pending annotations (server state, refreshed lazily). */
  pending: ServerAnnotation[];
  refreshPending: () => void;
  /** Delete one annotation (optimistic, reverts if the server refuses). */
  removeAnnotation: (id: string) => void;
}

const INACTIVE_CONTEXT: AnnoKitContextValue = {
  enabled: false,
  armed: false,
  setArmed: () => {},
  comments: [],
  allComments: [],
  commentsAvailable: false,
  refreshComments: () => {},
  pending: [],
  refreshPending: () => {},
  removeAnnotation: () => {},
};

const AnnoKitContext = createContext<AnnoKitContextValue>(INACTIVE_CONTEXT);

/** Overlay state for app code that wants to know (rarely needed). */
export function useAnnoKit(): AnnoKitContextValue {
  return useContext(AnnoKitContext);
}

export interface AnnoKitProviderProps extends AnnoKitConfigProps {
  /** Extra component names/patterns to hide from annotation identity. */
  skipComponents?: ComponentNameFilter[];
  /**
   * Allow screenshot capture. Default true; `false` means the screen is
   * never captured at all — not captured-then-not-uploaded — so the
   * composer's Screenshot switch disappears, `capture.screenshotUri` is
   * null for headless and custom-composer consumers, and no temp file is
   * created. Use it when the app shows content that must never be written
   * to disk, without having to uninstall `react-native-view-shot`.
   */
  screenshots?: boolean;
  /**
   * Print the overlay's diagnostic logging (anchor registration,
   * re-anchoring, protocol flavour). Failures are always logged; this is
   * the verbose half, off by default because several of its lines describe
   * a lasting condition rather than an event. Also settable with
   * `EXPO_PUBLIC_ANNOKIT_DEBUG=1`.
   */
  debug?: boolean;
  /**
   * Request ceilings in milliseconds, for hosts on slow or tunnelled
   * networks: `{ read, mutate, upload }` (src/transport.ts documents the
   * defaults and why they differ). Every unset key keeps its default —
   * there is no way to switch a timeout off, because a request without one
   * can leave the overlay busy forever.
   */
  timeouts?: AnnoKitTimeouts;
  /**
   * Shake the device to arm/disarm annotate mode. Default true, but it is
   * only ever active when the optional `expo-sensors` peer is installed —
   * without it this is silently a no-op.
   */
  shakeToToggle?: boolean;
  /**
   * The overlay's appearance, as the HOST would like it: "system" (follow
   * the phone, the default), "light" or "dark".
   *
   * A DEFAULT, not a lock — the same precedence as the `author` prop. The
   * user can override it in the overlay's settings panel for the session,
   * and because nothing is persisted, a reload comes back to whatever is
   * passed here. See src/theme.ts.
   *
   * It exists because a React Native app has no parent frame: the web
   * overlay is TOLD what to wear by the builder page hosting its iframe,
   * and nothing is going to tell this one.
   */
  theme?: ThemePreference;
  /**
   * How much context a task carries by default: "minimal", "standard" (the
   * default) or "full". Trimmed in src/payload.ts; overridable in the
   * overlay's settings panel for the session, like `theme`.
   */
  outputDetail?: OutputDetail;
  /**
   * Show the "agent is working" banner (default true). It only appears
   * while the server reports a task `working`; the settings panel can
   * still turn it off for the session.
   */
  agentBanner?: boolean;
  /**
   * Refuse to send a new task while one is `working` (default true). Turn
   * it off for a server that runs tasks in parallel or queues them itself —
   * the client cannot tell which kind it is talking to. A default, like the
   * others: the settings panel overrides it for the session.
   */
  blockSendWhileWorking?: boolean;
  /** Default colour for AGENT TASK marks (src/accent.ts). */
  agentAccent?: AccentKey;
  /** Default colour for TEAM NOTE marks. Must differ from `agentAccent`. */
  teamAccent?: AccentKey;
  /** Default text colour: "neutral" (default), "cool" (Slate), "warm" (Stone), "navy", "forest", "plum" or "contrast" (src/text-tone.ts). */
  textTone?: TextTone;
  /**
   * The composer's attach-panel tabs. Defaults to the built-in assets
   * source; pass more `AttachmentSource`s to offer host-specific context
   * (src/attachments.ts) — the package itself knows nothing about them.
   */
  attachmentSources?: AttachmentSource[];
  /**
   * HEADLESS CAPTURE: render your own UI instead of the built-in composer.
   * See the `OnCapture` type and docs/headless-capture.md.
   */
  onCapture?: OnCapture;
  /**
   * TIER-2 SLOT: keep the whole flow (markers, queue, panes) but replace
   * the composer SHEET with your own. Receives the decisions pre-made —
   * see `ComposerSlotProps` and docs/ui-overrides.md. Ignored while
   * `onCapture` claims captures (tier 1 outranks the slot).
   */
  renderComposer?: RenderComposer;
  /** Intercept a task marker's tap: your detail pane instead of ours. */
  onOpenTask?: (id: string) => void;
  /** Intercept a note marker's tap. */
  onOpenComment?: (id: string) => void;
  children: React.ReactNode;
}

/** How many providers are mounted right now (see the warning below). */
let mountedProviders = 0;

export function AnnoKitProvider({
  children,
  skipComponents,
  timeouts,
  debug,
  screenshots,
  shakeToToggle,
  theme,
  outputDetail,
  agentBanner,
  blockSendWhileWorking,
  agentAccent,
  teamAccent,
  textTone,
  attachmentSources,
  onCapture,
  renderComposer,
  onOpenTask,
  onOpenComment,
  ...configProps
}: AnnoKitProviderProps) {
  // Props take precedence; env fallbacks are compile-time-inlined by Metro,
  // so one resolution per prop change is enough and the inactive path stays
  // allocation-free.
  const env = useMemo(
    () => resolveAnnoKitConfig(configProps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      configProps.endpoint,
      configProps.sessionId,
      configProps.token,
      configProps.enabled,
      configProps.author?.id,
      configProps.author?.name,
      configProps.author?.avatarUrl,
    ],
  );
  // The host's answers, into the same session store the panel writes to
  // (src/prefs.ts). In an effect rather than in the render body: the store
  // notifies subscribers, and notifying them mid-render is how you get
  // React shouting about updating one component while rendering another.
  useEffect(() => {
    setPreferenceDefaults({ outputDetail, agentAccent, teamAccent, textTone, agentBanner, blockSendWhileWorking });
  }, [outputDetail, agentAccent, teamAccent, textTone, agentBanner, blockSendWhileWorking]);
  // The env default stands when the prop is not given, so a host can turn
  // diagnostics on for one build without touching code.
  useEffect(() => {
    if (debug !== undefined) setAnnoKitDebug(debug);
  }, [debug]);
  useEffect(() => {
    setScreenshotsEnabled(screenshots !== false);
  }, [screenshots]);
  if (!env) return <>{children}</>;
  return (
    // The theme provider wraps the RUNTIME, not the app: this overlay themes
    // its own chrome and has no business telling the host app what to wear.
    <AnnoKitThemeProvider hostPreference={theme}>
      <AnnoKitRuntime
        env={env}
        skipComponents={skipComponents}
        timeouts={timeouts}
        shakeToToggle={shakeToToggle !== false}
        attachmentSources={attachmentSources}
        onCapture={onCapture}
        renderComposer={renderComposer}
        onOpenTask={onOpenTask}
        onOpenComment={onOpenComment}
      >
        {children}
      </AnnoKitRuntime>
    </AnnoKitThemeProvider>
  );
}

function AnnoKitRuntime({
  env,
  skipComponents,
  shakeToToggle,
  timeouts,
  attachmentSources,
  onCapture,
  renderComposer,
  onOpenTask,
  onOpenComment,
  children,
}: {
  env: AnnoKitConfig;
  skipComponents?: ComponentNameFilter[];
  timeouts?: AnnoKitTimeouts;
  shakeToToggle: boolean;
  attachmentSources?: AttachmentSource[];
  onCapture?: OnCapture;
  renderComposer?: RenderComposer;
  onOpenTask?: (id: string) => void;
  onOpenComment?: (id: string) => void;
  children: React.ReactNode;
}) {
  // Keyed on the three NUMBERS, the way `env` is keyed on its fields: an
  // inline `timeouts={{ read: 20000 }}` is a new object every host render,
  // and each new transport disposes the old one — aborting a send in
  // flight and re-running the whole handshake.
  const readMs = timeouts?.read;
  const mutateMs = timeouts?.mutate;
  const uploadMs = timeouts?.upload;
  const transport = useMemo(
    () => new AnnoKitTransport(env, { read: readMs, mutate: mutateMs, upload: uploadMs }),
    [env, readMs, mutateMs, uploadMs],
  );
  /**
   * The OLD transport dies with its configuration.
   *
   * This cleanup runs both on unmount and — crucially — when `env` changes,
   * before the new transport is used: a read started against endpoint A must
   * not be able to land after endpoint B has become the active config, or
   * A's data would be rendered under B (and A's session id retried against
   * it). See docs/audit/high-priority-security-privacy.md, "Isolate endpoint
   * and session changes".
   */
  useEffect(() => () => transport.dispose(), [transport]);
  /**
   * ONE PROVIDER. Say so, once, instead of letting it be mysterious.
   *
   * Server flavour, negotiated protocol version, viewer identity,
   * preferences, event listeners and live anchors are still module-level
   * singletons (docs/audit/performance-correctness.md, "Remove
   * cross-provider module-global state"). Until they are provider-scoped, a
   * second mounted provider silently shares and overwrites all six — the
   * symptom is a session's events refreshing another session's lists, or
   * one server's flavour deciding how the other's rows are parsed. That is
   * very hard to guess at from the outside, so it gets a development
   * warning rather than a comment nobody reads.
   */
  useEffect(() => {
    mountedProviders += 1;
    if (mountedProviders > 1) {
      console.warn(
        "[annokit] more than one AnnoKitProvider is mounted. They share " +
          "server flavour, protocol version, viewer identity, preferences, " +
          "event listeners and anchors — mount exactly one, at the app root.",
      );
    }
    return () => {
      mountedProviders -= 1;
    };
  }, []);
  // HIDDEN FOR THIS RUN. Chosen in the settings panel, and deliberately
  // un-undoable: the row promises a restart, and offering a secret gesture
  // back in would make the promise a lie. The app renders untouched.
  const prefs = useSyncExternalStore(
    subscribeToPreferences,
    annoKitPreferences,
    annoKitPreferences,
  );
  const [enabled, setEnabled] = useState(false);
  // The EFFECTIVE session id: env's for our protocol, the server-assigned
  // one in agentation compat (registerSession resolves it either way).
  const [sessionId, setSessionId] = useState(env.sessionId);
  const [armed, setArmed] = useState(false);
  // ONE armed state. There is no capture "mode" any more: aiming is aiming,
  // and where the result goes is chosen in the composer (src/destination.ts).
  const [capture, setCapture] = useState<PendingCapture | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * The server's agents, for the composer's agent pill: null until the
   * server has answered /agent, and for good on a server without the route.
   */
  const [serverAgent, setServerAgent] = useState<AgentConfig | null>(null);
  // The note we were just taken to: its marker pulses on arrival so a
  // cross-route jump does not end on a screen of identical dots.
  const [highlightCommentId, setHighlightCommentId] = useState<string | null>(null);
  // Marker tapped → that annotation's detail. Held as an ID, not the object,
  // so the pending list stays the single source of truth: if the annotation
  // is deleted (from the queue, or from the detail itself) the lookup below
  // goes null and the pane closes instead of showing a row the server no
  // longer has.
  const [openMarkerId, setOpenMarkerId] = useState<string | null>(null);
  // The open task's last-known copy. Declared here rather than beside the
  // resolution below (see "THE OPEN TASK") because the isolation reset has
  // to be able to clear it during render: it is the other half of what the
  // detail pane renders from, so leaving it to an effect would paint one
  // frame of the old server's task under the new endpoint.
  const [openMarkerSeed, setOpenMarkerSeed] = useState<ServerAnnotation | null>(null);
  const [pending, setPending] = useState<ServerAnnotation[]>([]);
  // Session tasks made from a team note, whatever their status — what a
  // note's Tasks tab, its marker pip and "open the task" read once the task
  // has left the queue (mergeTaskLists, src/message-task.ts).
  const [linkedTasks, setLinkedTasks] = useState<ServerAnnotation[]>([]);
  // Derived, not stored: the server is the only thing that knows whether an
  // agent is working, and `pending` is already re-read on every event.
  const agentWork = agentActivity(pending);
  const [comments, setComments] = useState<Comment[]>([]);
  // Every screen's notes. The route-scoped list above draws the markers;
  // this one feeds the notes panel and its toolbar count, and is read only
  // on the events that can change it (never on the backstop timer — it is
  // the more expensive read and nobody is looking at it most of the time).
  const [allComments, setAllComments] = useState<Comment[]>([]);
  const knownTasks = useMemo(() => mergeTaskLists(pending, linkedTasks), [pending, linkedTasks]);
  // Optimistic: a server that has the routes proves it on the first read; a
  // server that 404s turns this off and the overlay says so (and stops
  // polling) without touching annotations, aiming or the toolbar.
  const [commentsAvailable, setCommentsAvailable] = useState(true);
  const [openCommentId, setOpenCommentId] = useState<string | null>(null);
  const [selection, setSelection] = useState<AimSelection<InspectorHit> | null>(null);
  // Aim mode: element (the default press-to-survey) or area (press-drag
  // draws a rectangle — src/area.ts). The chip over the app switches them;
  // switching, arming and disarming all start clean.
  const [aimMode, setAimMode] = useState<"element" | "area">("element");
  const areaOriginRef = useRef<{ x: number; y: number } | null>(null);
  // The capture root's view, which area mode's pad hit-tests through.
  const captureRootRef = useRef<View | null>(null);
  const [areaDraft, setAreaDraft] = useState<AimRect | null>(null);
  const [areaSel, setAreaSel] = useState<{ rect: AimRect; hits: InspectorHit[] } | null>(null);
  const [shooting, setShooting] = useState(false);
  /**
   * The live capture's screenshot path, for the exits that cannot read
   * state: an unmount cleanup, and the endpoint-change teardown below.
   * Kept in sync by an effect rather than written during render, so it is
   * always the COMMITTED capture's file.
   */
  const captureUriRef = useRef<string | null>(null);

  /**
   * ── ENDPOINT/SESSION ISOLATION ────────────────────────────────────────
   *
   * A change to endpoint, sessionId or token is A DIFFERENT SERVER (or a
   * different principal on it), not an update to this one. Everything below
   * this line — the effective session id, the pending tasks, both comment
   * lists, whatever pane is open, the live anchors, the negotiated protocol
   * flavour and version, the viewer — was derived from the OLD one, and
   * showing any of it under the new configuration would render server A's
   * data (and send server A's session id) to server B.
   *
   * Done as a render-phase adjustment rather than an effect on purpose:
   * effects run AFTER the commit, so an effect-based reset would let one
   * frame render the old server's markers under the new endpoint, and would
   * let the enabled-gated effects fire a read against it first. React's
   * documented pattern for "reset state when a prop changes" is exactly
   * this — set state during render, React re-runs the render before
   * committing anything.
   *
   * See docs/audit/high-priority-security-privacy.md, "Isolate endpoint and
   * session changes".
   */
  const envKey = configKey(env);
  const [activeKey, setActiveKey] = useState(envKey);
  // Read sequencers: one per list, so a slow answer for the previous
  // endpoint (or the previous route) cannot overwrite a newer one. Refs,
  // not state — advancing a watermark must never schedule a render.
  const pendingSeq = useRef(createSequencer());
  const linkedSeq = useRef(createSequencer());
  // Whether any team note is loaded: without one there is nothing a linked
  // task could be shown on, so the session read is skipped.
  const hasNotesRef = useRef(false);
  const commentsSeq = useRef(createSequencer());
  const allCommentsSeq = useRef(createSequencer());
  if (activeKey !== envKey) {
    setActiveKey(envKey);
    // Nothing in flight belongs to the new configuration.
    pendingSeq.current.reset();
    commentsSeq.current.reset();
    allCommentsSeq.current.reset();
    // Off first: `enabled` is what gates every read, poll and push
    // subscription, so dropping it before anything else stops the runtime
    // rather than merely emptying it. The new handshake turns it back on.
    setEnabled(false);
    setSessionId(env.sessionId);
    setPending([]);
    setComments([]);
    setAllComments([]);
    setCommentsAvailable(true);
    // Every surface that could be showing the old server's data.
    setCapture(null);
    setQueueOpen(false);
    setNotesOpen(false);
    setSettingsOpen(false);
    setOpenMarkerId(null);
    setOpenCommentId(null);
    setOpenMarkerSeed(null);
    setHighlightCommentId(null);
    // Aiming is mid-gesture state about a screen, not about a server, but a
    // capture confirmed now would post to the new endpoint under the old
    // session id — so the gesture is dropped too.
    setArmed(false);
    setSelection(null);
    setAreaDraft(null);
    setAreaSel(null);
    areaOriginRef.current = null;
  }
  /** Is a composer flow still open? See captureScreenshotNow. */
  const captureOpenRef = useRef(false);
  useEffect(() => {
    captureUriRef.current = capture?.screenshotUri ?? null;
    captureOpenRef.current = capture !== null;
  }, [capture]);
  /**
   * The module-level singletons, cleared on the same transition.
   *
   * In an effect rather than in the adjustment above because these are side
   * effects on shared stores, and React may discard a render — but they are
   * safe here: every one of them is read only by code that `enabled` gates,
   * and `enabled` is already false by the time this runs. The handshake
   * effect below re-derives all four.
   *
   * That they are module-level at all is the remaining half of this work —
   * see docs/audit/performance-correctness.md, "Remove cross-provider
   * module-global state".
   */
  useEffect(() => {
    return () => {
      forgetServerFlavor();
      forgetProtocolVersion();
      forgetAgentRoute();
      clearScrollAnchors();
      // The abandoned capture's temp file. This cleanup runs on unmount
      // too, which is the exit nothing else covers: the app tears the
      // overlay down with a composer open and the file would outlive it.
      releaseScreenshot(captureUriRef.current);
      captureUriRef.current = null;
      // Releasing a file a helper already released is a no-op.
      for (const uri of hostShotsRef.current) releaseScreenshot(uri);
      hostShotsRef.current.clear();
    };
  }, [envKey]);
  // The composer sheet is content-sized and the keyboard sits under it, so
  // only IT knows how much of the screen ends up covered; the aim label uses
  // this to stay above the strip, and push mode measures the element
  // against it.
  const [coveredHeight, setCoveredHeight] = useState<number | null>(null);
  /**
   * PUSHING RIGHT NOW — not a preference, and nobody chose it.
   *
   * It latches ON the first time the geometry asks for a non-zero
   * translation for the sheet that is open, and OFF when that sheet closes.
   * The latch is what keeps this stable rather than oscillating: the sheet's
   * ceiling depends on whether we are pushing, the covered strip depends on
   * the ceiling, and the translation depends on the covered strip — so a
   * value that could flip back would shrink the sheet, uncover the element,
   * unshrink the sheet, and cover it again, for ever. Latched, the sheet
   * settles at the compact ceiling for as long as it is open; if the element
   * turns out to be clear once the sheet is smaller, the translation falls
   * to 0 on its own and the app slides back down with the element visible,
   * which is the right answer arrived at honestly.
   */
  const [pushing, setPushing] = useState(false);
  const capturingRef = useRef(false);
  const routeName = useRoutePathname();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();

  /**
   * IDENTITY, before anything can be written.
   *
   * Set synchronously from config so the two tiers that need no network are
   * in force immediately, and cleared first because a new endpoint is a new
   * server and possibly a new person — carrying the last one's id across
   * would be the multiplayer bug in miniature. The order of the tiers, and
   * why env ranks below the server's own answer, is src/viewer.ts.
   */
  useEffect(() => {
    forgetViewer();
    setHostAuthor(env.author);
    setEnvAuthor(env.envAuthor);
  }, [env]);

  // One-time activation: health/protocol handshake, then register (or
  // reuse) the annotation session — same idempotent POST the web
  // platform-overlays performs (body.id makes it reuse our env session id).
  // Against agentation-mcp (compat mode, src/agentation.ts) the server
  // assigns the session id instead, so the effective id is STATE, not
  // config — everything session-scoped reads `sessionId`, never
  // `env.sessionId` directly.
  //
  // KEEPS TRYING while the server is unreachable. Starting the app before
  // the server is the ordinary order with two terminals, and a single try
  // left the overlay off until the app was reloaded, with nothing on screen
  // to say why. A version mismatch is not retried: it will not change.
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = async (n: number): Promise<void> => {
      const again = () => {
        if (!cancelled) retry = setTimeout(() => void attempt(n + 1), handshakeRetryDelay(n));
      };
      const check = await probeProtocol(transport);
      if (cancelled || check === "mismatch") return;
      if (check === "unreachable") return again();
      const sid = await registerSession(transport, env.sessionId, routeName, serverFlavor());
      if (cancelled) return;
      if (!sid) return again();
      setSessionId(sid);
      // WHO WE ARE, per request — asked once, and never blocking: a server
      // without the route (or without anyone signed in) just leaves the
      // lower tiers standing. It outranks the env identity when it answers,
      // which is what keeps two devices on one session from claiming each
      // other's messages.
      const viewer = await fetchViewer(transport);
      if (cancelled) return;
      setViewerFromServer(viewer);
      setEnabled(true);
    };
    void attempt(0);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport]);

  const refreshPending = useCallback(() => {
    void (async () => {
      // Issue order, not arrival order (src/sequence.ts): activation, a
      // mutation, the poll timer and a push event can all ask at once.
      const ticket = pendingSeq.current.begin();
      const data = await transport.getJson<{ annotations?: ServerAnnotation[] } | ServerAnnotation[]>(
        sessionPendingPath(sessionId),
      );
      if (!data) return;
      if (!pendingSeq.current.accept(ticket)) return;
      // Compat: agentation's rows use their spellings — normalised here so
      // every reader downstream keeps seeing ServerAnnotation.
      if (serverFlavor() === "agentation") {
        setPending(fromAgentationList(data));
        return;
      }
      const list = Array.isArray(data) ? data : (data.annotations ?? []);
      setPending(list.filter((a) => a && typeof a.id === "string"));
    })();
    // The same moments that can move a task out of the queue can move one
    // that came from a note, so the linked list is re-read alongside —
    // only when there are notes to show it on, and only from an Annotate
    // Protocol server (`GET /sessions/:sid` is its route).
    if (!hasNotesRef.current || serverFlavor() === "agentation") return;
    void (async () => {
      const ticket = linkedSeq.current.begin();
      const session = await transport.getJson<{ annotations?: ServerAnnotation[] }>(sessionPath(sessionId));
      if (!session || !linkedSeq.current.accept(ticket)) return;
      const all = Array.isArray(session.annotations) ? session.annotations : [];
      setLinkedTasks(all.filter((a) => a && typeof a.id === "string" && typeof a.sourceCommentId === "string" && a.sourceCommentId));
    })();
  }, [transport, sessionId]);

  useEffect(() => {
    if (enabled) refreshPending();
  }, [enabled, refreshPending]);

  // Notes usually arrive after the first pending read, which skipped the
  // linked tasks for want of anything to show them on: read again once
  // there is something.
  const hasNotes = comments.length > 0 || allComments.length > 0;
  useEffect(() => {
    hasNotesRef.current = hasNotes;
    if (enabled && hasNotes) refreshPending();
  }, [enabled, hasNotes, refreshPending]);

  // RE-ANCHORING: any mark that arrived without a live anchor — a reload
  // emptied the registry, another device captured it, the server created it
  // — gets its element found again by testID (src/reanchor.ts). Runs on
  // every list/route change plus one delayed retry, because the element may
  // mount a beat (or a navigation) later; a successful pass bumps state so
  // the marker layer re-evaluates its trusted set.
  const [, setAnchorEpoch] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const records = [
      ...pending.map((a) => ({
        id: a.id,
        testID: a.testID,
        x: a.x,
        y: a.y,
        boundingBox: a.boundingBox,
      })),
      ...comments.map((c) => ({
        id: c.id,
        testID: c.testID,
        x: c.x,
        y: c.y,
        boundingBox: c.boundingBox,
      })),
    ];
    if (records.length === 0) return;
    const attempt = async () => {
      const fixed = await reanchorMarkers(records);
      if (!cancelled && fixed > 0) setAnchorEpoch((n) => n + 1);
      return fixed;
    };
    void attempt();
    const retry = setTimeout(() => void attempt(), 1_500);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [enabled, pending, comments, routeName]);

  // 5b: the session's server-push stream. Its whole output is "refresh the
  // same things the poll timers refresh" — push replaces the cadence, never
  // the reads (src/events.ts) — and the polls run only while it is down.
  useEffect(() => {
    if (!enabled) return;
    return startAnnoKitEventStream(env, sessionId);
  }, [enabled, env, sessionId]);
  const streamLive = useSyncExternalStore(subscribeToStreamLive, readStreamLive, readStreamLive);

  /**
   * Read the comments for the CURRENT screen.
   *
   * Called on the events that can change what should be on screen — the
   * route changing, comment mode being armed, and any mutation — plus a
   * lazy backstop timer (see COMMENTS_POLL_INTERVAL_MS). Null from the
   * fetch means the endpoint did not answer, which is a different thing
   * from "no comments": the list is emptied AND marked unavailable, so the
   * UI can say so rather than implying nobody has commented.
   */
  const refreshComments = useCallback(() => {
    void (async () => {
      // The ticket also carries ROUTE ordering: this callback is rebuilt per
      // route, so a slow read for the screen we just left is older than the
      // one for the screen we are on, and is dropped rather than drawn here.
      const ticket = commentsSeq.current.begin();
      const list = await fetchComments(transport, routeName);
      if (!commentsSeq.current.accept(ticket)) return;
      if (!list) {
        setCommentsAvailable(false);
        setComments([]);
        return;
      }
      setCommentsAvailable(true);
      setComments(list);
    })();
  }, [transport, routeName]);

  /**
   * Read EVERY screen's notes (no routeName). What the notes panel lists and
   * what its toolbar numeral counts. Fails soft: a server without the routes
   * leaves the last list standing rather than emptying a panel the user may
   * be reading.
   */
  // Whether there is an Agent to choose, read on activation and re-read on
  // every server event (a switch from another device, an agent starting
  // work). fetchAgentConfig asks a server without the route only once.
  useEffect(() => {
    if (!enabled || serverFlavor() === "agentation") return;
    const read = () => void fetchAgentConfig(transport).then((c) => c && setServerAgent(c));
    read();
    return onAnnoKitEvent(read);
  }, [enabled, transport]);

  const refreshAllComments = useCallback(() => {
    void (async () => {
      const ticket = allCommentsSeq.current.begin();
      const list = await fetchComments(transport, null);
      if (!list) return;
      if (!allCommentsSeq.current.accept(ticket)) return;
      setAllComments(list);
    })();
  }, [transport]);

  useEffect(() => {
    if (enabled) refreshAllComments();
  }, [enabled, refreshAllComments]);

  // 5b, the listening half: any server event triggers the same idempotent
  // list reads the timers drive. Cheap by design, so no event filtering —
  // "something on this session changed" is reason enough to look.
  useEffect(() => {
    if (!enabled) return;
    return onAnnoKitEvent(() => {
      refreshPending();
      refreshComments();
      refreshAllComments();
    });
  }, [enabled, refreshPending, refreshComments, refreshAllComments]);

  // The stream (re)connecting: whatever changed while it was down was
  // announced to nobody, and the polls stop now, so catch up once.
  useEffect(() => {
    if (!enabled || !streamLive) return;
    refreshPending();
    refreshComments();
    refreshAllComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, streamLive]);

  // Route change (and first activation): the markers are per-screen.
  useEffect(() => {
    if (enabled) refreshComments();
  }, [enabled, refreshComments]);

  // Arming: someone about to mark something wants to see what is already
  // there — both kinds, since both are now one gesture away.
  useEffect(() => {
    if (enabled && armed) refreshComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, armed]);

  // The backstop. Slow on purpose, off entirely once the endpoint has
  // proven absent, and off while the event stream is live — see
  // src/comments.ts for the cadence rationale. Both reads: the notes panel
  // and the toolbar's count are every screen's notes, not this one's.
  useEffect(() => {
    if (!shouldPollComments({ enabled, available: commentsAvailable, streamLive })) return;
    const timer = setInterval(() => {
      refreshComments();
      refreshAllComments();
    }, COMMENTS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, commentsAvailable, streamLive, refreshComments, refreshAllComments]);

  /** Replace one comment with the newer copy the server just handed back. */
  const applyComment = useCallback((updated: Comment) => {
    const merge = (prev: Comment[]) => {
      const i = prev.findIndex((c) => c.id === updated.id);
      if (i === -1) return [...prev, updated];
      return [...prev.slice(0, i), updated, ...prev.slice(i + 1)];
    };
    setComments(merge);
    // The panel's list is a different read of the same thing; a note
    // resolved from its detail must not still say "Open" behind it.
    setAllComments(merge);
  }, []);

  const dropComment = useCallback((id: string) => {
    const without = (prev: Comment[]) => prev.filter((c) => c.id !== id);
    setComments(without);
    setAllComments(without);
  }, []);

  /**
   * Drop the tasks a send has just handed over (the "clear on send"
   * preference). Local only: the panel's own refresh re-reads the server,
   * and a server that still lists them will simply put them back.
   */
  const dropSentAnnotations = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) {
      setPending([]);
      return;
    }
    const gone = new Set(ids);
    setPending((prev) => prev.filter((a) => !gone.has(a.id)));
  }, []);

  const removeAnnotation = useCallback(
    (id: string) => {
      void (async () => {
        const ok = await deleteAnnotation(transport, id, setPending);
        // The revert already restored the row; resync so the panel matches
        // the server rather than our guess.
        if (!ok) refreshPending();
      })();
    },
    [transport, refreshPending],
  );

  /**
   * The annotation whose marker detail is open.
   *
   * Re-resolved from the pending list while it IS pending — that keeps the
   * pane current with refreshes for free — and backed by the last copy we
   * saw once it is not. A task the agent resolves leaves the pending list,
   * and the conversation about it is exactly what must survive that: the
   * detail pane re-reads `GET /annotations/:aid` itself, shows the agent's
   * reply, and a reply of your own puts the task back in the queue. Deriving
   * the pane purely from the list closed it the moment the work "finished".
   *
   * Deletion still closes the pane — the pane does that itself now, both for
   * its own Delete button and for a server that says the id is gone.
   */
  const openMarkerLive = resolveOpenMarker(knownTasks, openMarkerId);
  const openMarker = openMarkerLive ?? openMarkerSeed;
  useEffect(() => {
    if (!openMarkerId) {
      setOpenMarkerSeed(null);
      return;
    }
    if (openMarkerLive) setOpenMarkerSeed(openMarkerLive);
  }, [openMarkerId, openMarkerLive]);
  useEffect(() => {
    // A dangling id renders nothing, and holding one would resurrect the
    // pane if the same id ever came back from a refresh.
    if (openMarkerId && !openMarker) setOpenMarkerId(null);
  }, [openMarkerId, openMarker]);

  // Same rule for the comment detail: deleted (or gone on a refresh) closes.
  // Resolved against BOTH lists, and the unscoped one first: a note opened
  // from the notes panel may live on a screen we have only just navigated to
  // (or not navigated to at all, on a host with no router), and the
  // route-scoped list would not have it yet — closing the pane the user
  // just asked for.
  const openComment =
    resolveOpenMarker(allComments, openCommentId) ?? resolveOpenMarker(comments, openCommentId);
  useEffect(() => {
    if (openCommentId && !openComment) setOpenCommentId(null);
  }, [openCommentId, openComment]);

  /**
   * GO TO A NOTE, from the notes panel.
   *
   * Three cases, decided in one pure place (src/notes-list.ts): it is on this
   * screen (open it, and flag its marker for when the detail closes), it is
   * elsewhere and this host has a router (navigate, then open), or it is
   * elsewhere and there is no router (open it anyway — reading the note is
   * the point, and the panel already said the jump was not on offer).
   *
   * Navigation is best-effort in every direction: `navigateToRoute` swallows
   * a router that throws, and the detail opens regardless. The one-frame
   * delay after navigating is so the detail lands on top of the new screen
   * rather than racing its first render.
   */
  const goToNote = useCallback(
    (row: NoteRow) => {
      const plan = noteJumpPlan(row, routeName, routerNavigationAvailable());
      setNotesOpen(false);
      setHighlightCommentId(row.id);
      if (plan.navigate && plan.targetRoute) navigateToRoute(plan.targetRoute);
      const open = () => setOpenCommentId(row.id);
      if (plan.navigate) setTimeout(open, 60);
      else open();
    },
    [routeName],
  );

  /**
   * THE TWO HALVES, POINTING AT EACH OTHER.
   *
   * A team-note message can become an agent task, so a user needs to get
   * from the discussion to the work and back. Both directions SWAP the pane
   * rather than stacking a second sheet on the first: two modals over each
   * other is one Done button too many, and the thing being read is always
   * the newer one.
   */
  const showTask = useCallback((annotationId: string) => {
    setOpenCommentId(null);
    setOpenMarkerId(annotationId);
  }, []);
  const showNote = useCallback((commentId: string) => {
    setOpenMarkerId(null);
    setOpenCommentId(commentId);
  }, []);

  /**
   * Which notes have produced tasks — the quiet pip on the note's own marker
   * (src/markers.tsx). Read from the pending list plus the note-made tasks
   * that have left it, so the pip does not vanish when a task is sent.
   */
  const taskCounts = useMemo(() => commentTaskCounts(knownTasks), [knownTasks]);
  // Notes whose task the agent has right now: that task has no marker of
  // its own, so the note's wears the working ring for it.
  const workingNoteIds = useMemo(
    () =>
      new Set(
        knownTasks
          .filter((t) => t.status === WORKING_STATUS && typeof t.sourceCommentId === "string")
          .map((t) => t.sourceCommentId as string),
      ),
    [knownTasks],
  );

  // The pulse is an arrival cue, not a state: it says "this one" and stops.
  useEffect(() => {
    if (!highlightCommentId) return;
    const timer = setTimeout(() => setHighlightCommentId(null), 2600);
    return () => clearTimeout(timer);
  }, [highlightCommentId]);

  // ── Aim: select first, compose second ────────────────────────────────────
  //
  // The capture root hands us raw points; the tracker turns a gesture into a
  // selection (throttled survey while the finger moves, a full hit-test on
  // release) and owns all the staleness rules. It is created ONCE — its
  // throttle window and sequence counters are per-session state, so a
  // re-render must not hand us a fresh one. Callback-dependent values reach
  // it through refs for the same reason.
  const rootViewRef = useRef<unknown>(null);
  const skipRef = useRef(skipComponents);
  skipRef.current = skipComponents;
  const tracker = useMemo(
    () =>
      createAimTracker<InspectorHit>({
        inspect: (x, y, final) =>
          inspectAtPoint(rootViewRef.current, x, y, skipRef.current, { survey: !final }),
        onSelection: setSelection,
      }),
    [],
  );

  // The gesture callbacks read the mode through a ref: they are handed to
  // the capture root once, and a mode flip mid-gesture must not swap the
  // handler out from under a finger that is still down.
  const aimModeRef = useRef(aimMode);
  aimModeRef.current = aimMode;

  const onAim = useCallback(
    (x: number, y: number, rootRef: unknown) => {
      rootViewRef.current = rootRef;
      if (aimModeRef.current === "area") {
        if (!areaOriginRef.current) areaOriginRef.current = { x, y };
        setAreaSel(null);
        setAreaDraft(areaRectFrom(areaOriginRef.current, { x, y }));
        return;
      }
      tracker.aim(x, y);
    },
    [tracker],
  );
  const onSelect = useCallback(
    (x: number, y: number, rootRef: unknown) => {
      rootViewRef.current = rootRef;
      if (aimModeRef.current === "area") {
        const origin = areaOriginRef.current;
        areaOriginRef.current = null;
        setAreaDraft(null);
        if (!origin) return;
        const rect = areaRectFrom(origin, { x, y });
        // A wobbly tap is not a region — clear rather than keep a sliver.
        if (!isAreaMeaningful(rect)) return;
        void (async () => {
          // The center gets the full capture treatment (symbolication,
          // scroll); the inset corners are survey-cheap — they only add
          // names to the contained list.
          const [center, ...corners] = areaSamplePoints(rect);
          const centerHit = await inspectAtPoint(
            rootViewRef.current,
            center.x,
            center.y,
            skipRef.current,
            { quiet: true },
          );
          const cornerHits = await Promise.all(
            corners.map((pt) =>
              inspectAtPoint(rootViewRef.current, pt.x, pt.y, skipRef.current, {
                survey: true,
                quiet: true,
              }),
            ),
          );
          setAreaSel({ rect, hits: dedupeAreaHits([centerHit, ...cornerHits]) });
        })();
        return;
      }
      tracker.select(x, y);
    },
    [tracker],
  );

  /** The system took a gesture away: nothing was aimed at or drawn. */
  const cancelAimGesture = useCallback(() => {
    tracker.clear();
    areaOriginRef.current = null;
    setAreaDraft(null);
  }, [tracker]);

  /** Everything aim-related, back to zero — every mode, every stage. */
  const clearAim = useCallback(() => {
    tracker.clear();
    areaOriginRef.current = null;
    setAreaDraft(null);
    setAreaSel(null);
  }, [tracker]);

  const toggleAimMode = useCallback(() => {
    clearAim();
    setAimMode((m) => (m === "element" ? "area" : "element"));
  }, [clearAim]);

  /**
   * Arm, or disarm when already armed. Every transition starts clean:
   * arming should not resurrect the element you selected five minutes ago,
   * and disarming is the "never mind" gesture.
   */
  const toggleArmed = useCallback(() => {
    clearAim();
    setAimMode("element");
    setArmed((wasArmed) => !wasArmed);
  }, [clearAim]);

  // The X on the confirm bar is "never mind" — ALL of it, area included.
  // Clearing only the live aim would leave an orphaned dashed outline with
  // no control on screen that explains it.
  const dismissAim = clearAim;

  // Shake to arm — no-op unless the optional expo-sensors peer is installed.
  useEffect(() => {
    if (!enabled || !shakeToToggle) return;
    return subscribeToShake(toggleArmed);
  }, [enabled, shakeToToggle, toggleArmed]);

  // Confirm: the selection is already resolved, so this only has to take the
  // screenshot and open the sheet. Arming ends here — the selection does
  // NOT, because the sheet is designed to be read next to its highlight.
  const openComposer = useCallback(() => {
    if (capturingRef.current) return;
    // What the composer is about: an area (the rectangle is the subject,
    // its sampled components ride along), or the single aimed element.
    let plan: Omit<PendingCapture, "routeName" | "screenshotUri"> | null = null;
    if (areaSel) {
      const [primaryHit, ...extraHits] = areaSel.hits;
      plan = {
        x: areaSel.rect.x + areaSel.rect.width / 2,
        y: areaSel.rect.y + areaSel.rect.height / 2,
        hit: primaryHit ?? null,
        extraHits: extraHits.length > 0 ? extraHits : undefined,
        areaRect: areaSel.rect,
      };
    } else if (selection?.final) {
      plan = { x: selection.x, y: selection.y, hit: selection.hit };
    }
    if (!plan) return;
    const planned = plan;
    capturingRef.current = true;
    setArmed(false);
    setShooting(true);
    void (async () => {
      try {
        // NO SCREENSHOT YET. The capture follows the CHOICE: nothing is
        // written to disk until the composer's Screenshot switch goes on
        // (or a headless host asks), which is what makes "off" mean never
        // taken rather than taken-and-not-sent. `canScreenshot` is the
        // answer to "may we", so the switch can be drawn before there is
        // anything to switch on: the peer resolved, the host has not turned
        // screenshots off, and the server has a route for one — agentation
        // compat has none, so a capture there would only dangle.
        const canScreenshot = screenshotsAvailable() && serverFlavor() !== "agentation";
        const pendingCapture: PendingCapture = {
          ...planned,
          id: makeId(),
          routeName,
          screenshotUri: null,
          canScreenshot,
        };
        // HEADLESS SEAM: the decision and the helper wiring are pure and
        // tested (src/capture-flow.ts); this component only clears the aim
        // on "handled" and opens the sheet otherwise.
        const handled = resolveCaptureHandling(
          onCapture,
          pendingCapture,
          buildCaptureHelpers(pendingCapture, {
            transport,
            sessionId,
            onAgentSubmitted: refreshPending,
            onCommentSubmitted: refreshComments,
            dismiss: clearAim,
            captureScreenshot: shootForHost,
          }),
        );
        if (handled === "handled") {
          clearAim();
          return;
        }
        setCapture(pendingCapture);
      } catch (e) {
        console.warn("[annokit] capture failed:", e);
      } finally {
        setShooting(false);
        capturingRef.current = false;
      }
    })();
  }, [
    selection,
    areaSel,
    routeName,
    // The headless seam's closures — sessionId especially: agentation
    // compat swaps it after the handshake, and a stale capture posting
    // into the configured id would land in a session that does not exist.
    onCapture,
    transport,
    sessionId,
    refreshPending,
    refreshComments,
    clearAim,
  ]);

  /**
   * TAKE THE SCREENSHOT NOW, for a composer that has just been asked for
   * one. Resolves to the URI, or null if it could not be taken.
   *
   * The sheet is covering the thing being captured, so it has to go away
   * for a beat: `shooting` hides the overlay's own chrome (the same flag
   * the confirm bar used) and the composer hides itself while it is set,
   * so the evidence is the app, not our UI on top of the app. Two frames
   * is what it takes for that to be true on device.
   *
   * The capture is remembered on the capture object, so every existing
   * consumer — the preview, the upload, the release-on-exit — keeps
   * reading exactly one field and nothing downstream has to learn a new
   * shape.
   */
  /**
   * The shutter itself: hide the chrome, wait out the keyboard, take the
   * shot. Who OWNS the file is the caller's business — the built-in
   * composer's (captureScreenshotNow) or a headless host's (shootForHost).
   */
  const shootScreen = useCallback(async (): Promise<string | null> => {
    if (!screenshotsAvailable()) return null;
    setShooting(true);
    try {
      // Two frames for the opacity commit, then a settle window: a
      // dismissing keyboard animates over roughly a quarter second, and a
      // capture taken before it finishes has the keyboard in it. This is
      // the one place the overlay deliberately makes the user wait, and it
      // is still under a third of a second.
      await nextFrames(2);
      await new Promise<void>((resolve) => setTimeout(resolve, CAPTURE_SETTLE_MS));
      return await captureScreenUri();
    } catch (e) {
      console.warn("[annokit] screenshot capture failed:", e);
      return null;
    } finally {
      setShooting(false);
    }
  }, []);

  const captureScreenshotNow = useCallback(async (): Promise<string | null> => {
    const uri = await shootScreen();
    if (!uri) return null;
    // The flow closed while the shutter was open — dismissed, or the
    // endpoint changed underneath it. Nothing downstream will ever see
    // this file, so nothing downstream can release it (src/screenshot.ts
    // LIFECYCLE): it is ours, here, now.
    if (!captureOpenRef.current) {
      releaseScreenshot(uri);
      return null;
    }
    // A second capture replaces the first; the first was never uploaded,
    // so it is ours to free (src/screenshot.ts LIFECYCLE).
    releaseScreenshot(captureUriRef.current);
    captureUriRef.current = uri;
    setCapture((current) => (current ? { ...current, screenshotUri: uri } : current));
    return uri;
  }, [shootScreen]);

  /**
   * HEADLESS (tier 1). There is no composer flow to be "still open" — the
   * host's sheet is the flow — so the built-in path's open-check would
   * delete every shot the moment it was taken. The helpers own the file
   * from here (src/capture-flow.ts); the set is only so teardown, the one
   * exit no helper sees, can still free what a host left behind.
   */
  const hostShotsRef = useRef(new Set<string>());
  const shootForHost = useCallback(async (): Promise<string | null> => {
    const uri = await shootScreen();
    if (uri) hostShotsRef.current.add(uri);
    return uri;
  }, [shootScreen]);

  /**
   * REMOVE THE SCREENSHOT — the switch turned off, or its chip dismissed.
   *
   * Deletes the file and clears it off the capture, rather than keeping it
   * around in case the user changes their mind. "Off" has one meaning in
   * this package and it is the strong one: no capture of this screen is on
   * disk. Turning it back on takes a fresh shot, which is also the more
   * honest result — the screen may have changed since.
   */
  const clearScreenshotNow = useCallback(() => {
    releaseScreenshot(captureUriRef.current);
    captureUriRef.current = null;
    setCapture((current) =>
      current && current.screenshotUri ? { ...current, screenshotUri: null } : current,
    );
  }, []);

  const closeComposer = useCallback(() => {
    // An exit without a submit: the capture's screenshot is a temp file
    // nobody is going to use (src/screenshot.ts LIFECYCLE). Releasing here
    // covers Cancel, the backdrop, and every close the submit paths did
    // not already release — it is idempotent, so the overlap is fine.
    releaseScreenshot(captureUriRef.current);
    setCapture(null);
    setCoveredHeight(null);
    clearAim();
  }, [clearAim]);

  // ── Push: move the app, not just the sheet ───────────────────────────────
  //
  // WHAT MOVES. One transform, on a wrapper holding the app's own subtree
  // (the capture root) AND every layer anchored to it — the aim highlight,
  // its label, the markers, the confirm bar. Those layers are drawn at
  // window coordinates taken from `measureInWindow`, so moving the app
  // without them is precisely the bug this feature exists to prevent: the
  // highlight would detach from the element it is highlighting. Outside the
  // wrapper, and therefore fixed: the FAB (a permanent control, which should
  // not slide off the top) and the sheet itself, which lives in a Modal —
  // its own window — and could not have been moved by this transform anyway.
  //
  // WHAT THE APP MEASURES. Nothing, while this is non-zero: `armed` is set
  // false before the composer opens, so the capture root's responder is not
  // claiming touches and the inspector is not hit-testing. The return to
  // zero is therefore also the moment re-arming becomes safe — see the snap
  // below.
  const pushAnim = useRef(new Animated.Value(0)).current;
  const screen = { width: windowWidth, height: windowHeight };
  /**
   * WHICH SHEET IS OVER THE APP. The composer, or one of the two detail
   * panes — the same problem (see src/push.ts), one transform, one
   * covered-height measurement, because at most one of them is on screen.
   */
  const detailSubject: DetailPushSubject | null = openMarker ?? openComment ?? null;
  const sheetOpen = !!capture || !!detailSubject;
  const coveredTop = sheetOpen ? composerOccludedTop(windowHeight, coveredHeight) : undefined;
  const pushFrame = capture
    ? // The live selection while there is one (the sheet is designed to be
      // read next to its highlight, so it usually survives), and the
      // captured hit's own frame otherwise.
      (selection?.target?.frame ?? capture.areaRect ?? capture.hit?.frame ?? null)
    : // A detail pane has only what the server stored, and only when it can
      // be trusted — `detailPushFrame` returns null for an item captured on
      // another screen, or one whose frame cannot belong to this window.
      detailPushFrame(detailSubject, routeName, screen);
  // NO CONDITION BUT THE GEOMETRY. Every "should we?" this used to ask is
  // already inside `appPushTranslation`, which answers 0 for an element that
  // is clear, a frame it does not believe, and a sheet that has not measured
  // itself yet.
  const pushBy = sheetOpen
    ? appPushTranslation({ frame: pushFrame, coveredTop, screen })
    : 0;
  // The latch (see `pushing` above), and the measurement that belongs to
  // whichever sheet made it: a pane that closes must not leave its covered
  // strip — or its ceiling — behind for the next one.
  useEffect(() => {
    if (!sheetOpen) {
      setCoveredHeight(null);
      setPushing(false);
    } else if (pushBy > 0) setPushing(true);
  }, [sheetOpen, pushBy]);
  useEffect(() => {
    if (!sheetOpen) {
      // SNAP, do not animate, when the sheet is gone. The composer has no
      // exit animation — its Modal simply unmounts (a detail pane's slides
      // out, and the app being back where it belongs by then is right) — so
      // an animated return would slide the app back under a sheet that is
      // not there any more, and would leave `measureInWindow` answering
      // against a moving tree for a fifth of a second in which the user can
      // already re-arm.
      pushAnim.setValue(0);
      return;
    }
    Animated.timing(pushAnim, {
      toValue: -pushBy,
      // The sheet's own slide, to the millisecond: the two are one gesture.
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [sheetOpen, pushBy, pushAnim]);

  // The aim chrome is placed in untranslated coordinates and then carried up
  // by the same transform, so its limits move with it (src/push.ts).
  const aimBounds = pushedAimBounds(pushBy, coveredTop);

  // Env present but handshake pending/failed — or the user put the overlay
  // away for this run. Either way the app is untouched: no chrome, no aim,
  // no transform, and the context reads as inactive.
  //
  // THE TREE SHAPE DOES NOT CHANGE WITH IT. Returning bare `children` here
  // and the wrapped tree below swapped the element types above the host
  // app, and React remounted all of it — on every dev cold start (the
  // handshake lands after first render), on "hide until restart", and twice
  // per endpoint change: navigation reset, forms emptied, mount effects ran
  // again. Only what is drawn beside the app may depend on `live`.
  const live = enabled && !prefs.hidden;
  const contextValue = useMemo<AnnoKitContextValue>(
    () =>
      live
        ? {
            enabled,
            armed,
            setArmed,
            comments,
            allComments,
            commentsAvailable,
            refreshComments,
            pending,
            refreshPending,
            removeAnnotation,
          }
        : INACTIVE_CONTEXT,
    [
      live,
      enabled,
      armed,
      setArmed,
      comments,
      allComments,
      commentsAvailable,
      refreshComments,
      pending,
      refreshPending,
      removeAnnotation,
    ],
  );

  return (
    <AnnoKitContext.Provider value={contextValue}>
      <View style={{ flex: 1 }} collapsable={false}>
        {/*
          THE MOVING PART. In overlay mode this transform is zero and this is
          simply the tree it always was. In push mode it carries the app AND
          everything anchored to the app's coordinates upward together, so a
          highlight measured against the app stays on the element it
          measured. See src/push.ts for what is deliberately left behind.
        */}
        <Animated.View
          style={{ flex: 1, transform: [{ translateY: live ? pushAnim : 0 }] }}
          collapsable={false}
          testID="annokit-push-layer"
        >
          <AnnoKitCaptureRoot
            armed={armed && live}
            onAim={onAim}
            onSelect={onSelect}
            onAimCancel={cancelAimGesture}
            rootRef={captureRootRef}
          >
            {children}
          </AnnoKitCaptureRoot>
          {/*
            Area mode draws on a layer over the app, so dragging out a
            rectangle cannot scroll a list underneath (src/capture.tsx).
            Before the chrome below, which stays tappable on top of it.
          */}
          {live && armed && aimMode === "area" && !capture && !shooting && (
            <AnnoKitAreaPad
              rootRef={captureRootRef}
              onAim={onAim}
              onSelect={onSelect}
              onAimCancel={cancelAimGesture}
            />
          )}
          {live && (
            <>
              {/*
                Everything below is chrome, and it all lives OUTSIDE the capture
                root on purpose: the inspector hit-tests that subtree only, so
                none of it can be mistaken for the annotated element. The aim
                views are additionally pointerEvents="none" (they overlap the app;
                a touchable view there would poison Fabric's hit-test), while the
                confirm bar and the FAB are meant to be tapped.
              */}
              {/*
                Banked multi-select outlines: dashed, numbered, and NOT the live
                aim — the solid outline below stays reserved for what the finger
                is doing now.
              */}
              {/* The area rectangle: live while the drag draws it, kept after release. */}
              {(areaDraft ?? areaSel?.rect) && <AnnoKitAreaBox rect={(areaDraft ?? areaSel?.rect)!} />}
              {/*
                Only when there is a frame with area. A position-only selection
                has nothing to outline — the confirm button appearing at the tap
                point is the feedback — and a degenerate box would point at
                nothing.
              */}
              {selection?.target && (
                <AnnoKitAim
                  target={selection.target}
                  occludedTop={capture ? aimBounds.occludedTop : undefined}
                  topMargin={capture ? aimBounds.topMargin : undefined}
                />
              )}
              {/*
                Markers are tappable only while IDLE: armed, they go inert so the
                aim gesture reaches the capture root instead of a marker sitting
                over the app (src/markers.tsx explains the hit-test rules).

                They are also drawn at capture-time window coordinates, which is
                why they are INSIDE the pushed layer: an app moved out from under
                its own marks would be the same lie as a detached highlight.
              */}
              <AnnoKitMarkers
                annotations={pending}
                comments={comments}
                routeName={routeName}
                armed={armed}
                // Tier-2 interception: the host's pane instead of ours. The
                // boundary highlight keys off OUR open state, so intercepted
                // opens draw no boundary (the host owns that experience).
                onOpen={onOpenTask ?? setOpenMarkerId}
                onOpenComment={onOpenComment ?? setOpenCommentId}
                openId={openMarkerId ?? openCommentId}
                // Any open sheet freezes the re-anchor poll: push mode moves
                // the marker layer itself, and a live measure under that
                // transform double-shifts the dots (src/markers.tsx).
                pauseAnchorPoll={sheetOpen}
                highlightCommentId={highlightCommentId}
                taskCounts={taskCounts}
                workingNoteIds={workingNoteIds}
              />
              {/*
                `final` only: mid-drag the user is still surveying, and a button
                chasing their finger is noise they cannot tap anyway. It appears
                the moment they lift.
              */}
              {(selection?.final || areaSel) && !capture && !shooting && (
                <AnnoKitAimConfirm
                  // Anchored to the area rectangle in area mode; otherwise to
                  // the live selection.
                  target={
                    areaSel
                      ? { frame: areaSel.rect, label: areaLabel(areaSel.rect) }
                      : aimAnchorTarget(selection!)
                  }
                  confirmLabel="Annotate"
                  onConfirm={openComposer}
                  onDismiss={dismissAim}
                />
              )}
            </>
          )}
        </Animated.View>
        {live && (
          <>
            {/* Mode chip: chrome, so OUTSIDE the capture root — it must stay tappable while armed. */}
            {armed && !capture && !shooting && (
              <AnnoKitModeToggle mode={aimMode} onToggle={toggleAimMode} />
            )}
            {/*
              The agent is working. Hidden while ARMED or composing: aiming is a
              precise gesture and the composer is about one element, and a bar
              reporting something else is exactly the wrong moment to move pixels
              near the user's finger. The work carries on either way; the banner
              comes back when they are done.
            */}
            {prefs.agentBanner && agentWork.count > 0 && !armed && !capture && (
              <AnnoKitAgentBanner
                activity={agentWork}
                // One task in flight: open it. Several: the queue, which
                // marks every one of them.
                // A host that opens tasks itself (onOpenTask) gets this one too.
                onPress={() =>
                  agentWork.taskId ? (onOpenTask ?? showTask)(agentWork.taskId) : setQueueOpen(true)
                }
              />
            )}
            <AnnoKitFab
              armed={armed}
              pendingCount={pending.length}
              noteCount={openNoteCount(allComments)}
              working={agentWork.count > 0}
              onToggleArm={toggleArmed}
              onOpenQueue={() => setQueueOpen(true)}
              onOpenNotes={() => setNotesOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
            {capture &&
              (renderComposer ? (
                // TIER-2 SLOT: the host's sheet, our flow. Push mode stays off
                // (a replaced sheet reports no covered height) — documented in
                // docs/ui-overrides.md.
                renderComposer(
                  buildComposerSlotProps(capture, {
                    transport,
                    sessionId,
                    onAgentSubmitted: refreshPending,
                    onCommentSubmitted: () => {
                      refreshComments();
                      refreshAllComments();
                    },
                    dismiss: clearAim,
                    captureScreenshot: captureScreenshotNow,
                    commentsAvailable,
                    close: closeComposer,
                    // Same default the built-in sheet uses: the asset library.
                    attachmentSources:
                      serverFlavor() === "agentation" ? [] : (attachmentSources ?? [assetsSource]),
                  }),
                )
              ) : (
                <AnnoKitComposer
                  env={env}
                  transport={transport}
                  capture={capture}
                  sessionId={sessionId}
                  // Compat: no attachment routes exist on an agentation server —
                  // an empty source list keeps "+ Attach" off the sheet entirely.
                  attachmentSources={serverFlavor() === "agentation" ? [] : attachmentSources}
                  commentsAvailable={commentsAvailable}
                  agent={serverAgent}
                  onCovered={setCoveredHeight}
                  // Hidden while the shot is taken, so the sheet is not in it.
                  hidden={shooting}
                  onRequestScreenshot={captureScreenshotNow}
                  onClearScreenshot={clearScreenshotNow}
                  pushing={pushing}
                  onSubmitted={(_id: string, destination: SubmitDestination) => {
                    closeComposer();
                    // Refresh the list the thing actually landed in — the composer
                    // reports where it went, which is only known at submit time.
                    if (destination === "comment") {
                      refreshComments();
                      refreshAllComments();
                    } else {
                      refreshPending();
                      // A NEW TASK OPENS THE QUEUE. Creating one is the end of a
                      // workflow, and a sheet closing is a thin confirmation for
                      // it — the queue is where the task's status actually lives,
                      // and where an agent working on it shows up. A team note
                      // does NOT do this: a note is a remark made in passing, and
                      // taking the screen away would interrupt the pass.
                      setQueueOpen(true);
                    }
                  }}
                  onCancel={closeComposer}
                />
              ))}
            {openMarker && (
              <AnnoKitThreadView
                transport={transport}
                annotation={openMarker}
                onCovered={setCoveredHeight}
                pushing={pushing}
                onDelete={removeAnnotation}
                onOpenNote={showNote}
                // The task's server state moved (a reply reopened it, or the
                // agent resolved it): the queue and the markers are stale.
                onChanged={refreshPending}
                agentBusy={prefs.blockSendWhileWorking && agentWork.count > 0}
                onSent={() => {
                  setOpenMarkerId(null);
                  refreshPending();
                }}
                onClose={() => setOpenMarkerId(null)}
              />
            )}
            {openComment && (
              <AnnoKitCommentView
                transport={transport}
                sessionId={env.sessionId}
                comment={openComment}
                onCovered={setCoveredHeight}
                pushing={pushing}
                annotations={knownTasks}
                onUpdated={applyComment}
                onDeleted={dropComment}
                onTaskCreated={() => refreshPending()}
                onOpenTask={showTask}
                onClose={() => setOpenCommentId(null)}
              />
            )}
            {queueOpen && (
              <AnnoKitQueue
                transport={transport}
                annotations={pending}
                // One agent at a time — unless the host has said their server
                // can take more (src/prefs.ts blockSendWhileWorking).
                agentBusy={prefs.blockSendWhileWorking && agentWork.count > 0}
                onRefresh={refreshPending}
                onDelete={removeAnnotation}
                onOpenNote={showNote}
                // "Clear queue after sending" (src/prefs.ts): the tasks the
                // server has just taken leave the list instead of sitting in it
                // looking unsent. Optimistic and local — the refresh behind it
                // is still the source of truth.
                onSent={prefs.clearOnSend ? (ids) => dropSentAnnotations(ids) : undefined}
                // agentation has no GET /sessions/:sid: no Done tab there.
                sessionId={serverFlavor() === "agentation" ? undefined : sessionId}
                onClose={() => setQueueOpen(false)}
              />
            )}
            {settingsOpen && (
              <AnnoKitSettings
                endpoint={env.endpoint}
                // agentation-mcp has no /agent route; asking would only 404.
                transport={serverFlavor() === "agentation" ? undefined : transport}
                initialAgent={serverAgent}
                onClose={() => setSettingsOpen(false)}
              />
            )}
            {notesOpen && (
              <AnnoKitNotes
                comments={allComments.length ? allComments : comments}
                commentsAvailable={commentsAvailable}
                routeName={routeName}
                onRefresh={refreshAllComments}
                onSelect={goToNote}
                onClose={() => setNotesOpen(false)}
              />
            )}
          </>
        )}
      </View>
    </AnnoKitContext.Provider>
  );
}
