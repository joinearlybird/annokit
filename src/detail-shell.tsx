/**
 * The ONE detail pane, for both kinds.
 *
 * An agent task and a team note are read the same way — a sheet with the
 * captured element at the top, the writing in the middle, a reply box, and
 * the actions that apply at the bottom — so they get the same pane: same
 * geometry, same header, the kind named the same way in the same place, same
 * words for the same things. Only two things vary, and they are the two
 * things that genuinely differ:
 *
 *   KIND    — the eyebrow line over the title, blue "AGENT TASK" or orange
 *             "TEAM NOTE" (src/destination.ts). It went inline with the
 *             title for a while to save a line; the redesign brought the
 *             stacked header back, paired with a status pill, because the
 *             kind + status together are the sheet's one-glance summary and
 *             the big title underneath is what the eye lands on.
 *   ACTIONS — a task can be resolved/deleted; a note can also be handed to
 *             the agent, which is the one bridge between the halves.
 *
 * PUSHING THE APP UP lives here for the same reason everything else does: a
 * sheet covering the element it is about is a property of THE PANE, not of
 * what is written inside it. So both kinds report what they cover and take
 * the lower ceiling while the app is pushed — automatically, with no control
 * to find. See src/push.ts for the geometry and for the one thing that is
 * genuinely different up here: the frame is the STORED one, and a pane that
 * cannot trust it simply does not move the app.
 *
 * The bodies stay in their own files (src/thread-view.tsx, src/comment-view.tsx)
 * because the CONTENT is honestly different — an agent thread is you and the
 * agent, a note is a discussion with authors and avatars — but everything a
 * user reads as "the pane" is here, so the two cannot drift apart again.
 */

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import { destinationBadge } from "./destination";
import type { SubmitDestination } from "./destination";
import { AnnoKitIcon } from "./icon";
import { useKeyboardHeight } from "./keyboard";
import { detailSheetMaxHeight } from "./push";

interface Props {
  /** Which half of the overlay this item belongs to. */
  destination: SubmitDestination;
  /** The captured element, or a fallback name. The big title line. */
  title: string;
  /**
   * Where it lives, in two parts: the source file and line, worn as a
   * monospace chip ("_layout.tsx:7"), and the screen beside it ("Home") —
   * src/detail-line.ts derives both. Either may be empty; when both are,
   * no context row is drawn at all — never a lonely separator.
   */
  sourceRef?: string;
  route?: string;
  /** The context row as a phrase, for the screen reader. */
  contextLabel?: string;
  /** Lifecycle word ("Open", "Resolved") worn as a pill, or "" for none. */
  status?: string;
  /** Something went wrong, in the user's words. */
  error?: string | null;
  /**
   * One kind-specific control in the header, left of Delete — the team
   * note's "Select" (which enters message-selection mode) is the only one
   * today. It lives here rather than in the body because it acts on the
   * WHOLE pane, which is what the header is for.
   */
  headerAction?: ReactNode;
  /** Delete this item. Omitted = not deletable from here. */
  onDelete?: () => void;
  /** Screen-reader name for the delete control (the glyph has no words). */
  deleteLabel: string;
  onClose: () => void;
  testID: string;
  /** The scrollable middle — messages, references, whatever the kind has. */
  children: ReactNode;
  /** The reply box and the action row, pinned under the body. */
  footer?: ReactNode;
  /**
   * How much of the BOTTOM of the screen this pane covers — its own height
   * plus the keyboard the reply box raises. The provider measures the
   * annotated element against it and pushes the app up if this pane would
   * otherwise sit on top of it (src/push.ts). Omitted and the pane simply
   * never causes a push, exactly as before.
   */
  onCovered?: (height: number) => void;
  /**
   * True while the app underneath is actually being pushed for this pane.
   * Not a preference — nobody chose it; it is "the translation came out
   * non-zero" — and all it does here is lower the pane's ceiling so the room
   * the push made survives.
   */
  pushing?: boolean;
}

