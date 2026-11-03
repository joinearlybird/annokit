/**
 * THE TASK'S OWN MARK, DRAWN INTO THE SCREENSHOT.
 *
 * A screenshot is for an agent that cannot see the device. "The button at
 * (52, 180)" asks it to count pixels; a numbered badge on the element, in
 * the same silhouette the queue markers wear, lets it look. So while the
 * shutter is open (src/index.tsx, `shooting`) this layer draws, for the
 * capture being composed: its outline — the element's frame, the dashed
 * area rectangle, a ring on a held spot — and a badge carrying the number
 * the task will have in the queue. The queue's existing markers stay in
 * the shot too; this one is the task that does not exist yet.
 *
 * It is a VIEW, not pixel work: the package has no image library and takes
 * none for this. The shot still streams off disk without the bytes ever
 * entering JS (docs/security-and-privacy.md). Everything here is
 * `pointerEvents="none"` and lives inside the pushed layer, which is at
 * rest while shooting, so window coordinates are the image's coordinates.
 *
 * `children` is the hook for strokes: a sketch capture renders its own
 * drawing here so it is in the picture too.
 *
 * Not done here, on purpose: a crop around the element. That needs pixel
 * work; the 1x image plus the box in the prompt is enough to find the spot.
 */

import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { MARKER_SIZE, markerAppearance } from "./marker-hit";
import { captureBoundingBox, captureShape } from "./shape";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import type { PendingCapture } from "./types";

const RING = 28;

export function AnnoKitBurnIn({
  capture,
  number,
  children,
}: {
  capture: PendingCapture;
  /** The number this task will wear in the queue (src/marker-hit.ts, nextMarkerNumber). */
  number: number;
  children?: ReactNode;
}) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const screen = useWindowDimensions();
  const shape = captureShape(capture);
  const box = captureBoundingBox(capture);
  const look = markerAppearance("annotation", undefined, p);

  // The badge sits on the box's top-left corner, as a marker would on its
  // element — clamped so a corner against the edge still shows a number.
  const anchorX = shape === "point" ? capture.x : box.x;
  const anchorY = shape === "point" ? capture.y : box.y;
  const badgeLeft = Math.min(Math.max(anchorX - MARKER_SIZE / 2, 2), screen.width - MARKER_SIZE - 2);
  const badgeTop = Math.min(Math.max(anchorY - MARKER_SIZE / 2, 2), screen.height - MARKER_SIZE - 2);

  return (
    <View pointerEvents="none" style={styles.layer} testID="annokit-burn-in">
      {shape === "point" ? (
        <View style={[styles.ring, { left: capture.x - RING / 2, top: capture.y - RING / 2 }]} />
      ) : box.width > 0 && box.height > 0 ? (
        <>
          <View style={[styles.halo, { left: box.x - 2, top: box.y - 2, width: box.width + 4, height: box.height + 4 }]} />
          <View
            style={[
              shape === "area" ? styles.areaBox : styles.box,
              { left: box.x, top: box.y, width: box.width, height: box.height },
            ]}
          />
        </>
      ) : null}
      {children}
      <View
        style={[
          styles.badge,
          { left: badgeLeft, top: badgeTop, backgroundColor: look.fill, borderColor: look.border },
        ]}
        testID="annokit-burn-in-badge"
      >
        <Text style={[styles.badgeText, { color: look.ink }]}>{number}</Text>
      </View>
    </View>
  );
}

const useStyles = themedStyles((p) => ({
  layer: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 9995,
  },
  halo: {
    position: "absolute",
    borderWidth: 2,
    borderColor: p.aimOutline,
    borderRadius: 8,
  },
  box: {
    position: "absolute",
    borderWidth: 2,
    borderColor: p.agent,
    borderRadius: 6,
    backgroundColor: p.agentTintSoft,
  },
  areaBox: {
    position: "absolute",
    borderWidth: 2,
    borderColor: p.agent,
    borderStyle: "dashed",
    borderRadius: 8,
  },
  ring: {
    position: "absolute",
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    borderColor: p.agent,
  },
  badge: {
    position: "absolute",
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    borderRadius: MARKER_SIZE / 2,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
}));
