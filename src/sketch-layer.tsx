/**
 * The drawn half of a sketch (geometry in src/sketch.ts): the strokes, as
 * SVG paths over the app.
 *
 * Needs react-native-svg, an OPTIONAL peer (src/svg.ts). Without it this
 * renders nothing, and the provider does not offer Draw mode at all, so a
 * stroke can never be made that cannot be shown.
 *
 * Every view here is `pointerEvents="none"`, on the wrapping View AND the
 * Svg root — react-native-svg's root is a touch target on Android, and a
 * touchable view over the app poisons the inspector's hit-test
 * (src/capture.tsx). The Svg is sized explicitly from the window: an
 * unsized Svg draws nothing on Android.
 *
 * Committed strokes are one Path each, keyed by identity, so a stroke that
 * has not changed is not re-stringified; the live stroke is one more Path
 * that the provider updates once per frame (src/index.tsx).
 */

import { useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { SKETCH_STROKE_WIDTH, strokePath } from "./sketch";
import type { SketchStroke } from "./sketch";
import { svgParts } from "./svg";
import { useAnnoKitTheme } from "./theme-context";

export function AnnoKitSketchLayer({
  strokes,
  live,
  color,
}: {
  strokes: readonly SketchStroke[];
  /** The stroke under the finger, drawn the same but owned by the gesture. */
  live?: SketchStroke | null;
  /** Defaults to the palette's sketch ink. */
  color?: string;
}) {
  const { palette } = useAnnoKitTheme();
  const screen = useWindowDimensions();
  const parts = svgParts();
  const paths = useMemo(() => strokes.map((s) => strokePath(s)), [strokes]);
  if (!parts) return null;
  const { Svg, Path } = parts;
  const ink = color ?? palette.sketch;
  return (
    <View pointerEvents="none" style={styles.layer} testID="annokit-sketch-layer">
      <Svg width={screen.width} height={screen.height} pointerEvents="none">
        {paths.map((d, i) => (
          <Path key={i} d={d} fill="none" stroke={ink} strokeWidth={SKETCH_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {live && live.points.length > 0 && (
          <Path d={strokePath(live)} fill="none" stroke={ink} strokeWidth={SKETCH_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 9996,
  },
});
