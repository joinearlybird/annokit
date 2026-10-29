/**
 * The drawn half of aim highlighting (geometry lives in src/aim.ts).
 *
 * TWO KINDS OF VIEW, AND THE DIFFERENCE MATTERS:
 *
 *  1. `AnnoKitAim` — the outline and the name label. These sit OVER the
 *     app's own elements, so every view here is `pointerEvents="none"`.
 *     A touchable view drawn over the app poisons Fabric's hit-test
 *     (`findNodeAtPoint` returns OUR view instead of the app's element,
 *     see src/capture.tsx) and the label would start naming itself.
 *  2. `AnnoKitAimConfirm` — a real button. It is rendered as a SIBLING of
 *     the capture root (next to the FAB in src/index.tsx), never inside it,
 *     which is how all this package's chrome stays out of the annotation:
 *     the inspector only ever hit-tests the capture root's subtree, and the
 *     capture root's responder only sees touches on the app below it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import { placeAimChrome, placeAimLabel } from "./aim";
import type { AimRect, AimSize, AimTarget } from "./aim";
import { AnnoKitIcon } from "./icon";
import { isFabDrag } from "./fab-drag";
import type { FabPoint } from "./fab-drag";
import {
  CHIP_DEFAULT_TOP,
  clampChipPosition,
  defaultChipPosition,
  recallChipPosition,
  rememberChipPosition,
} from "./mode-chip";
import type { ChipSize } from "./mode-chip";

/** Pre-measurement guess, replaced by the first onLayout. */
// Height, unlike width, is not a guess: the label is one line of fixed
// type (see styles.labelText), so it is exactly paddingVertical*2 +
// lineHeight. The confirm button relies on that to stack clear of it.
const ESTIMATED_LABEL: AimSize = { width: 160, height: 22 };
const ESTIMATED_CONFIRM: AimSize = { width: 132, height: 34 };

interface AimProps {
  target: AimTarget;
  /** Y below which the composer sheet covers the screen, if it is open. */
  occludedTop?: number;
  /**
   * Top keep-out. Defaults to AIM_TOP_MARGIN; raised by the caller when the
   * whole layer has been translated upward in push mode, because a chip
   * placed at y then appears at y - push (src/push.ts, `pushedAimBounds`).
   */
  topMargin?: number;
}

export function AnnoKitAim({ target, occludedTop, topMargin }: AimProps) {
  const styles = useStyles();
  const screen = useWindowDimensions();
  const [labelSize, setLabelSize] = useState<AimSize>(ESTIMATED_LABEL);
  const { frame } = target;
  const label = placeAimLabel(frame, labelSize, screen, { occludedTop, topMargin });

  return (
    <>
      {/*
        A white halo just outside the blue outline. Device-observed: a
        single blue border vanishes against a blue button — the outline
        has to read on ANY background the app happens to use.
      */}
      <View
        pointerEvents="none"
        style={[
          styles.halo,
          { left: frame.x - 2, top: frame.y - 2, width: frame.width + 4, height: frame.height + 4 },
        ]}
      />
      <View
        pointerEvents="none"
        testID="annokit-aim-box"
        style={[
          styles.box,
          { left: frame.x, top: frame.y, width: frame.width, height: frame.height },
        ]}
      />
      <View
        pointerEvents="none"
        testID="annokit-aim-label"
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          // Only on real change: setState in onLayout otherwise re-renders
          // forever as the drag moves the label.
          setLabelSize((prev) =>
            Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
              ? prev
              : { width, height },
          );
        }}
        style={[styles.label, { left: label.left, top: label.top }]}
      >
        <Text style={styles.labelText} numberOfLines={1}>
          {target.label}
        </Text>
      </View>
    </>
  );
}

/**
 * The area rectangle — while the drag draws it and after release keeps it.
 * Same outline language as the aim box (halo for contrast on any
 * background), dashed: a region, not a live element.
 */
export function AnnoKitAreaBox({ rect }: { rect: AimRect }) {
  const styles = useStyles();
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.halo,
          { left: rect.x - 2, top: rect.y - 2, width: rect.width + 4, height: rect.height + 4 },
        ]}
      />
      <View
        pointerEvents="none"
        testID="annokit-area-box"
        style={[
          styles.areaBox,
          { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
        ]}
      />
    </>
  );
}

