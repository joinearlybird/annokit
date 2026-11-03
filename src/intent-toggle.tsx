/**
 * Fix / Question, in the composer's icon row (src/intent.ts has the words
 * and the rule). Two segments in the agent pill's silhouette, so the row
 * reads as one strip of things put on the task.
 */

import { Pressable, Text, View } from "react-native";
import { intentLabel, intentToggleA11y } from "./intent";
import type { TaskIntent } from "./intent";
import { themedStyles, useAnnoKitTheme } from "./theme-context";

const INTENTS: readonly TaskIntent[] = ["fix", "question"];

export function IntentToggle({ value, onChange }: { value: TaskIntent; onChange: (intent: TaskIntent) => void }) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  return (
    <View style={styles.group} testID="annokit-intent">
      {INTENTS.map((intent) => {
        const selected = intent === value;
        return (
          <Pressable
            key={intent}
            onPress={() => onChange(intent)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={intentToggleA11y(intent, selected)}
            hitSlop={4}
            style={({ pressed }) => [styles.segment, selected && { backgroundColor: p.agent }, pressed && styles.pressed]}
            testID={`annokit-intent-${intent}`}
          >
            <Text style={[styles.text, selected && { color: p.onAccent }]} numberOfLines={1}>
              {intentLabel(intent)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = themedStyles((p) => ({
  group: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 28,
    padding: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: p.border,
    backgroundColor: p.chip,
  },
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  text: {
    color: p.textBody,
    fontSize: 12,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.7,
  },
}));
