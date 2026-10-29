/**
 * EFFORT, AS A SLIDER — the chosen model's own levels, lowest first
 * (src/agent-config.ts, `modelEfforts`). Discrete stops on one track: tap
 * a stop or drag along it. The level is named above the track, so the
 * stops themselves need no labels and the row fits the pill's menu.
 *
 * NO "DEFAULT" STOP. Default is not a level; it is whichever level the
 * model runs at when none is asked for, so the slider sits ON that level
 * and says so ("Medium · default"). The task carries that level by name
 * (src/agent-config.ts, `taskRun`). When the CLI does not say what its
 * default is, no stop is marked until one is chosen.
 *
 * Used twice: fixed at the bottom of the agent pill's menu, and in
 * Settings → Agent.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import type { GestureResponderEvent, LayoutChangeEvent } from "react-native";
import { effortLabel, effortValueLabel } from "./agent-config";
import { themedStyles } from "./theme-context";

const THUMB = 18;

export function EffortSlider({
  efforts,
  value,
  defaultEffort,
  onChange,
  testID,
}: {
  efforts: string[];
  /** The chosen level; null: the model's default. */
  value: string | null;
  /** The level the model runs at by default, when known. */
  defaultEffort: string | null;
  onChange: (effort: string) => void;
  testID?: string;
}) {
  const styles = useStyles();
  const stops = efforts;
  // -1: nothing chosen and the default not known — no stop is marked.
  const chosen = stops.indexOf(value ?? defaultEffort ?? "");
  // Where a drag is, before it is let go: the label follows the finger.
  const [dragging, setDragging] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const at = dragging ?? chosen;
  const span = Math.max(1, width - THUMB);
  const x = (i: number) => (stops.length > 1 ? (i / (stops.length - 1)) * span : 0);

  const indexAt = (e: GestureResponderEvent) => {
    const px = e.nativeEvent.locationX - THUMB / 2;
    const i = Math.round((px / span) * (stops.length - 1));
    return Math.min(stops.length - 1, Math.max(0, i));
  };
  const commit = (i: number) => {
    setDragging(null);
    if (i === chosen) return;
    const level = stops[i];
    if (level) onChange(level);
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.head}>
        <Text style={styles.title}>Effort</Text>
        <Text style={styles.value}>{effortValueLabel(stops[at] ?? null, defaultEffort)}</Text>
      </View>
      <View
        style={styles.track}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        // A sheet's scroll must not take the drag half-way along.
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => setDragging(indexAt(e))}
        onResponderMove={(e) => setDragging(indexAt(e))}
        onResponderRelease={(e) => commit(indexAt(e))}
        onResponderTerminate={() => setDragging(null)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Effort"
        accessibilityValue={{ text: effortValueLabel(stops[chosen] ?? null, defaultEffort) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          const step = e.nativeEvent.actionName === "increment" ? 1 : -1;
          commit(Math.min(stops.length - 1, Math.max(0, (chosen < 0 ? 0 : chosen) + step)));
        }}
      >
        {width > 0 && (
          <>
            <View style={[styles.line, { left: THUMB / 2, width: span }]} pointerEvents="none" />
            {at >= 0 && <View style={[styles.fill, { left: THUMB / 2, width: x(at) }]} pointerEvents="none" />}
            {stops.map((s, i) => (
              <View
                key={s}
                pointerEvents="none"
                style={[styles.tick, i <= at && styles.tickOn, { left: THUMB / 2 + x(i) - 3 }]}
              />
            ))}
            {at >= 0 && <View style={[styles.thumb, { left: x(at) }]} pointerEvents="none" />}
          </>
        )}
      </View>
    </View>
  );
}

const useStyles = themedStyles((p) => ({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
  },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: {
    color: p.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  value: {
    color: p.agentText,
    fontSize: 12,
    fontWeight: "700",
  },
  track: {
    height: 28,
    justifyContent: "center",
  },
  line: {
    position: "absolute",
    height: 3,
    borderRadius: 2,
    backgroundColor: p.border,
  },
  fill: {
    position: "absolute",
    height: 3,
    borderRadius: 2,
    backgroundColor: p.agent,
  },
  tick: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: p.borderStrong,
  },
  tickOn: {
    backgroundColor: p.agent,
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: p.sheet,
    borderWidth: 2,
    borderColor: p.agent,
  },
}));
