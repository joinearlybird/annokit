/**
 * Marker dots for what has been left on THIS screen — this session's
 * pending annotations AND the team's comments — shown at their captured
 * window coordinates and filtered to the current expo-router pathname
 * (markers made on other screens stay hidden).
 *
 * TWO MARKS, TOLD APART TWICE OVER. An AGENT TASK is a BLUE CIRCLE with
 * its queue number; a TEAM NOTE is an ORANGE ROUNDED SQUARE with a quotation
 * glyph (the wire words are still `annotation` and `comment` — see
 * src/destination.ts for why the UI says something else). Different hue and different silhouette, so they are distinguished
 * at a glance and still distinguishable without colour. A comment that is
 * resolved — or that has been converted into an annotation — keeps its mark
 * but fades to 45%: settled discussion must be findable without competing
 * with the live screen. The tokens are in src/marker-hit.ts
 * (`markerAppearance`), so what a marker MEANS and how it is drawn stay one
 * decision.
 *
 * ONE MARK PER ANCHORED THING. A task made from a note's message gets NO
 * marker of its own — `visibleMarkers` drops it — because the note already
 * marks that element; the note's orange square carries a blue task pip
 * instead. That is decided in the model, not here, so the numbering and the
 * tap resolution below both see the same set.
 *
 * Coordinates are the capture-time window coords; scroll offset re-anchoring
 * is deliberately deferred (plan §2.3 — accept fuzz in v1).
 *
 * IDLE MARKERS ARE BUTTONS; ARMED MARKERS ARE NOT. Tapping a marker opens
 * that annotation's detail — or that comment's thread — which is the only
 * way to get from "I can see it there" back to reading it without going
 * through the queue. While ARMED the user is targeting the app's own
 * components, so the markers drop back to `pointerEvents="none"`: they sit
 * over the app, and a touchable view there would swallow the gesture before
 * src/capture.tsx could claim it.
 *
 * Like the FAB and the confirm bar, this component is rendered OUTSIDE
 * AnnoKitCaptureRoot (see src/index.tsx). That is what keeps our own
 * chrome out of the annotation: the inspector only ever hit-tests the
 * capture root's subtree, so no marker can be resolved as the target.
 *
 * The touch target is grown to 44pt around a dot that stays 22pt, and which
 * marker a tap opens is decided by src/marker-hit.ts — over BOTH kinds at
 * once — rather than by whichever overlapping sibling react-native happened
 * to hand the touch to.
 */

import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import type { GestureResponderEvent } from "react-native";
import type { Comment } from "./comments";
import { AnnoKitIcon } from "./icon";
import {
  MARKER_SIZE,
  combineMarkers,
  markerAppearance,
  markerTouchPadding,
  markerWorking,
  markersInteractive,
  pickMarkerAt,
  visibleMarkers,
} from "./marker-hit";
import type { MarkerPlacement } from "./marker-hit";
import { markerTaskCountLabel } from "./message-task";
import { useReduceMotion } from "./reduce-motion";
import {
  advanceAnchorTrack,
  anchorTracksEqual,
  applyAnchorFixes,
  emptyAnchorTrack,
  hasScrollAnchor,
  markerPositionTrusted,
  measureAnchorFixes,
  idsNearViewport,
  measureAnchorRect,
  nextAnchorDelay,
} from "./anchor-registry";
import type { AnchorTrack } from "./anchor-registry";
import { debugLog } from "./log";
import { SCROLL_REPORT_SETTLE_MS, subscribeAnnoKitScroll } from "./scroll-reporter";
import type { ServerAnnotation } from "./types";