/**
 * The armed-mode chip: Element aim, or Area rectangle. Rendered OUTSIDE the
 * capture root (it must stay tappable while armed). It starts centred near
 * the top, and can be DRAGGED anywhere — the top is where apps put headers
 * and back buttons, and a chip over an element is one nobody can aim at
 * (src/mode-chip.ts). A tap switches the mode; a press that moves past the
 * drag threshold moves the chip instead, the way the floating button works.
 */
export function AnnoKitModeToggle({
  mode,
  onToggle,
}: {
  mode: "element" | "area";
  onToggle: () => void;
}) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const screen = useWindowDimensions();
  const screenRef = useRef(screen);
  screenRef.current = screen;
  // Its size is known only once laid out; until then it is drawn invisible
  // where it was left (or nowhere yet), so it never jumps into place.
  const [size, setSize] = useState<ChipSize | null>(null);
  const sizeRef = useRef<ChipSize>({ width: 0, height: 0 });
  const start = useMemo(() => recallChipPosition(), []);
  const pos = useRef(new Animated.ValueXY(start ?? { x: 0, y: CHIP_DEFAULT_TOP })).current;
  const posRef = useRef<FabPoint>(start ?? { x: 0, y: CHIP_DEFAULT_TOP });
  const dragStart = useRef<FabPoint>(posRef.current);
  const dragging = useRef(false);

  useEffect(() => {
    const id = pos.addListener((value) => {
      posRef.current = value;
    });
    return () => pos.removeListener(id);
  }, [pos]);

  // First layout places it (centred, or where it was left); a rotation or a
  // wider label pulls it back on screen.
  useEffect(() => {
    if (!size) return;
    const target = clampChipPosition(recallChipPosition() ?? defaultChipPosition(screen, size), screen, size);
    pos.setValue(target);
    posRef.current = target;
  }, [pos, size, screen.width, screen.height]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Never on touch-down: that touch belongs to the Pressable (the toggle).
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_e, g) => isFabDrag(g.dx, g.dy),
        onPanResponderGrant: () => {
          dragging.current = true;
          dragStart.current = posRef.current;
        },
        onPanResponderMove: (_e, g) => {
          pos.setValue(
            clampChipPosition(
              { x: dragStart.current.x + g.dx, y: dragStart.current.y + g.dy },
              screenRef.current,
              sizeRef.current,
            ),
          );
        },
        onPanResponderRelease: () => {
          rememberChipPosition(posRef.current);
          // After the release's own press handling, so a drag never toggles.
          setTimeout(() => (dragging.current = false), 0);
        },
        onPanResponderTerminate: () => {
          rememberChipPosition(posRef.current);
          dragging.current = false;
        },
      }),
    [pos],
  );

  return (
    <Animated.View
      testID="annokit-mode-toggle"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        sizeRef.current = { width, height };
        if (!size || size.width !== width || size.height !== height) setSize({ width, height });
      }}
      style={[
        styles.modeChip,
        styles.modeFloat,
        { transform: [{ translateX: pos.x }, { translateY: pos.y }] },
        !size && styles.modeUnplaced,
      ]}
      {...responder.panHandlers}
    >
      <Pressable
        onPress={() => {
          if (!dragging.current) onToggle();
        }}
        accessibilityRole="button"
        // A toggle between two aiming modes: "selected" says which one is
        // in force without the label having to carry it twice.
        accessibilityState={{ selected: mode === "area" }}
        accessibilityLabel={
          mode === "element"
            ? "Aiming at elements. Switch to selecting an area"
            : "Selecting an area. Switch to aiming at elements"
        }
        accessibilityHint="Drag to move it out of the way"
        style={({ pressed }) => [styles.modeBtn, pressed && styles.pressed]}
      >
        <AnnoKitIcon name={mode === "element" ? "annotate" : "area"} size={12} color={p.chromeInk} />
        <Text style={styles.modeText}>{mode === "element" ? "Element" : "Area"}</Text>
      </Pressable>
    </Animated.View>
  );
}

