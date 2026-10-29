/**
 * THE AGENT IS WORKING — a thin bar over the app while a task is in flight.
 *
 * Handing a task over used to be the end of the visible story: the sheet
 * closed and nothing else moved, so whether an agent had picked it up, was
 * mid-edit, or had died was unknowable from the device that asked. This
 * says which of those is true, using a status the SERVER sets
 * (src/agent-activity.ts) rather than anything this device remembers about
 * pressing a button.
 *
 * IT SITS AT THE TOP, AND A TAP OPENS THE WORK. The composer, the queue
 * and the detail pane all come up from the bottom, so the top is the one
 * strip that is never in the way of the thing you are doing. It used to
 * ignore touches altogether; but "which task, and what is it doing?" is
 * the question it raises, and the answer is one tap away — the task's own
 * detail when there is one in flight, the queue when there are several.
 * Only the bar takes the tap: the wrapper passes everything else through
 * to the app (`box-none`).
 *
 * TWO LINES WHEN THE SERVER SAYS WHAT IS HAPPENING. The first names the
 * task; the second, when the server sends one, is the agent's latest step
 * (`progress`, src/agent-activity.ts).
 *
 * FULL-BLEED, IN THE AGENT'S COLOUR. It started as a small grey pill and was
 * too easy to miss on a busy screen. It now runs edge to edge from the very
 * top — under the status bar, so it reads as part of the window rather than
 * a card floating near it — and wears `agent`, the same colour as an agent
 * task's marker and its commit button. That is the point of using it: the
 * bar is the agent speaking, and the overlay already says "agent" in that
 * colour everywhere else.
 *
 * Nothing here decides WHETHER to show: the provider owns that, because it
 * is the one holding both the annotations and the preference.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { agentActivityA11y, type AgentActivity } from "./agent-activity";
import { useAnnoKitTheme } from "./theme-context";

export function AnnoKitAgentBanner({
  activity,
  onPress,
}: {
  activity: AgentActivity;
  /** Open what the banner is about. Omitted: it reports and nothing more. */
  onPress?: () => void;
}) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();

  // One slow pulse on the dot. A spinner would claim to know about progress
  // it has no measurement of; a breath just says something is alive.
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    // Stop on unmount: a loop left running keeps a timer alive for a banner
    // nobody can see.
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.wrap} pointerEvents="box-none" testID="annokit-agent-banner">
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityState={{ disabled: !onPress }}
        accessibilityRole={onPress ? "button" : "alert"}
        accessibilityLabel={agentActivityA11y(activity)}
        accessibilityHint={
          onPress ? (activity.count === 1 ? "Opens the task" : "Opens the agent queue") : undefined
        }
        style={({ pressed }) => [styles.bar, { backgroundColor: p.agent }, pressed && styles.pressed]}
      >
        <Animated.View style={[styles.dot, { backgroundColor: p.onAccent, opacity: pulse }]} />
        <View style={styles.text}>
          <Text style={[styles.label, { color: p.onAccent }]} numberOfLines={1}>
            {activity.label}
          </Text>
          {!!activity.progress && (
            <Text
              style={[styles.progress, { color: p.onAccent }]}
              numberOfLines={1}
              testID="annokit-agent-banner-progress"
            >
              {activity.progress}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}

function useStyles() {
  return StyleSheet.create({
    wrap: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
    },
    bar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      // Runs under the status bar. The top padding clears the notch without
      // measuring insets — this package does not depend on
      // safe-area-context, and 56 clears every current iPhone and the
      // Android status bar with room to spare.
      paddingTop: 56,
      paddingBottom: 14,
      paddingHorizontal: 16,
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    text: { flexShrink: 1, alignItems: "center" },
    label: { fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
    progress: { fontSize: 12, marginTop: 2, opacity: 0.85 },
    pressed: { opacity: 0.85 },
  });
}