interface Props {
  annotations: ServerAnnotation[];
  /** The team's comments on this screen. Absent when comments are off/unavailable. */
  comments?: Comment[];
  routeName: string | null;
  /** Armed mode: markers become inert so the aim gesture reaches the app. */
  armed: boolean;
  /** Open an annotation's detail. Omitted = markers stay decoration. */
  onOpen?: (id: string) => void;
  /** Open a comment's thread. Omitted = comment markers stay decoration. */
  onOpenComment?: (id: string) => void;
  /**
   * The mark whose detail pane is open right now. Its captured element gets
   * its boundary drawn — the aim outline's language, in the kind's colour —
   * so "which thing is this about" survives the pane opening over the app.
   * The box rides the SAME anchor fix as its marker: shifted content shows
   * the boundary where the element is, not where it was.
   */
  openId?: string | null;
  /**
   * A comment the user was just taken to from the notes list. Its marker
   * pulses for a moment so that, when they close the detail, they can SEE
   * which dot on this screen they arrived at — otherwise a cross-route jump
   * ends on a screen full of identical marks. Cleared by the provider on a
   * timer; nothing here depends on it ever arriving.
   */
  highlightCommentId?: string | null;
  /**
   * How many agent tasks each note has produced (`commentTaskCounts`).
   *
   * ONE MARKER PER ANCHORED THING. A task made from a note is not given its
   * own dot: it would sit at the same coordinates as the note's, in a
   * different colour, saying nearly the same sentence (product owner). The
   * note's existing orange square gains a small blue pip instead — quiet,
   * legible at 22pt, and the count lives in the accessibility label where a
   * numeral would be unreadable.
   */
  taskCounts?: Record<string, number>;
  /**
   * Notes one of whose tasks the agent is working on right now. Their
   * marker wears the working ring, as a task's own marker does.
   */
  workingNoteIds?: ReadonlySet<string>;
  /**
   * Freeze the re-anchor poll. Set while ANY sheet is open: the app cannot
   * scroll under a modal, and push mode may be TRANSLATING the layer the
   * markers live in — a live measure would see the lifted position and add
   * the lift on top of the transform (the double-shift the detail pane
   * exposed). Frozen fixes + the layer's own transform tell the truth.
   */
  pauseAnchorPoll?: boolean;
}

const TOUCH_PAD = markerTouchPadding();

/**
 * The re-anchor poll: measure the registered scroll pairs of the visible
 * marks on a timer, keep state only when something actually moved. Ids
 * with no anchor (no scroll container, other app run, pruned) cost
 * nothing and keep their stored coordinates.
 */