export function AnnoKitDetailShell({
  destination,
  title,
  sourceRef,
  route,
  contextLabel,
  status,
  error,
  headerAction,
  onDelete,
  deleteLabel,
  onClose,
  testID,
  children,
  footer,
  onCovered,
  pushing = false,
}: Props) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const kind = destinationBadge(destination, p);
  const name = title.trim();
  const kindA11y = name ? `${kind.label}: ${name}` : kind.label;
  /**
   * WHAT THIS PANE COVERS — its own laid-out height plus the keyboard the
   * reply box raises. Measured only when somebody asked for it: without
   * `onCovered` there is nothing to measure for.
   */
  const { height: windowHeight } = useWindowDimensions();
  const [panelHeight, setPanelHeight] = useState(0);
  const keyboardHeight = useKeyboardHeight();
  useEffect(() => {
    if (onCovered && panelHeight > 0) onCovered(panelHeight + keyboardHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelHeight, keyboardHeight, onCovered]);
  // A pushing pane gets a lower ceiling for the composer's reason: moving
  // the app up and then growing into the space is running to stand still.
  const maxHeight = detailSheetMaxHeight(windowHeight, pushing);
  // FULL SCREEN IS A TOGGLE, NOT A DRAG. The header's expand glyph grows
  // the pane to (almost) the whole window for long threads; its other half
  // brings the content-sized sheet back. Dismissal belongs to the backdrop
  // and the hardware back — the header spends its corner on room instead.
  const [expanded, setExpanded] = useState(false);
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          // Tap-outside to dismiss; a screen reader uses the sheet's own
          // close control instead of an unlabelled full-screen target.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View
          style={[styles.panel, expanded ? { height: windowHeight - 54 } : { maxHeight }]}
          testID={testID}
          onLayout={onCovered ? (e) => setPanelHeight(e.nativeEvent.layout.height) : undefined}
        >
          {/* The sheet's grabber — it says "this pulls down" before any words do. */}
          <View style={styles.grabber} />
          <View style={styles.header}>
            {/*
              THE KIND IS AN EYEBROW: dot + uppercase label in the kind's
              colour, with the lifecycle pill beside it. One glance answers
              "what is this and where does it stand"; the element name gets
              its own big line underneath.
            */}
            <View
              style={styles.kindRow}
              accessibilityLabel={kindA11y}
              testID={`${testID}-title`}
            >
              <View style={[styles.dot, { backgroundColor: kind.color }]} />
              <Text style={[styles.kindLabel, { color: kind.color }]}>{kind.label}</Text>
              {!!status && (
                <View style={styles.statusPill} testID={`${testID}-status`}>
                  <Text style={styles.statusText}>{status}</Text>
                </View>
              )}
            </View>
            {/*
              GLYPHS, NOT WORDS. This is a bottom sheet: it is obvious that
              the chevron puts it away, and "Back" was a label for a
              navigation this pane never performs (product owner). Both are
              the same quiet grey — the redesign keeps the header calm and
              lets the confirm sheet carry the danger — and both keep their
              words for screen readers, which is where words still help.
            */}
            <View style={styles.headerActions}>
              {headerAction}
              {onDelete && (
                <Pressable
                  onPress={onDelete}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={deleteLabel}
                  testID={`${testID}-delete`}
                >
                  <AnnoKitIcon name="delete" size={17} color={p.textMuted} />
                </Pressable>
              )}
              <Pressable
                onPress={() => setExpanded((v) => !v)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={
                  expanded ? "Return the pane to its normal height" : "Expand the pane to full screen"
                }
                testID={`${testID}-expand`}
              >
                <AnnoKitIcon name={expanded ? "minimize" : "expand"} size={16} color={p.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* The thing itself, big — what the eye lands on after the eyebrow. */}
          {!!name && (
            <Text style={styles.headerTitle} numberOfLines={1}>
              {name}
            </Text>
          )}
          {/*
            WHERE IT LIVES, once. The element name is on the line above and
            does not repeat here; what is left is the technical context a
            developer actually wants — the source file and line as a
            monospace chip, the screen as quiet text beside it — and when
            the server recorded neither, nothing is drawn rather than a
            separator with nothing either side of it.
          */}
          {!!(sourceRef || route) && (
            <View
              style={styles.context}
              accessibilityLabel={contextLabel || [sourceRef, route].filter(Boolean).join(", ")}
              testID={`${testID}-context`}
            >
              {!!sourceRef && (
                <View style={styles.sourceChip}>
                  <Text style={styles.sourceChipText} numberOfLines={1}>
                    {sourceRef}
                  </Text>
                </View>
              )}
              {!!route && (
                <Text style={styles.routeText} numberOfLines={1}>
                  {route}
                </Text>
              )}
            </View>
          )}
          {!!error && (
            <Text style={styles.error} testID={`${testID}-error`}>
              {error}
            </Text>
          )}

          {children}
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = themedStyles((p) => ({
  backdrop: {
    flex: 1,
    backgroundColor: p.backdrop,
    justifyContent: "flex-end",
  },
  dismissArea: {
    flex: 1,
  },
  panel: {
    backgroundColor: p.sheet,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: p.border,
    paddingBottom: 24,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: p.grabber,
    marginTop: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 2,
    gap: 12,
  },
  /** The eyebrow: dot + uppercase kind + the lifecycle pill. */
  kindRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexShrink: 1,
  },
  kindLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    flexShrink: 0,
  },
  /** The element name, on its own big line under the eyebrow. */
  headerTitle: {
    color: p.textStrong,
    fontSize: 21,
    fontWeight: "700",
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 8,
  },
  statusPill: {
    backgroundColor: p.chip,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  statusText: {
    color: p.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  /** The chip + route row under the title. */
  context: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  sourceChip: {
    backgroundColor: p.chip,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 7,
    flexShrink: 1,
  },
  sourceChipText: {
    color: p.textSecondary,
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  routeText: {
    color: p.textMuted,
    fontSize: 13,
    flexShrink: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    flexShrink: 0,
  },
  error: {
    color: p.dangerSoft,
    fontSize: 12,
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
}));