interface ConfirmProps extends AimProps {
  /** The confirm button's word. */
  confirmLabel: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

/**
 * "Annotate" + dismiss, anchored to the selected frame (below it by
 * default, flipped above near the bottom edge) so the association with the
 * highlight is unmistakable — and so it never covers the element itself.
 *
 * ONE WORD, ONE COLOUR. Aiming is aiming: the bar no longer has to say
 * which kind of capture is running, because the destination is not chosen
 * yet (src/destination.ts — the composer asks).
 */
export function AnnoKitAimConfirm({
  target,
  occludedTop,
  topMargin,
  confirmLabel,
  onConfirm,
  onDismiss,
}: ConfirmProps) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const screen = useWindowDimensions();
  const [size, setSize] = useState<AimSize>(ESTIMATED_CONFIRM);
  // The label is one line of fixed type, so its estimated HEIGHT is exact —
  // and its height is all this placement needs to stay clear of it.
  const { confirm: place } = placeAimChrome(target.frame, ESTIMATED_LABEL, size, screen, {
    occludedTop,
    topMargin,
  });

  return (
    <View
      testID="annokit-aim-confirm"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) =>
          Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
            ? prev
            : { width, height },
        );
      }}
      style={[styles.confirmBar, { left: place.left, top: place.top }]}
    >
      <Pressable
        testID="annokit-aim-confirm-add"
        accessibilityRole="button"
        accessibilityLabel={`Annotate ${target.label}`}
        onPress={onConfirm}
        style={({ pressed }) => [styles.confirmBtn, pressed && styles.pressed]}
      >
        <AnnoKitIcon name="annotate" size={13} color={p.chromeInk} />
        <Text style={styles.confirmText}>{confirmLabel}</Text>
      </Pressable>
      <Pressable
        testID="annokit-aim-confirm-dismiss"
        accessibilityRole="button"
        accessibilityLabel="Clear selection"
        onPress={onDismiss}
        hitSlop={8}
        style={({ pressed }) => [styles.dismissBtn, pressed && styles.pressed]}
      >
        <AnnoKitIcon name="close" size={15} color={p.chromeInkSoft} />
      </Pressable>
    </View>
  );
}

const useStyles = themedStyles((p) => ({
  halo: {
    position: "absolute",
    borderWidth: 2,
    borderColor: p.aimOutline,
    borderRadius: 8,
    zIndex: 9996,
  },
  box: {
    position: "absolute",
    borderWidth: 2,
    borderColor: p.agent,
    borderRadius: 6,
    backgroundColor: p.agentTintSoft,
    zIndex: 9997,
  },
  label: {
    position: "absolute",
    maxWidth: "92%",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: p.agent,
    zIndex: 9999,
    shadowColor: p.shadow,
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 5,
  },
  labelText: {
    color: p.onAccent,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  confirmBar: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingLeft: 2,
    paddingRight: 4,
    borderRadius: 999,
    backgroundColor: p.chrome,
    borderWidth: 1,
    borderColor: p.agentBorderSoft,
    zIndex: 9999,
    shadowColor: p.shadow,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  areaBox: {
    position: "absolute",
    borderWidth: 2,
    borderColor: p.aimOutline,
    borderStyle: "dashed",
    borderRadius: 8,
    zIndex: 9996,
  },
  modeFloat: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 9999,
  },
  modeUnplaced: {
    opacity: 0,
  },
  modeChip: {
    borderRadius: 999,
    backgroundColor: p.chrome,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: p.chromeBorder,
    shadowColor: p.shadow,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  modeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
  },
  modeText: {
    color: p.chromeInk,
    fontSize: 12,
    fontWeight: "600",
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  confirmText: {
    // CHROME INK, not the ink that goes on a fill. This bar's background is
    // the floating-chrome surface, which is near-black in dark and
    // near-WHITE in light — white text on it was invisible on a light
    // phone (device-observed). Anywhere a background flips, its foreground
    // has to flip with it.
    color: p.chromeInk,
    fontSize: 13,
    fontWeight: "700",
  },
  dismissBtn: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
  },
  dismissText: {
    color: p.textBody,
    fontSize: 17,
    lineHeight: 19,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.7,
  },
}));
