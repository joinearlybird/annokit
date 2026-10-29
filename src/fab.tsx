/**
 * The overlay's floating control: a round button that EXPANDS into a
 * compact toolbar, and that can be DRAGGED out of the way — it snaps to the
 * nearer side on release and stays where it was left for the rest of the
 * session (src/fab-drag.ts; layout and action list in src/toolbar.ts).
 *
 * COLLAPSED → tap expands the toolbar (armed, tap is the cancel instead);
 * long-press still opens the queue, now as a shortcut rather than the only
 * way in. EXPANDED → labelled buttons: Annotate, Queue (carrying the
 * pending count), Comments, Settings, Close. There is ONE capture action, not one per
 * destination: marking an element and deciding who reads it are separate
 * decisions, and only the second one belongs in the composer. The single button no longer wears a count badge:
 * a numeral on a toggle said nothing about what the toggle did.
 *
 * TAP vs DRAG: the pan responder only claims the touch once the finger has
 * moved past FAB_DRAG_THRESHOLD (`onMoveShouldSetPanResponder`), never on
 * touch-down. Below the threshold the Pressable underneath keeps the touch,
 * so every button behaves normally; past it the Pressable is terminated
 * mid-press and the gesture becomes a drag, which is why a drag never also
 * fires onPress — collapsed or expanded, since the responder lives on the
 * wrapper both states share.
 *
 * Like all this package's chrome, it is rendered OUTSIDE the capture root
 * (src/index.tsx), so no position it can be dragged to — and no width it
 * can expand to — makes it visible to the annotation hit-test.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import { useReduceMotion } from "./reduce-motion";
import {
  FAB_SIZE,
  clampFabPosition,
  defaultFabPosition,
  isFabDrag,
  recallFabPosition,
  rememberFabPosition,
  snapFabToEdge,
} from "./fab-drag";
import type { FabPoint } from "./fab-drag";
import { AnnoKitIcon } from "./icon";
import {
  TOOLBAR_HEIGHT,
  TOOLBAR_ITEM_WIDTH,
  TOOLBAR_PADDING,
  collapsedTapAction,
  shouldCollapseToolbar,
  toolbarActions,
  toolbarItemWidth,
  toolbarPlacement,
} from "./toolbar";
import type { ToolbarActionKey } from "./toolbar";

interface Props {
  armed: boolean;
  pendingCount: number;
  /** Open team notes, across every screen. */
  noteCount?: number;
  /**
   * The server says an agent has a task (src/agent-activity.ts). The button
   * pulses in the agent's colour: it is the one piece of chrome always on
   * screen, where the banner is not — the banner hides while annotating and
   * behind every sheet, and can be switched off.
   */
  working?: boolean;
  /** Arm the capture gesture — or, when already armed, disarm. */
  onToggleArm: () => void;
  onOpenQueue: () => void;
  onOpenNotes: () => void;
  onOpenSettings: () => void;
}

