/**
 * The team-notes panel: every note left on this app, on every screen, and a
 * way to get to any of them.
 *
 * It is the counterweight to the queue being tasks-only (src/queue.tsx). The
 * queue is a workflow — tick, send, delete — and notes are not part of it;
 * but a note is only useful if it can be FOUND, and before this panel a note
 * could only be found by already standing on the screen it was left on.
 *
 * The list it shows comes from the provider's UNSCOPED read (`GET /comments`,
 * no routeName), which is the whole point: the route-scoped list is the
 * current screen's, and this panel exists to show the others. It asks for a
 * refresh on open and otherwise renders what the provider has — a server
 * without the routes still shows what it can and says so.
 *
 * Rows, not cards. Grouped by route with the current screen first, settled
 * notes dimmed to the same 45% their markers use — all of it decided in
 * src/notes-list.ts, which is pure and tested. Tapping a row hands the row
 * back to the provider, which navigates (when it can) and opens the SAME
 * detail pane the markers open: src/comment-view.tsx, never a second one.
 */

import { useEffect } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import { AnnoKitIcon } from "./icon";
import type { Comment } from "./comments";
import { destinationBadge } from "./destination";
import {
  buildNoteRows,
  groupNotesByRoute,
  notesEmptyText,
  notesTitle,
  noteRowLabel,
  replyCountLabel,
} from "./notes-list";
import type { NoteRow } from "./notes-list";

interface Props {
  /** Every screen's notes, as the provider last read them. */
  comments: Comment[];
  /** False once a comments read has failed — the routes are not there. */
  commentsAvailable: boolean;
  /** The screen behind the panel, for "current first" and the jump decision. */
  routeName: string | null;
  /** Re-read the unscoped list (the panel asks once, on open). */
  onRefresh: () => void;
  /** Go to this note: navigate if needed, then open its detail. */
  onSelect: (row: NoteRow) => void;
  onClose: () => void;
}

export function AnnoKitNotes({
  comments,
  commentsAvailable,
  routeName,
  onRefresh,
  onSelect,
  onClose,
}: Props) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  useEffect(() => {
    onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = groupNotesByRoute(buildNoteRows(comments), routeName);
  const empty = groups.length === 0;

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          // Tap-outside to dismiss; a screen reader uses the close button.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={styles.panel} testID="annokit-notes">
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <View
                style={[styles.dot, { backgroundColor: p.team }]}
                // Colour restating the heading beside it: decorative.
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={styles.headerTitle}>{notesTitle()}</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              testID="annokit-notes-close"
              accessibilityRole="button"
              // A close, not "Done": nothing is committed on the way out.
              accessibilityLabel="Close team notes"
            >
              <AnnoKitIcon name="close" size={18} color={p.textMuted} />
            </Pressable>
          </View>
          {/*
            No subhead. "Teammates see this; the agent won't act on it" sat
            here under a heading that already reads "Team notes" — the same
            fact twice, on a panel whose whole content is the list (product
            owner, device testing). The orange dot and the title carry it.
          */}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {empty && (
              <Text style={styles.empty} testID="annokit-notes-empty">
                {notesEmptyText(commentsAvailable)}
              </Text>
            )}
            {groups.map((group) => (
              <View key={group.routeName || "(none)"} style={styles.group}>
                <View style={styles.groupHead}>
                  <Text style={styles.groupLabel} numberOfLines={1}>
                    {group.label}
                  </Text>
                  {group.current && (
                    <Text style={styles.groupHere} testID="annokit-notes-here">
                      This screen
                    </Text>
                  )}
                </View>
                {group.rows.map((row) => (
                  <NoteRowView key={row.id} row={row} onSelect={onSelect} />
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function NoteRowView({
  row,
  onSelect,
}: {
  row: NoteRow;
  onSelect: (row: NoteRow) => void;
}) {
  const styles = useStyles();
  const replies = replyCountLabel(row.replyCount);
  return (
    <Pressable
      onPress={() => onSelect(row)}
      accessibilityRole="button"
      accessibilityLabel={noteRowLabel(row)}
      testID={`annokit-notes-item-${row.id}`}
      style={({ pressed }) => [
        styles.item,
        // Settled discussion stays findable without competing with the live
        // screen — the same 45% its marker wears.
        row.settled && styles.itemSettled,
        pressed && styles.itemPressed,
      ]}
    >
      <Text style={styles.itemText} numberOfLines={2}>
        {row.text}
      </Text>
      <View style={styles.itemMetaRow}>
        <Text style={styles.itemAuthor} numberOfLines={1}>
          {row.author}
        </Text>
        {!!row.element && (
          <Text style={styles.itemMeta} numberOfLines={1}>
            {row.element}
          </Text>
        )}
        {!!replies && <Text style={styles.itemMeta}>{replies}</Text>}
        <View style={styles.spacer} />
        {/* A converted note has no word any more — it is dimmed instead, and
            an empty Text would still take the row's trailing gap. */}
        {!!row.status && (
          <Text style={[styles.itemStatus, row.settled && styles.itemStatusSettled]}>
            {row.status}
          </Text>
        )}
      </View>
    </Pressable>
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
    maxHeight: "72%",
    backgroundColor: p.sheet,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: p.border,
    paddingBottom: 28,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    // Was 2, with the subhead below it supplying the other 8. The subhead is
    // gone; the breathing room it provided is not.
    paddingBottom: 10,
  },
  headerTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexShrink: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  headerTitle: {
    color: p.textStrong,
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  empty: {
    color: p.textFaint,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
    lineHeight: 18,
  },
  group: {
    marginBottom: 6,
  },
  groupHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 4,
  },
  groupLabel: {
    color: p.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    flexShrink: 1,
  },
  groupHere: {
    color: p.textFaint,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  item: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
  },
  itemSettled: {
    opacity: 0.45,
  },
  itemPressed: {
    backgroundColor: p.pressed,
  },
  itemText: {
    color: p.textBody,
    fontSize: 14,
    lineHeight: 19,
  },
  itemMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 3,
  },
  itemAuthor: {
    color: p.textSecondary,
    fontSize: 11,
    fontWeight: "600",
    flexShrink: 1,
  },
  itemMeta: {
    color: p.textFaint,
    fontSize: 11,
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
  itemStatus: {
    color: p.teamText,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  itemStatusSettled: {
    color: p.textMuted,
  },
}));
