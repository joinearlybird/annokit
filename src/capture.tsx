/**
 * Root-level tap capture (Phase 1 spike finding 4).
 *
 * A full-screen overlay SIBLING poisons Fabric's findNodeAtPoint — it would
 * become the touched node for every point. Instead the app's own subtree is
 * wrapped in a View whose onStartShouldSetResponderCapture intercepts the
 * touch (capture phase, like a capture-phase DOM listener) ONLY while armed.
 * The children underneath are what the inspector hit-test sees, and claiming
 * the responder at the root means the tap never activates the control below.
 *
 * Because the responder is claimed at the START of the touch, the whole
 * gesture belongs to us: down and move drive the aim survey (highlight what
 * is under the finger, so the user can drag to look around), and release
 * selects it. Overlay chrome that must stay tappable — the FAB, the aim
 * confirm bar — is rendered OUTSIDE this wrapper, so it is neither
 * intercepted here nor visible to the inspector's subtree hit-test.
 */

import { useRef } from "react";
import { StyleSheet, View } from "react-native";
import type { GestureResponderEvent } from "react-native";

interface Props {
  armed: boolean;
  /** Finger down or dragging: survey the element at this point. */
  onAim: (x: number, y: number, rootRef: unknown) => void;
  /** Finger lifted: select the element at this point. */
  onSelect: (x: number, y: number, rootRef: unknown) => void;
  /** The system took the gesture away; nothing was selected. */
  onAimCancel: () => void;
  /** The wrapper's own view, for hit-tests that start somewhere else (AnnoKitAreaPad). */
  rootRef?: React.MutableRefObject<View | null>;
  children: React.ReactNode;
}

export function AnnoKitCaptureRoot({ armed, onAim, onSelect, onAimCancel, rootRef: outerRef, children }: Props) {
  const ownRef = useRef<View | null>(null);
  const rootRef = outerRef ?? ownRef;
  // The responder events carry no `armed` guarantee of their own: a gesture
  // that started while armed must finish on our terms even if arming is
  // toggled mid-touch.
  const gesturing = useRef(false);

  const onStartShouldSetResponderCapture = (e: GestureResponderEvent): boolean => {
    if (!armed) return false;
    gesturing.current = true;
    const { pageX, pageY } = e.nativeEvent;
    onAim(pageX, pageY, rootRef.current);
    // Claim the touch so the underlying control does not also activate.
    return true;
  };

  const onResponderMove = (e: GestureResponderEvent) => {
    if (!gesturing.current) return;
    const { pageX, pageY } = e.nativeEvent;
    onAim(pageX, pageY, rootRef.current);
  };

  const onResponderRelease = (e: GestureResponderEvent) => {
    if (!gesturing.current) return;
    gesturing.current = false;
    const { pageX, pageY } = e.nativeEvent;
    onSelect(pageX, pageY, rootRef.current);
  };

  const onResponderTerminate = () => {
    if (!gesturing.current) return;
    gesturing.current = false;
    onAimCancel();
  };

  return (
    <View
      ref={rootRef}
      style={{ flex: 1 }}
      collapsable={false}
      onStartShouldSetResponderCapture={onStartShouldSetResponderCapture}
      onResponderMove={onResponderMove}
      onResponderRelease={onResponderRelease}
      onResponderTerminate={onResponderTerminate}
      // We claimed the responder; the tap itself is consumed deliberately.
      onResponderTerminationRequest={() => true}
    >
      {children}
    </View>
  );
}

/**
 * AREA MODE'S DRAWING SURFACE — a transparent layer over the app that owns
 * the drag, so the rectangle is drawn on the screen as it is.
 *
 * The capture root above claims the JS responder, which stops a tap from
 * reaching a button, but it cannot stop a NATIVE scroll view: its pan
 * recognizer runs on the native side, so dragging out a rectangle over a
 * list scrolled the list (device-observed). Over this layer the app below
 * receives no touch at all, so nothing scrolls.
 *
 * It is a SIBLING of the capture root, never inside it, so the area's
 * hit-tests — run against the capture root's subtree — still find the
 * app's components and never this layer. Element aiming keeps the capture
 * root: surveying is a drag across elements that are meant to be found
 * where they are.
 */
export function AnnoKitAreaPad({
  rootRef,
  onAim,
  onSelect,
  onAimCancel,
}: {
  rootRef: React.MutableRefObject<View | null>;
  onAim: Props["onAim"];
  onSelect: Props["onSelect"];
  onAimCancel: Props["onAimCancel"];
}) {
  const gesturing = useRef(false);
  return (
    <View
      style={StyleSheet.absoluteFill}
      testID="annokit-area-pad"
      onStartShouldSetResponder={(e) => {
        gesturing.current = true;
        onAim(e.nativeEvent.pageX, e.nativeEvent.pageY, rootRef.current);
        return true;
      }}
      onResponderMove={(e) => {
        if (gesturing.current) onAim(e.nativeEvent.pageX, e.nativeEvent.pageY, rootRef.current);
      }}
      onResponderRelease={(e) => {
        if (!gesturing.current) return;
        gesturing.current = false;
        onSelect(e.nativeEvent.pageX, e.nativeEvent.pageY, rootRef.current);
      }}
      onResponderTerminate={() => {
        if (!gesturing.current) return;
        gesturing.current = false;
        onAimCancel();
      }}
      // Nothing else should take a rectangle half-drawn.
      onResponderTerminationRequest={() => false}
    />
  );
}