function useScrollShifts(
  markers: readonly MarkerPlacement[],
  paused: boolean,
  windowHeight: number,
): {
  track: AnchorTrack;
  /** The app just told us it is scrolling — anchored marks hide NOW. */
  eventScrolling: boolean;
} {
  const [track, setTrack] = useState<AnchorTrack>(emptyAnchorTrack);
  const [eventScrolling, setEventScrolling] = useState(false);
  // A string dep: the marker LIST is a fresh array every render, and an
  // effect keyed on it would tear the interval down each frame.
  const idsKey = markers
    .filter((m) => hasScrollAnchor(m.id))
    .map((m) => m.id)
    .join("|");
  useEffect(() => {
    // Paused: keep the LAST track exactly as it is — the layer transform
    // carries the marks; re-measuring under it would double-shift them.
    if (paused) return;
    // Every watch-list change starts a fresh track: the sticky carry-over
    // in advanceAnchorTrack is for measurement hiccups, not for ids that
    // left the list.
    setTrack((prev) => (prev.fixes.size === 0 ? prev : emptyAnchorTrack()));
    if (!idsKey) return;
    const ids = idsKey.split("|");
    debugLog(`re-anchor poll: watching ${ids.length} marker(s)`);
    let alive = true;
    let inFlight = false;
    let firstTick = true;
    /**
     * The track as the LOOP knows it, mirroring the state it publishes.
     *
     * Kept locally because the next delay is a function of what the last
     * measurement found, and a setState updater is not a place to decide
     * anything: it must stay pure, and React may run it twice.
     */
    let current: AnchorTrack = emptyAnchorTrack();
    /**
     * `full` measures every watched anchor; otherwise only those last seen
     * near the window (src/anchor-registry.ts idsNearViewport). Anything
     * that can MOVE a marker — a scroll, a navigation, the first pass —
     * asks for a full one, so a skip can only ever be one interval stale.
     */
    const tick = async (full = false) => {
      // A slow measurement must not stack the next one on top of itself.
      if (inFlight) return;
      inFlight = true;
      const target = full ? ids : idsNearViewport(current, ids, windowHeight);
      const measured = await measureAnchorFixes(target);
      inFlight = false;
      if (!alive) return;
      if (firstTick) {
        firstTick = false;
        // Distinguishes "nodes unmeasurable" (0 measured) from "measured,
        // nothing moved yet" without spamming every tick.
        debugLog(`re-anchor first measure: ${measured.size}/${ids.length} measurable`);
      }
      current = advanceAnchorTrack(current, measured);
      const next = current;
      setTrack((prev) => (anchorTracksEqual(prev, next) ? prev : next));
    };

    // ── The cadence ────────────────────────────────────────────────────
    //
    // A self-scheduling timeout rather than a fixed interval: the delay is
    // chosen AFTER each measurement from what it found (anchor-registry.ts
    // nextAnchorDelay), so a moving screen measures at 150ms and a settled
    // one drops to a slow heartbeat until something changes.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let foreground = true;
    const stopTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const schedule = (delay: number) => {
      stopTimer();
      // Backgrounded: nothing is moving that anyone can see, and a timer
      // here is pure battery. The AppState listener restarts the loop.
      if (!alive || !foreground) return;
      timer = setTimeout(() => {
        void (async () => {
          await tick();
          schedule(nextAnchorDelay(current, ids));
        })();
      }, delay);
    };
    /** Measure now and go back to the fast cadence — something happened. */
    const wake = (full = true) => {
      if (!alive) return;
      void (async () => {
        await tick(full);
        schedule(nextAnchorDelay(current, ids));
      })();
    };
    wake();

    // Foreground/background. Guarded require: this module must not make
    // react-native a hard dependency of a node test (same shape as
    // src/screenshot.ts and src/inspector.ts).
    let unsubscribeAppState: (() => void) | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AppState } = require("react-native") as {
        AppState?: {
          currentState?: string;
          addEventListener?: (t: string, h: (s: string) => void) => { remove?: () => void };
        };
      };
      if (typeof AppState?.addEventListener === "function") {
        foreground = AppState.currentState !== "background" && AppState.currentState !== "inactive";
        const sub = AppState.addEventListener("change", (state) => {
          const nowForeground = state === "active";
          if (nowForeground === foreground) return;
          foreground = nowForeground;
          if (!foreground) {
            stopTimer();
            return;
          }
          // Back in front: the screen may have moved while we were away.
          wake();
        });
        unsubscribeAppState = () => sub?.remove?.();
      }
    } catch {
      /* no react-native (node tests, SSR): stay in the foreground path */
    }
    // The fast path: while the host app reports scrolls
    // (src/scroll-reporter.ts) marks hide instantly, and the settle
    // measurement runs the moment events stop — reappearance is bounded by
    // the settle window, not the poll cadence.
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeAnnoKitScroll(() => {
      if (!alive) return;
      setEventScrolling(true);
      // A reported scroll is the loudest possible "something moved": drop
      // the pending heartbeat, because the settle measurement below is
      // what should decide the next cadence.
      stopTimer();
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        void (async () => {
          // Two quick identical measures = settled; the track shows the
          // mark at its landing position as eventScrolling clears. FULL
          // measurements: a scroll is exactly the thing that moves a marker
          // in or out of the window, so the near-set is stale by definition.
          await tick(true);
          await tick(true);
          if (!alive) return;
          setEventScrolling(false);
          schedule(nextAnchorDelay(current, ids));
        })();
      }, SCROLL_REPORT_SETTLE_MS);
    });
    return () => {
      alive = false;
      stopTimer();
      if (settleTimer) clearTimeout(settleTimer);
      unsubscribe();
      unsubscribeAppState?.();
    };
    // windowHeight is a dependency because it decides what counts as
    // "near the viewport"; a rotation restarts the loop, which is rare and
    // cheaper than measuring against a stale screen.
  }, [idsKey, paused, windowHeight]);
  return { track, eventScrolling };
}