export function AnnoKitFab({
  armed,
  pendingCount,
  noteCount,
  working = false,
  onToggleArm,
  onOpenQueue,
  onOpenNotes,
  onOpenSettings,
}: Props) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const screen = useWindowDimensions();
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const start = useMemo(
    () => recallFabPosition() ?? defaultFabPosition(screen),
    // Only the first mount decides the starting corner; later screen
    // changes are handled by the clamp effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // The position IS the animated value (no mirrored state), so a drag never
  // waits on a React render and release never flickers between the two.
  const pos = useRef(new Animated.ValueXY(start)).current;
  const posRef = useRef<FabPoint>(start);
  const dragStart = useRef<FabPoint>(start);
  const dragging = useRef(false);
  const [expanded, setExpanded] = useState(false);
  // A React-visible copy of the position, updated only when the button
  // comes to rest. The toolbar's opening side is decided from it, so it
  // must not re-render on every frame of a drag.
  const [anchor, setAnchor] = useState<FabPoint>(start);

  const actions = toolbarActions({ armed, pendingCount, noteCount });
  const itemWidth = toolbarItemWidth(actions.length, screen.width);
  const placement = useMemo(
    () => toolbarPlacement(anchor, screen, actions.length, FAB_SIZE, undefined, itemWidth),
    [anchor, screen, actions.length, itemWidth],
  );

  useEffect(() => {
    const id = pos.addListener((value) => {
      posRef.current = value;
    });
    return () => pos.removeListener(id);
  }, [pos]);

  // Rotation / window resize: a remembered corner can end up off-screen.
  useEffect(() => {
    const clamped = clampFabPosition(posRef.current, screen);
    if (clamped.x !== posRef.current.x || clamped.y !== posRef.current.y) {
      pos.setValue(clamped);
      rememberFabPosition(clamped);
      setAnchor(clamped);
    }
  }, [pos, screen.width, screen.height]);

  // Aiming starts: put the toolbar away so it is not sitting on top of the
  // element the user is trying to annotate.
  useEffect(() => {
    if (shouldCollapseToolbar(armed, expanded)) setExpanded(false);
  }, [armed, expanded]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Never on touch-down: that touch belongs to the Pressable.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => isFabDrag(g.dx, g.dy),
        onPanResponderGrant: () => {
          dragging.current = true;
          dragStart.current = posRef.current;
        },
        onPanResponderMove: (_e, g) => {
          pos.setValue(
            clampFabPosition(
              { x: dragStart.current.x + g.dx, y: dragStart.current.y + g.dy },
              screenRef.current,
            ),
          );
        },
        onPanResponderRelease: () => {
          dragging.current = false;
          const target = snapFabToEdge(posRef.current, screenRef.current);
          rememberFabPosition(target);
          // Re-anchor once it has come to rest: dragging an OPEN toolbar
          // across the screen must flip which way it opens.
          setAnchor(target);
          Animated.spring(pos, {
            toValue: target,
            useNativeDriver: false, // left/top-equivalent transform of a layout value
            friction: 7,
            tension: 60,
          }).start();
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          rememberFabPosition(posRef.current);
          setAnchor(posRef.current);
        },
      }),
    [pos],
  );

  const run = (key: ToolbarActionKey) => {
    // Belt and braces: a drag terminates the Pressable, but no action may
    // fire as a side effect of moving the toolbar.
    if (dragging.current) return;
    // Every action closes the toolbar — it has done its job, and armed
    // mode in particular needs the screen back.
    setExpanded(false);
    if (key === "annotate") onToggleArm();
    else if (key === "queue") onOpenQueue();
    else if (key === "comments") onOpenNotes();
    else if (key === "settings") onOpenSettings();
  };

  const onCollapsedPress = () => {
    if (dragging.current) return;
    if (collapsedTapAction(armed) === "disarm") onToggleArm();
    else {
      setAnchor(posRef.current);
      setExpanded(true);
    }
  };

  return (
    <Animated.View
      style={[
        styles.wrapper,
        expanded
          ? { width: placement.width, height: TOOLBAR_HEIGHT }
          : { width: FAB_SIZE, height: FAB_SIZE },
        {
          transform: [
            // Expanding must not move the docked edge under the user's
            // thumb, so the growth is absorbed by this offset.
            { translateX: expanded ? Animated.add(pos.x, placement.offsetX) : pos.x },
            { translateY: pos.y },
          ],
        },
      ]}
      {...responder.panHandlers}
    >
      {expanded ? (
        <View style={styles.toolbar} testID="annokit-toolbar">
          {actions.map((a) => (
            <Pressable
              key={a.key}
              testID={`annokit-toolbar-${a.key}`}
              accessibilityRole="button"
              accessibilityLabel={a.accessibilityLabel}
              onPress={() => run(a.key)}
              style={({ pressed }) => [styles.item, { width: itemWidth }, pressed && styles.pressed]}
            >
              <View style={styles.itemIconRow}>
                <AnnoKitIcon name={a.icon} size={15} color={p.chromeInk} />
                {a.badge && (
                  <Text style={styles.itemBadge} testID={`annokit-toolbar-${a.key}-count`}>
                    {a.badge}
                  </Text>
                )}
              </View>
              <Text style={styles.itemLabel} numberOfLines={1}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View>
        {/* Armed has its own look and its own job; the pulse waits it out. */}
        {working && !armed && <WorkingPulse />}
        <Pressable
          testID="annokit-fab"
          accessibilityRole="button"
          accessibilityLabel={
            armed
              ? "Cancel annotate mode"
              : working
                ? "Open the annotate toolbar (drag to move). The agent is working"
                : "Open the annotate toolbar (drag to move)"
          }
          // Armed is a mode, not a one-shot action: "selected" is how a
          // screen reader conveys a control that is currently engaged.
          accessibilityState={{ selected: armed }}
          onPress={onCollapsedPress}
          onLongPress={() => {
            // Kept as a shortcut for anyone who learned it; the Queue
            // button in the toolbar is now the discoverable way in.
            if (!dragging.current) onOpenQueue();
          }}
          delayLongPress={350}
          style={({ pressed }) => [
            styles.fab,
            // ONE armed colour. Blue is the overlay's own; the orange
            // half of the palette belongs to comments, and a comment is now
            // something you CHOOSE in the composer, not something you arm.
            armed && styles.fabArmed,
            working && !armed && styles.fabWorking,
            pressed && styles.pressed,
          ]}
        >
          {/*
            IDLE is always the pencil — the overlay's own mark. A collapsed
            tap opens the toolbar rather than arming anything, so wearing
            the comment glyph there would promise a capture it does not make.
          */}
          <AnnoKitIcon
            name={armed ? "close" : "annotate"}
            size={21}
            color={armed ? p.onAccent : working ? p.agentText : p.chromeInk}
          />
        </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

/**
 * A ring in the agent's colour that swells out from behind the button and
 * fades, once a second and a half, for as long as the agent is working.
 * Under Reduce Motion it holds still as a plain ring: the fact is the same,
 * the movement is not needed to state it.
 */
function WorkingPulse() {
  const styles = useStyles();
  const t = useRef(new Animated.Value(0)).current;
  const still = useReduceMotion();

  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [still, t]);

  const style = still
    ? { opacity: 0.6, transform: [{ scale: 1.15 }] }
    : {
        opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
      };
  return <Animated.View pointerEvents="none" style={[styles.pulse, style]} testID="annokit-fab-working" />;
}

const useStyles = themedStyles((p) => ({
  wrapper: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 10000,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: p.chrome,
    borderWidth: 1,
    borderColor: p.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: p.shadow,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  fabArmed: {
    backgroundColor: p.agent,
    borderColor: p.agentSoft,
  },
  fabWorking: {
    borderColor: p.agent,
    borderWidth: 2,
  },
  pulse: {
    position: "absolute",
    left: 0,
    top: 0,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    borderWidth: 3,
    borderColor: p.agent,
  },
  icon: {
    color: p.chromeInk,
    fontSize: 20,
    lineHeight: 22,
  },
  toolbar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    padding: TOOLBAR_PADDING,
    borderRadius: TOOLBAR_HEIGHT / 2,
    backgroundColor: p.chrome,
    borderWidth: 1,
    borderColor: p.borderStrong,
    shadowColor: p.shadow,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  item: {
    width: TOOLBAR_ITEM_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  itemIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  itemIcon: {
    color: p.chromeInk,
    fontSize: 14,
    lineHeight: 16,
  },
  itemBadge: {
    color: p.agentSoft,
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "700",
  },
  itemLabel: {
    color: p.textBody,
    fontSize: 10,
    lineHeight: 12,
    marginTop: 1,
  },
  pressed: {
    opacity: 0.8,
  },
}));
