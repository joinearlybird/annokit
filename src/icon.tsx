/**
 * ONE call site for every icon the overlay draws.
 *
 * Components ask for a MEANING — `<AnnoKitIcon name="delete" …/>` — and
 * this module decides whether that arrives as a Lucide drawing (when the
 * optional `react-native-svg` peer resolved) or as the text glyph the
 * package has always shipped (when it did not). No component knows which it
 * got, which is the whole point: the fallback cannot rot, because there is
 * nowhere else for an icon to be drawn.
 *
 * The data — Lucide path strings, glyphs, stroke conventions — is
 * src/icon-set.ts; the peer resolution is src/svg.ts.
 */

import { StyleSheet, Text } from "react-native";
import type { TextStyle } from "react-native";
import { useAnnoKitTheme } from "./theme-context";
import {
  ICON_GLYPHS,
  ICON_PATHS,
  LUCIDE_LINECAP,
  LUCIDE_LINEJOIN,
  LUCIDE_STROKE_WIDTH,
  LUCIDE_VIEWBOX,
  glyphFontSize,
} from "./icon-set";
import type { IconName } from "./icon-set";
import { svgParts } from "./svg";

interface Props {
  name: IconName;
  /** Box size in points. The glyph fallback is sized from it. */
  size?: number;
  /**
   * Ink. Both paths honour it — that is the rule the icon set exists for.
   * Defaults to the theme's body text, so an icon dropped in without one
   * still flips with the sheet it sits on.
   */
  color?: string;
  /** Extra styling for the glyph fallback only (weight, line height). */
  glyphStyle?: TextStyle;
}

export function AnnoKitIcon({ name, size = 16, color, glyphStyle }: Props) {
  const { palette } = useAnnoKitTheme();
  const ink = color ?? palette.textBody;
  const parts = svgParts();
  if (parts) {
    const { Svg, Path } = parts;
    return (
      // Lucide's own conventions, unchanged: stroked, never filled, round
      // caps and joins, and the colour comes from the caller rather than
      // from anything inside the drawing.
      <Svg
        width={size}
        height={size}
        viewBox={LUCIDE_VIEWBOX}
        fill="none"
        stroke={ink}
        strokeWidth={LUCIDE_STROKE_WIDTH}
        strokeLinecap={LUCIDE_LINECAP}
        strokeLinejoin={LUCIDE_LINEJOIN}
      >
        {ICON_PATHS[name].map((d) => (
          <Path key={d} d={d} />
        ))}
      </Svg>
    );
  }
  return (
    <Text
      style={[styles.glyph, { fontSize: glyphFontSize(size), color: ink }, glyphStyle]}
      // A glyph inside a labelled button is decoration; the button carries
      // the words. Marked so a screen reader does not read the character.
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {ICON_GLYPHS[name]}
    </Text>
  );
}

const styles = StyleSheet.create({
  glyph: {
    fontWeight: "700",
    textAlign: "center",
  },
});
