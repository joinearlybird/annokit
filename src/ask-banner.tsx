/**
 * THE AGENT HAS A QUESTION — a bar over the app, in the agent's colour,
 * until it is answered or put away. The shape of the working banner
 * (src/agent-banner.tsx), with a dismiss: a question is not progress, and a
 * person may want to think before answering without a bar in the way.
 *
 * Nothing here decides WHETHER to show: the provider owns that, from the
 * tasks it reads back (src/ask.ts).
 */
import { Pressable, StyleSheet, Text, View } from "react-native";

import { askActivityA11y } from "./ask";
import { AnnoKitIcon } from "./icon";
import { useAnnoKitTheme } from "./theme-context";

export function AnnoKitAskBanner({
  activity,
  onPress,
  onDismiss,
}: {
  activity: { count: number; label: string };
  /** Open the task (one question) or the finished tasks (several). */
  onPress: () => void;
  /** Put the bar away for now; the task still says it needs an answer. */
  onDismiss: () => void;
}) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  return (
    <View style={styles.wrap} pointerEvents="box-none" testID="annokit-ask-banner">
      <View style={[styles.bar, { backgroundColor: p.agent }]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityState={{ disabled: false }}
          accessibilityLabel={askActivityA11y(activity)}
          style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        >
          <View style={[styles.mark, { borderColor: p.onAccent }]}>
            <Text style={[styles.markText, { color: p.onAccent }]}>?</Text>
          </View>
          <Text style={[styles.label, { color: p.onAccent }]} numberOfLines={2}>
            {activity.label}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityState={{ disabled: false }}
          accessibilityLabel="Put this away; the task still needs your answer"
          hitSlop={8}
          style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
          testID="annokit-ask-banner-dismiss"
        >
          <AnnoKitIcon name="close" size={16} color={p.onAccent} />
        </Pressable>
      </View>
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
      // Under the status bar, like the working banner: 56 clears every
      // current notch without a safe-area dependency.
      paddingTop: 56,
      paddingBottom: 14,
      paddingLeft: 16,
      paddingRight: 8,
      gap: 8,
    },
    body: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
    mark: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
    markText: { fontSize: 11, fontWeight: "800", lineHeight: 13 },
    label: { flexShrink: 1, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },
    dismiss: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16 },
    pressed: { opacity: 0.85 },
  });
}