export function AnnoKitMarkers({
  annotations,
  comments,
  routeName,
  armed,
  onOpen,
  onOpenComment,
  openId,
  highlightCommentId,
  taskCounts,
  workingNoteIds,
  pauseAnchorPoll = false,
}: Props) {
  const styles = useStyles();
  // Marks whose stored position cannot be believed are not drawn at all: a
  // mark captured inside a scrollable whose live anchor is gone (app
  // reloaded, registry pruned) would float at fixed window coordinates
  // over whatever the scroll brought there (src/anchor-registry.ts).
  // The open mark's element boundary — the LIVE rect of its anchored
  // element (src/anchor-registry.ts), asked for when the pane opens. The
  // stored-box-plus-shift arithmetic is only the fallback for a mark drawn
  // without an anchor, which the trusted rule makes rare.
  const [openLiveRect, setOpenLiveRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    setOpenLiveRect(null);
    if (!openId || !hasScrollAnchor(openId)) return;
    let alive = true;
    void measureAnchorRect(openId).then((rect) => {
      if (alive && rect) setOpenLiveRect(rect);
    });
    return () => {
      alive = false;
    };
  }, [openId]);

  const trusted = annotations.filter((a) => markerPositionTrusted(a.id));
  // Same rule for notes: live anchor or no dot. Anchors are captured at
  // submit and RECOVERED by testID after a reload (src/reanchor.ts); either
  // way the record itself stays reachable through its list.
  const trustedComments = (comments ?? []).filter((c) => markerPositionTrusted(c.id));
  // One list, one order (comments under annotations — see combineMarkers),
  // so drawing order and tap resolution cannot disagree.
  const unshifted = combineMarkers(
    visibleMarkers(trusted, routeName),
    visibleMarkers(trustedComments, routeName, "comment"),
  );
  // Marks inside a ScrollView sit wherever their ELEMENT is now
  // (src/anchor-registry.ts). Fixes are applied to the LIST, before
  // rendering AND tap resolution, so the dot you see and the dot you hit
  // cannot disagree — and while the app reports an active scroll, anchored
  // marks hide outright instead of chasing.
  // The window is what "near the viewport" is measured against; a marker
  // screens away is not worth a native measurement on the idle heartbeat.
  const { height: windowHeight } = useWindowDimensions();
  const { track, eventScrolling } = useScrollShifts(unshifted, pauseAnchorPoll, windowHeight);
  const steady = eventScrolling ? unshifted.filter((m) => !hasScrollAnchor(m.id)) : unshifted;
  const visible = applyAnchorFixes(steady, track);
  if (visible.length === 0) return null;
  const idle = markersInteractive(armed);

  const open = (m: MarkerPlacement) => {
    if (m.kind === "comment") onOpenComment?.(m.id);
    else onOpen?.(m.id);
  };
  const canOpen = (m: MarkerPlacement) => (m.kind === "comment" ? !!onOpenComment : !!onOpen);
  const isHighlighted = (m: MarkerPlacement) =>
    m.kind === "comment" && !!highlightCommentId && m.id === highlightCommentId;
  const tasksOn = (m: MarkerPlacement) =>
    m.kind === "comment" ? (taskCounts?.[m.id] ?? 0) : 0;
  const workingOn = (m: MarkerPlacement) => markerWorking(m, workingNoteIds);

  const openMark = openId ? visible.find((m) => m.id === openId) : undefined;
  const openRecord = openMark
    ? openMark.kind === "comment"
      ? (comments ?? []).find((c) => c.id === openMark.id)
      : annotations.find((a) => a.id === openMark.id)
    : undefined;
  const openStored =
    openMark && openRecord && openRecord.boundingBox && openRecord.x !== undefined
      ? openRecord
      : undefined;
  return (
    <>
      {openMark && (openLiveRect || openStored?.boundingBox) ? (
        <View
          pointerEvents="none"
          testID="annokit-open-boundary"
          style={[
            styles.openBoundary,
            openMark.kind === "comment" ? styles.openBoundaryComment : null,
            openLiveRect
              ? {
                  left: openLiveRect.x,
                  top: openLiveRect.y,
                  width: openLiveRect.width,
                  height: openLiveRect.height,
                }
              : {
                  left:
                    openStored!.boundingBox!.x + (openMark.x - (openStored!.x ?? openMark.x)),
                  top: openStored!.boundingBox!.y + (openMark.y - (openStored!.y ?? openMark.y)),
                  width: openStored!.boundingBox!.width,
                  height: openStored!.boundingBox!.height,
                },
          ]}
        />
      ) : null}
      {visible.map((m) =>
        idle && canOpen(m) ? (
          <MarkerButton
            key={markerKey(m)}
            marker={m}
            markers={visible}
            onOpen={open}
            highlighted={isHighlighted(m)}
            taskCount={tasksOn(m)}
            working={workingOn(m)}
          />
        ) : (
          <View
            key={markerKey(m)}
            pointerEvents="none"
            testID={testIdFor(m)}
            style={[styles.hitbox, hitboxPosition(m)]}
          >
            <MarkerDot
              marker={m}
              highlighted={isHighlighted(m)}
              taskCount={tasksOn(m)}
              working={workingOn(m)}
            />
          </View>
        ),
      )}
    </>
  );
}

