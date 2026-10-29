/**
 * A screenshot, full size, over a scrim.
 *
 * Shared by the composer (the shot you just took, still a local temp file)
 * and by the detail panes (one the server granted back as a short-TTL
 * presigned URL). One component because they are the same question — "what
 * is actually in this picture" — and a thumbnail is too small to answer it.
 *
 * EXPIRY IS A STATE, NOT A CRASH. A presigned URL has a deliberately short
 * life, so a pane left open outlives its link routinely rather than
 * exceptionally. A broken <Image> renders as an empty box, which reads as a
 * bug; this says what happened instead.
 */

import { useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { AnnoKitIcon } from "./icon";
import { themedStyles, useAnnoKitTheme } from "./theme-context";

interface Props {
  /** `file://` from a local capture, or an https URL the server granted. */
  uri: string;
  /** What this picture IS, for a screen reader. */
  label?: string;
  onClose: () => void;
}

export function AnnoKitScreenshotViewer({ uri, label, onClose }: Props) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const [failed, setFailed] = useState(false);

  return (
    <Modal
      transparent
      animationType="fade"
      visible
      onRequestClose={onClose}
      testID="annokit-screenshot-viewer"
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          // Tap-anywhere to close; the labelled button below is the one a
          // screen reader should find.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        {failed ? (
          <View style={styles.unavailable} testID="annokit-screenshot-viewer-unavailable">
            <Text style={styles.unavailableText}>
              This screenshot could not be loaded. Server links to screenshots are
              short-lived — reopen the task or note to ask for a fresh one.
            </Text>
          </View>
        ) : (
          <Image
            testID="annokit-screenshot-viewer-image"
            accessibilityLabel={label ?? "Screenshot, full size"}
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
            onError={() => setFailed(true)}
          />
        )}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={styles.close}
          testID="annokit-screenshot-viewer-close"
          accessibilityRole="button"
          accessibilityLabel="Close the screenshot"
        >
          <AnnoKitIcon name="close" size={18} color={p.chromeInk} />
        </Pressable>
      </View>
    </Modal>
  );
}

const useStyles = themedStyles((p) => ({
  backdrop: {
    flex: 1,
    backgroundColor: p.scrim,
    alignItems: "center",
    justifyContent: "center",
  },
  // Contained inside a generous inset: the whole frame, never cropped, and
  // never edge-to-edge where the close control would fight the notch.
  image: {
    width: "88%",
    height: "80%",
  },
  unavailable: {
    maxWidth: "78%",
    padding: 16,
    borderRadius: 12,
    backgroundColor: p.chrome,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: p.chromeBorder,
  },
  unavailableText: {
    color: p.chromeInk,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  close: {
    position: "absolute",
    top: 56,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: p.chrome,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: p.border,
  },
}));
