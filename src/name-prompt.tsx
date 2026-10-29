/**
 * "WHO SHOULD THIS BE FROM?" — asked once, in the flow, never as a wall.
 *
 * When no identity tier above the prompt has answered (src/viewer.ts), the
 * user's FIRST attempt to post reveals this one row instead of posting: a
 * label, a text field, a confirm. It is not a modal — a dev overlay that
 * blocks the screen before you have said anything would be a toll booth, and
 * the person may never post at all. So nothing is asked until the moment the
 * answer is needed, and the thing they typed is still sitting there behind
 * it, untouched, while they answer.
 *
 * After confirming, the post they were making CONTINUES on its own; they do
 * not have to hit Send twice. That is the difference between an interruption
 * and a question.
 *
 * The name is session memory only (no async-storage peer for a dev overlay),
 * and it can be changed later from the quiet "Posting as … · Change" line in
 * a note's reply row.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import {
  canConfirmViewerName,
  MAX_VIEWER_NAME,
  setViewerName,
  subscribeToViewer,
  viewerIdentity,
} from "./viewer";
import type { ViewerIdentity } from "./viewer";

/** The identity, re-rendering the component that reads it when it changes. */
export function useViewerIdentity(): ViewerIdentity {
  return useSyncExternalStore(subscribeToViewer, viewerIdentity, viewerIdentity);
}

interface Props {
  /** Accent of the surface it sits in (orange in the team-note halves). */
  accent: string;
  /** Prefilled when this is an edit rather than the first ask. */
  initial?: string | null;
  /** The name was confirmed — the caller resumes whatever it was doing. */
  onConfirm: (name: string) => void;
  /** Backed out. The composer keeps everything that was typed. */
  onCancel?: () => void;
  /** False inside a surface that already pads its own edges (the composer). */
  inset?: boolean;
  /**
   * Render Continue / Not now as a bottom CTA ROW (the composer's commit
   * pair, compact) instead of the inline confirm + quiet link. The prompt
   * then IS the sheet's action area — the commits it interrupted are hidden,
   * not greyed, because they cannot apply until the name question is
   * answered.
   */
  ctaRow?: boolean;
  testID?: string;
}

/**
 * One row, calm: a line of explanation, a field, a confirm. Sized and
 * coloured like the reply box it appears above so it reads as part of the
 * same sheet rather than an alert that landed on it.
 */
export function AnnoKitNamePrompt({
  accent,
  initial,
  onConfirm,
  onCancel,
  inset = true,
  ctaRow = false,
  testID,
}: Props) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const [value, setValue] = useState(initial ?? "");
  const ready = canConfirmViewerName(value);
  const confirm = useCallback(() => {
    if (!canConfirmViewerName(value)) return;
    setViewerName(value);
    // The normalized form, so the caller sends exactly what is stored.
    onConfirm(value.replace(/\s+/g, " ").trim().slice(0, MAX_VIEWER_NAME));
  }, [value, onConfirm]);

  return (
    <View style={[styles.wrap, !inset && styles.flush]} testID={testID ?? "annokit-name-prompt"}>
      <Text style={styles.label}>
        {initial ? "Your name on team notes" : "Team notes are signed — what should yours say?"}
      </Text>
      <View style={styles.row}>
        <TextInput
          testID="annokit-name-input"
          style={styles.input}
          placeholder="Your name"
          placeholderTextColor={p.textMuted}
          value={value}
          autoFocus
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={MAX_VIEWER_NAME}
          returnKeyType="done"
          onChangeText={setValue}
          onSubmitEditing={confirm}
        />
        {!ctaRow && (
          <Pressable
            onPress={confirm}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready }}
            accessibilityLabel="Confirm your display name"
            style={[styles.confirm, { backgroundColor: accent }, !ready && styles.disabled]}
            testID="annokit-name-confirm"
          >
            <Text style={styles.confirmText}>{initial ? "Save" : "Continue"}</Text>
          </Pressable>
        )}
      </View>
      {ctaRow ? (
        <View style={[styles.ctaRow, styles.ctaRowPinned]}>
          {onCancel && (
            <Pressable
              onPress={onCancel}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Not now — keep me anonymous for this session"
              style={styles.ctaQuiet}
              testID="annokit-name-cancel"
            >
              <Text style={styles.ctaQuietText} numberOfLines={1}>
                Not now
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={confirm}
            disabled={!ready}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready }}
            accessibilityLabel="Confirm your display name"
            style={[styles.ctaPrimary, { backgroundColor: accent }, !ready && styles.disabled]}
            testID="annokit-name-confirm"
          >
            <Text style={styles.ctaPrimaryText} numberOfLines={1}>
              {initial ? "Save" : "Continue"}
            </Text>
          </Pressable>
        </View>
      ) : (
        onCancel && (
          <Pressable
            onPress={onCancel}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Not now — keep me anonymous for this session"
            style={styles.cancel}
            testID="annokit-name-cancel"
          >
            <Text style={styles.cancelText}>Not now</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

/**
 * The unobtrusive way back: one muted line saying who you are posting as,
 * with the only tappable word being "Change". Shown ONLY for a name this
 * device chose — a host app's identity and a server's are not ours to edit,
 * and offering to would be a lie about what the control does.
 */
export function AnnoKitViewerLine({
  identity,
  onChange,
}: {
  identity: ViewerIdentity;
  onChange: () => void;
}) {
  const styles = useStyles();
  if (identity.source !== "prompt" || !identity.name) return null;
  return (
    <View style={styles.viewerLine}>
      <Text style={styles.viewerText} numberOfLines={1}>
        Posting as {identity.name}
      </Text>
      <Pressable
        onPress={onChange}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Change the name your notes are posted under"
        testID="annokit-name-change"
      >
        <Text style={styles.viewerChange}>Change</Text>
      </Pressable>
    </View>
  );
}

const useStyles = themedStyles((p) => ({
  wrap: {
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  flush: {
    paddingHorizontal: 0,
  },
  label: {
    color: p.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: p.inputBorder,
    backgroundColor: p.raised,
    color: p.textStrong,
    paddingHorizontal: 10,
    fontSize: 14,
  },
  confirm: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  confirmText: {
    color: p.onAccent,
    fontSize: 14,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.4,
  },
  // The bottom CTA pair (ctaRow) — the composer's compact commit metrics,
  // so the prompt's actions sit exactly where Comment | Create Agent Task
  // were and read as the same control family. hitSlop keeps the target.
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  /** A beat of air over the commits, mirroring the composer's action row. */
  ctaRowPinned: {
    marginTop: 8,
  },
  ctaQuiet: {
    flex: 1,
    minHeight: 34,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: p.border,
  },
  ctaQuietText: {
    color: p.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  ctaPrimary: {
    flex: 1.4,
    minHeight: 34,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 9,
  },
  ctaPrimaryText: {
    color: p.onAccent,
    fontSize: 13,
    fontWeight: "700",
  },
  cancel: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  cancelText: {
    color: p.textMuted,
    fontSize: 12,
  },
  viewerLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  viewerText: {
    color: p.textFaint,
    fontSize: 11,
    flexShrink: 1,
  },
  viewerChange: {
    color: p.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
}));