function MarkerButton({
  marker,
  markers,
  onOpen,
  highlighted,
  taskCount,
  working,
}: {
  marker: MarkerPlacement;
  markers: MarkerPlacement[];
  onOpen: (marker: MarkerPlacement) => void;
  highlighted?: boolean;
  taskCount?: number;
  working?: boolean;
}) {
  const styles = useStyles();
  const onPress = (e: GestureResponderEvent) => {
    // Do not assume the marker that received the touch is the one meant:
    // the grown targets overlap, so re-resolve the whole set at the touch
    // point (dot beats padding, newest wins, annotation wins an exact tie).
    // Fail soft to ourselves if the event carries no usable page coordinates.
    const { pageX, pageY } = e.nativeEvent;
    const picked = pickMarkerAt(markers, pageX, pageY);
    onOpen(picked ?? marker);
  };

  return (
    <Pressable
      testID={testIdFor(marker)}
      accessibilityRole="button"
      accessibilityLabel={
        marker.kind === "comment"
          ? `Open team note ${marker.number} — teammates see this, the agent won't act on it${
              taskCount ? `. ${markerTaskCountLabel(taskCount)}` : ""
            }${working ? ". The agent is working on one of its tasks" : ""}`
          : working
            ? `Open agent task ${marker.number} — the agent is working on it`
            : `Open agent task ${marker.number} — the agent will make this change`
      }
      onPress={onPress}
      style={({ pressed }) => [styles.hitbox, hitboxPosition(marker), pressed && styles.pressed]}
    >
      <MarkerDot marker={marker} highlighted={highlighted} taskCount={taskCount} working={working} />
    </Pressable>
  );
}

function MarkerDot({
  marker,
  highlighted,
  taskCount,
  working,
}: {
  marker: MarkerPlacement;
  highlighted?: boolean;
  taskCount?: number;
  working?: boolean;
}) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const look = markerAppearance(marker.kind, marker.status, p);
  return (
    <>
      {working && <MarkerWorking color={p.agent} />}
      {highlighted && <MarkerPulse color={look.fill} />}
      <View
        pointerEvents="none"
        style={[
          styles.marker,
          {
            backgroundColor: look.fill,
            borderColor: look.border,
            opacity: look.opacity,
            // Circle vs rounded square: the silhouette is half the difference.
            borderRadius: look.shape === "circle" ? MARKER_SIZE / 2 : 6,
          },
        ]}
      >
        {marker.kind === "comment" ? (
          <AnnoKitIcon name="comment" size={12} color={look.ink} />
        ) : (
          <Text style={[styles.markerText, { color: look.ink }]}>{marker.number}</Text>
        )}
        {/*
          "This discussion has produced work." A blue pip on the note's own
          corner, not a second marker: one mark per anchored thing. No
          numeral — at 8pt it would be a smudge — the count is in the label.
        */}
        {!!taskCount && taskCount > 0 && (
          <View style={styles.taskPip} pointerEvents="none" testID="annokit-marker-task-pip" />
        )}
      </View>
    </>
  );
}

/**
 * "It is this one." Two slow rings out of the marker and then nothing —
 * enough to find a dot on a screen you have just been navigated to, and
 * short enough that it is never part of the interface. `useNativeDriver`
 * because it animates only transform and opacity, so it never touches the
 * JS thread the app under it is using.
 */
function MarkerPulse({ color }: { color: string }) {
  const styles = useStyles();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      { iterations: 2 },
    );
    anim.start();
    return () => anim.stop();
  }, [progress]);
  return (
    <Animated.View
      pointerEvents="none"
      testID="annokit-marker-pulse"
      style={[
        styles.pulse,
        {
          borderColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.75, 0] }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) },
          ],
        },
      ]}
    />
  );
}

/**
 * "The agent is on this one." A ring in the agent's colour swelling out of
 * the marker and fading, for as long as the task is `working` — unlike
 * MarkerPulse, which runs twice and stops, because this is a state, not an
 * arrival. Native-driven like that one. Under Reduce Motion it is a still
 * ring (src/reduce-motion.ts).
 */
function MarkerWorking({ color }: { color: string }) {
  const styles = useStyles();
  const still = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const anim = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [still, t]);
  const motion = still
    ? { opacity: 0.7, transform: [{ scale: 1.35 }] }
    : {
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
      };
  return (
    <Animated.View
      pointerEvents="none"
      testID="annokit-marker-working"
      style={[styles.pulse, { borderColor: color }, motion]}
    />
  );
}

/** Ids are unique per kind, not across kinds. */
function markerKey(m: MarkerPlacement): string {
  return `${m.kind}-${m.id}`;
}

function testIdFor(m: MarkerPlacement): string {
  return m.kind === "comment"
    ? `annokit-comment-marker-${m.number}`
    : `annokit-marker-${m.number}`;
}

/** Centre the (invisible) touch box on the marker's point. */
function hitboxPosition(m: MarkerPlacement) {
  const half = MARKER_SIZE / 2 + TOUCH_PAD;
  return { left: m.x - half, top: m.y - half };
}

const useStyles = themedStyles((p) => ({
  // The aim outline's language, worn by the OPEN mark's element: agent blue
  // (comment variant overrides to the team's orange), soft tint, under the
  // markers so the dot stays on top.
  openBoundary: {
    position: "absolute",
    borderWidth: 2,
    borderColor: p.agent,
    backgroundColor: p.agentTintSoft,
    borderRadius: 8,
    zIndex: 9990,
  },
  openBoundaryComment: {
    borderColor: p.team,
    backgroundColor: p.teamTintSoft,
  },
  // The box that takes the touch: 44pt, transparent, centred on the dot.
  hitbox: {
    position: "absolute",
    padding: TOUCH_PAD,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9998,
  },
  marker: {
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: p.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  markerText: {
    fontSize: 12,
    fontWeight: "700",
  },
  /**
   * 9pt of blue with a pale ring, sitting on the orange square's top-right
   * corner. Big enough to see at marker size, small enough that the marker
   * still reads as one mark rather than two.
   */
  taskPip: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: p.agent,
    borderWidth: 1,
    borderColor: p.agentEdge,
  },
  pressed: {
    opacity: 0.7,
  },
  pulse: {
    position: "absolute",
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    borderWidth: 2,
  },
}));
