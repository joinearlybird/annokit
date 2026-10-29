/**
 * TEAM NOTE detail: one anchored discussion — every message with its author,
 * a reply box, Resolve/Reopen, Delete — and the one bridge to the agent.
 *
 * Opened from a marker (src/markers.tsx) or a list row (src/notes.tsx). It
 * reads the authoritative thread with `GET /comments/:id` on open, because
 * the list it came from carries whatever the last refresh saw and a
 * teammate may have replied since.
 *
 * The pane itself is src/detail-shell.tsx, shared with the agent-task detail
 * — same sheet, same header, same badge slot — so a user reading one has
 * already learned the other. "Comment" is still the wire word; the UI says
 * "team note" (src/destination.ts explains why).
 *
 * THE BRIDGE IS PER-MESSAGE NOW. It used to be one footer button that
 * flattened the WHOLE discussion into a task and marked the note
 * `converted`, after which the pane offered nothing further. On the device
 * that read as: unclear what was being sent, wrong unit (one line in a
 * discussion is usually the actual request), and a dead end. So:
 *
 *   · "Create agent task" in the action row enters selection mode with
 *     checkboxes (long-press on a message is a shortcut into the same
 *     mode) — the per-message sparkle was tried and retired: it cluttered
 *     every row to serve the occasional tap (product owner);
 *   · a message that produced a task wears a chip ON ITS HEADER LINE,
 *     after the time, that OPENS it;
 *   · the TASKS tab is the roll-up — everything this discussion produced;
 *   · the note is never consumed. It stays open, and can produce another.
 *
 * The rules live in src/message-task.ts and are unit-tested there; this file
 * only draws them.
 *
 * Authors are SERVER-RESOLVED. The client has no user directory, so every
 * name and avatar here came back from the server; a message whose author
 * the server could not resolve reads "Someone" rather than inventing one.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { TEXT_MAX } from "./limits";
import { pictureUrl, screenshotA11yLabel, splitReferences } from "./reference-view";
import { AnnoKitScreenshotViewer } from "./screenshot-viewer";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import { ACTION_PADDING_H } from "./action-row";
import { AnnoKitChatThread } from "./chat-thread";
import { commentChatMessages } from "./chat";
import { AnnoKitDetailShell } from "./detail-shell";
import { detailContextLabel, routeDisplay, sourceRef } from "./detail-line";
import { AnnoKitIcon } from "./icon";
import { autoScrollAnimated, isNearBottom, shouldAutoScroll, shouldFollowResize } from "./thread-scroll";
import type { ScrollReason } from "./thread-scroll";
import {
  deleteComment,
  fetchComment,
  nextCommentStatus,
  postCommentMessage,
  setCommentStatus,
} from "./comments";
import type { Comment } from "./comments";
import {
  CREATE_TASK_LABEL,
  NOTE_TASKS_EMPTY,
  TASK_CONTEXT_LEAD_IN,
  canMakeMessageTask,
  createTaskFromMessages,
  messageTaskActionLabel,
  messageTaskFlowHint,
  messageTaskMarks,
  noteTaskRows,
  noteTasksTabLabel,
  toggleMessageSelection,
} from "./message-task";
import type { LocalTaskLink } from "./message-task";
import { teamNoteStatus } from "./queue-list";
import { AnnoKitTransport, makeId } from "./transport";
import type { ServerAnnotation } from "./types";
import { AnnoKitNamePrompt, AnnoKitViewerLine, useViewerIdentity } from "./name-prompt";
import { needsViewerName, viewerName } from "./viewer";

interface Props {
  transport: AnnoKitTransport;
  /** Session a task made from this note is filed under. */
  sessionId: string;
  comment: Comment;
  /**
   * This session's agent tasks: the pending list, plus tasks made from a
   * note that have since been sent (mergeTaskLists, src/message-task.ts).
   * The note's Tasks tab and the chips on its bubbles both read this list.
   */
  annotations?: readonly ServerAnnotation[];
  /** A newer copy of this comment came back from the server. */
  onUpdated: (comment: Comment) => void;
  /** It is gone (deleted, here). */
  onDeleted: (id: string) => void;
  /** A task was created — the provider refetches the pending list. */
  onTaskCreated?: (annotationId: string) => void;
  /** Open an agent task's detail (the provider swaps the panes over). */
  onOpenTask?: (annotationId: string) => void;
  onClose: () => void;
  /**
   * Passed straight through to the shell: what this pane covers, and whether
   * the app under it is currently pushed up to clear it (src/push.ts). The
   * provider owns both, because the thing that moves is the app, not this
   * Modal.
   */
  onCovered?: (height: number) => void;
  pushing?: boolean;
}


type Tab = "conversation" | "tasks";

export function AnnoKitCommentView({
  transport,
  sessionId,
  comment: initial,
  annotations,
  onUpdated,
  onDeleted,
  onTaskCreated,
  onOpenTask,
  onClose,
  onCovered,
  pushing,
}: Props) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const [comment, setComment] = useState<Comment>(initial);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<null | "reply" | "status" | "task" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  // "ask" is the first time, "edit" is the Change affordance below the box.
  const [askName, setAskName] = useState<null | "ask" | "edit">(null);
  const [tab, setTab] = useState<Tab>("conversation");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  /** What the user typed in the flow's own box: the REQUEST, not a reply. */
  const [instruction, setInstruction] = useState("");
  /**
   * Tasks this device made in this session. Only a fallback: the durable
   * link is on the annotation itself (`sourceMessageIds`), and this is what
   * keeps the chip honest on a server that drops the field — see
   * `messageTaskMarks`.
   */
  const [localLinks, setLocalLinks] = useState<LocalTaskLink[]>([]);
  const identity = useViewerIdentity();
  // Land on the newest message and follow your own replies down — a note
  // with a discussion on it opened onto its oldest line otherwise
  // (src/thread-scroll.ts holds the rules and the do-not-yank case).
  const scroller = useRef<ScrollView>(null);
  /** A server-granted screenshot, opened full size. Null when closed. */
  const [viewing, setViewing] = useState<string | null>(null);
  const noteRefs = splitReferences(comment.references);
  const atBottom = useRef(true);
  const reason = useRef<ScrollReason>("open");

  // Take whatever the server has; a failed read keeps what is on screen
  // rather than blanking the pane (fail-soft, same posture as the rest).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fresh = await fetchComment(transport, initial.id);
      if (cancelled || !fresh) return;
      // Still "opening" (see ScrollReason): the first authoritative read
      // lands on the newest message without animating.
      reason.current = "open";
      setComment(fresh);
      onUpdated(fresh);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, initial.id]);

  const tasks = annotations ?? [];
  const marks = useMemo(
    () => messageTaskMarks(tasks, localLinks, comment.id),
    [tasks, localLinks, comment.id],
  );
  const taskRows = useMemo(() => noteTaskRows(tasks, comment), [tasks, comment]);

  const accept = (fresh: Comment | null, whatFailed: string): boolean => {
    if (!fresh) {
      setError(whatFailed);
      return false;
    }
    setError(null);
    setComment(fresh);
    onUpdated(fresh);
    return true;
  };

  const send = async (nameHint?: string | null) => {
    const content = reply.trim();
    if (!content || busy) return;
    // Ask once, here, rather than the moment the pane opens: a reader who
    // never replies is never interrupted.
    if (!nameHint && needsViewerName()) {
      setAskName("ask");
      return;
    }
    setBusy("reply");
    setReply("");
    reason.current = "own";
    const updated = await postCommentMessage(
      transport,
      comment.id,
      content,
      nameHint ?? viewerName(),
    );
    setBusy(null);
    // Failed send: put the text back rather than losing what was typed.
    if (!accept(updated, "Reply not saved")) setReply(content);
  };

  const toggleStatus = async () => {
    const next = nextCommentStatus(comment.status);
    if (!next || busy) return;
    setBusy("status");
    const updated = await setCommentStatus(transport, comment.id, next);
    setBusy(null);
    accept(updated, "Status not changed");
  };

  /**
   * MAKE A TASK out of these messages — one, or the ticked set.
   *
   * The note is untouched by it: no status write, nothing to half-fail, and
   * the same message may be sent again later if someone wants a second task.
   * A failure says so and leaves the selection alone so it can be retried.
   */
  const makeTask = async (ids: readonly string[], written = "") => {
    if (busy || !canMakeMessageTask(comment.messages, ids, written)) return;
    setBusy("task");
    const annotationId = makeId();
    const result = await createTaskFromMessages(
      transport,
      sessionId,
      comment,
      ids,
      annotationId,
      written,
    );
    setBusy(null);
    if (!result.ok || !result.annotationId) {
      setError("The task was not created — nothing was sent");
      return;
    }
    setError(null);
    setLocalLinks((prev) => [
      ...prev,
      ...(result.messageIds ?? ids).map((messageId) => ({
        messageId,
        annotationId: result.annotationId as string,
      })),
    ]);
    // Back to reading the conversation, with the box emptied: the flow is
    // finished, and a leftover sentence would be the next task's opening
    // words without anyone having asked for that.
    endFlow();
    onTaskCreated?.(result.annotationId);
  };

  const remove = async () => {
    if (busy) return;
    setBusy("delete");
    const ok = await deleteComment(transport, comment.id);
    setBusy(null);
    if (!ok) {
      setError("Could not delete this note");
      return;
    }
    onDeleted(comment.id);
    onClose();
  };

  /**
   * ENTER THE FLOW. Called by "Create Agent Task" in the action row, and by
   * the long-press shortcut on a bubble (which arrives with that bubble
   * already ticked).
   */
  const startSelecting = (firstId?: string) => {
    setSelecting(true);
    setSelected(typeof firstId === "string" && firstId ? [firstId] : []);
    setInstruction("");
  };

  /** Leave it — cancelled or finished. Nothing about the note changed. */
  const endFlow = () => {
    setSelecting(false);
    setSelected([]);
    setInstruction("");
  };

  const showTab = (next: Tab) => {
    if (next === tab) return;
    // Coming back to the conversation is an "open" again: the thread lands
    // on its newest message rather than wherever the remounted list starts.
    if (next === "conversation") reason.current = "open";
    endFlow();
    setTab(next);
  };

  const statusLabel = teamNoteStatus(comment.status);
  const origin = { source: comment.source, routeName: comment.routeName };
  const canSend = canMakeMessageTask(comment.messages, selected, instruction);

  return (
    <AnnoKitDetailShell
      destination="comment"
      onCovered={onCovered}
      pushing={pushing}
      title={comment.element || "This screen"}
      sourceRef={sourceRef(origin.source)}
      route={routeDisplay(origin.routeName)}
      contextLabel={detailContextLabel(origin)}
      status={statusLabel}
      error={error}
      /*
        NO HEADER ACTION. "Select" lived up here and was wrong twice: it is
        an ACTION, and actions on this pane live in the bottom row with
        Resolve (product owner), and "Select" named the mechanism rather than
        the outcome. It is now "Create Agent Task", down there with the
        others, and the header is back to title + delete + close.
      */
      onDelete={remove}
      deleteLabel="Delete this team note"
      onClose={onClose}
      testID="annokit-comment"
      footer={
        tab === "tasks" ? null : selecting ? (
          /*
            THE FLOW'S OWN BOTTOM BAR. Selection is not a mode you toggle and
            then hunt for a button — it is a flow with its own controls, and
            while it is running these ARE the pane's controls: what is picked,
            a box for the request itself, and Cancel next to the confirm.
            The reply box and Resolve are gone for the duration, because
            replying to your team mid-task-creation is a different job.
          */
          <View style={styles.flowBar}>
            <Text style={styles.selectHint} testID="annokit-comment-select-count">
              {messageTaskFlowHint(selected.length)}
            </Text>
            {/*
              THE REQUEST. The quoted messages say what was SAID; this says
              what to DO. It leads the task body (src/message-task.ts), and
              on its own it is still a valid task — which is why the confirm
              below enables on either one.
            */}
            <TextInput
              testID="annokit-comment-task-input"
              maxLength={TEXT_MAX}
              style={styles.input}
              placeholder="What should the agent do?"
              placeholderTextColor={p.textMuted}
              accessibilityLabel="What the agent should do — the instruction for this task"
              multiline
              value={instruction}
              onChangeText={setInstruction}
            />
            <View style={styles.flowActions}>
              <Pressable
                onPress={endFlow}
                disabled={busy === "task"}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy === "task" }}
                accessibilityLabel="Cancel making an agent task"
                style={[styles.secondaryBtn, busy === "task" && styles.disabled]}
                testID="annokit-comment-cancel-task"
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void makeTask(selected, instruction)}
                disabled={!canSend || busy !== null}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSend || busy !== null, busy: busy !== null }}
                accessibilityLabel={messageTaskActionLabel(selected.length)}
                style={[styles.taskBtn, (!canSend || busy !== null) && styles.disabled]}
                testID="annokit-comment-make-task"
              >
                <Text style={styles.taskText}>
                  {busy === "task" ? "Making…" : messageTaskActionLabel(selected.length)}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            {askName ? (
              <AnnoKitNamePrompt
                accent={p.team}
                initial={askName === "edit" ? identity.name : null}
                onConfirm={(name) => {
                  const wasEdit = askName === "edit";
                  setAskName(null);
                  // The first ask was standing in for a Send; an edit was not.
                  if (!wasEdit) void send(name);
                }}
                onCancel={() => setAskName(null)}
              />
            ) : (
              <AnnoKitViewerLine identity={identity} onChange={() => setAskName("edit")} />
            )}
            <View style={styles.replyRow}>
              <TextInput
                testID="annokit-comment-input"
                maxLength={TEXT_MAX}
                style={styles.input}
                placeholder="Reply…"
                placeholderTextColor={p.textMuted}
                multiline
                value={reply}
                onChangeText={setReply}
              />
              {/*
                A circle with an arrow, matching the agent pane's: the input's
                own send. The words live in the accessibility label; the two
                worded actions below are the ones that act on the note.
              */}
              <Pressable
                onPress={() => void send()}
                disabled={!reply.trim() || busy !== null || askName !== null}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityState={{
                  disabled: !reply.trim() || busy !== null || askName !== null,
                  busy: busy !== null,
                }}
                accessibilityLabel="Send this reply to your team"
                style={[
                  styles.sendBtn,
                  (!reply.trim() || busy !== null || askName !== null) && styles.disabled,
                ]}
                testID="annokit-comment-send"
              >
                <AnnoKitIcon name="send" size={16} color={p.agentText} />
              </Pressable>
            </View>

            {/*
              THE ACTION ROW: everything this pane can DO to the note.
              Resolve wears an outline and a check — a real button now, but
              a quiet one — and "Create agent task" is the filled blue one,
              because handing work to the agent is the bridge to the other
              half and the row's main event.
            */}
            <View style={styles.footer}>
              {nextCommentStatus(comment.status) && (
                <Pressable
                  onPress={toggleStatus}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  accessibilityLabel={
                    comment.status === "open" ? "Resolve this note" : "Reopen this note"
                  }
                  accessibilityState={{ disabled: busy !== null, busy: busy !== null }}
                  style={[styles.secondaryBtn, busy !== null && styles.disabled]}
                  testID="annokit-comment-resolve"
                >
                  {comment.status === "open" && (
                    <AnnoKitIcon name="check" size={13} color={p.textStrong} />
                  )}
                  <Text style={styles.secondaryText}>
                    {busy === "status" ? "…" : comment.status === "open" ? "Resolve" : "Reopen"}
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => startSelecting()}
                disabled={busy !== null}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy !== null, busy: busy !== null }}
                accessibilityLabel="Create an agent task from this discussion"
                style={[styles.taskBtn, busy !== null && styles.disabled]}
                testID="annokit-comment-create-task"
              >
                <Text style={styles.taskText}>{CREATE_TASK_LABEL}</Text>
              </Pressable>
            </View>
          </>
        )
      }
    >
      {/*
        TWO TABS, always both. Tasks stays visible at zero with a calm empty
        state rather than appearing later and moving Conversation under the
        user's thumb.
      */}
      <View style={styles.tabs}>
        <TabButton
          label="Conversation"
          active={tab === "conversation"}
          onPress={() => showTab("conversation")}
          testID="annokit-comment-tab-conversation"
        />
        <TabButton
          label={noteTasksTabLabel(taskRows.length)}
          active={tab === "tasks"}
          onPress={() => showTab("tasks")}
          testID="annokit-comment-tab-tasks"
        />
      </View>

      {tab === "tasks" ? (
        <ScrollView style={styles.body} contentContainerStyle={styles.tasksContent}>
          {taskRows.length === 0 ? (
            <Text style={styles.tasksEmpty} testID="annokit-comment-tasks-empty">
              {NOTE_TASKS_EMPTY}
            </Text>
          ) : (
            /*
              ONE CALM CARD PER TASK.

              A task is an ARTIFACT — the defined thing the agent will act on
              — and an artifact benefits from an edge, the same reasoning
              that kept bubbles when the rest of the overlay lost its boxes
              (product owner). These were plain rows separated by nothing,
              which read as a list of sentences rather than a list of things.

              ONE card, never cards inside cards: the quoted context is a
              quieter TIER within the same surface — a rule and a dimmer
              colour — not a second container.

              NO KIND PREFIX HERE. Every row in this tab is an agent task by
              construction, so "Agent task ·" on each of them would be the
              same word repeated down the column; the blue mark carries it.
            */
            taskRows.map((row, i) => (
              <Pressable
                key={row.id}
                onPress={() => onOpenTask?.(row.id)}
                disabled={!onOpenTask}
                accessibilityRole="button"
                accessibilityState={{ disabled: !onOpenTask }}
                accessibilityLabel={`Open agent task: ${row.text}`}
                style={({ pressed }) => [styles.taskCard, pressed && styles.pressed]}
                testID={`annokit-comment-task-${i}`}
              >
                <View style={styles.taskCardHead}>
                  <AnnoKitIcon name="agent" size={13} color={p.agentText} />
                  <Text style={styles.taskCardText}>{row.request}</Text>
                </View>
                {!!row.context && (
                  <View style={styles.taskCardContext}>
                    <Text style={styles.taskCardContextLead}>{TASK_CONTEXT_LEAD_IN}</Text>
                    <Text style={styles.taskCardContextText} numberOfLines={4}>
                      {row.context}
                    </Text>
                  </View>
                )}
                <Text style={styles.taskCardMeta} numberOfLines={1}>
                  {[row.status, row.at, row.from].filter(Boolean).join(" · ")}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      ) : (
        <ScrollView
          ref={scroller}
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          scrollEventThrottle={64}
          onScroll={(e) => {
            atBottom.current = isNearBottom(e.nativeEvent);
          }}
          onLayout={() => {
            // The sheet settles its height after the opening jump.
            if (shouldFollowResize(atBottom.current)) scroller.current?.scrollToEnd({ animated: false });
          }}
          onContentSizeChange={() => {
            const why = reason.current;
            reason.current = "incoming";
            if (!shouldAutoScroll(why, atBottom.current)) return;
            scroller.current?.scrollToEnd({ animated: autoScrollAnimated(why) });
          }}
        >
          {/*
            The discussion, FLAT — avatar, name, time, then the words, every
            message left-aligned (the redesign: a note pinned to an element
            reads as comments on it, not as a messaging app). Whose messages
            are yours is whatever author id the server echoed back on this
            device's own writes (src/viewer.ts).
          */}
          {/*
            WHAT THE NOTE POINTS AT, above the discussion about it. A note
            may now carry its own screenshot (POST /comments/:id/screenshot,
            appended by the server as a reference), and "look at this" is
            most of what people mean when they pin a note to an element —
            so the picture belongs before the words, not buried under them.
          */}
          {noteRefs.screenshots.length > 0 && (
            <View style={styles.noteShots}>
              {noteRefs.screenshots.map((r, i) => (
                <Pressable
                  key={`shot-${i}`}
                  onPress={() => setViewing(pictureUrl(r))}
                  testID={`annokit-note-screenshot-${i}`}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={screenshotA11yLabel(r)}
                >
                  <Image
                    source={{ uri: pictureUrl(r) ?? undefined }}
                    style={styles.noteShot}
                    resizeMode="cover"
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                </Pressable>
              ))}
            </View>
          )}
          <AnnoKitChatThread
            layout="comments"
            messages={commentChatMessages(comment.messages, identity)}
            // Unused by the flat layout, but the prop is required: the team
            // orange, faded, exactly as the chat layout wore it.
            ownBubble={p.teamTintStrong}
            accent={p.team}
            testIDPrefix="annokit-comment-message"
            selecting={selecting}
            selectedIds={selected}
            onToggle={(id) => setSelected((prev) => toggleMessageSelection(prev, id))}
            onLongPress={startSelecting}
            marks={marks}
            onOpenTask={onOpenTask}
            taskAccent={p.agentText}
          />
        </ScrollView>
      )}
      {viewing ? (
        <AnnoKitScreenshotViewer
          uri={viewing}
          label="Screenshot attached to this note, full size"
          onClose={() => setViewing(null)}
        />
      ) : null}
    </AnnoKitDetailShell>
  );
}

function TabButton({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((p) => ({
  body: {
    // Grow to fit, and SHRINK once the pane hits its cap. react-native's
    // flexShrink defaults to 0, not 1: without this a long thread pushes the
    // footer — the reply box and the pane's commit — past the bottom edge,
    // where it cannot be reached at all.
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  // Above the discussion, not under it: the picture is what the note is
  // pointing at, and the words are the conversation about it.
  noteShots: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  noteShot: {
    width: 56,
    height: 100,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: p.border,
    backgroundColor: p.card,
  },
  headerAction: {
    color: p.agentText,
    fontSize: 13,
    fontWeight: "700",
  },
  /** An underline, not a segmented control: two words and a rule under one. */
  tabs: {
    flexDirection: "row",
    gap: 18,
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: p.hairline,
  },
  tab: {
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    // The ink itself, not an accent: the tab is navigation, and the two
    // accents are reserved for meaning who acts (mock).
    borderBottomColor: p.textStrong,
  },
  tabLabel: {
    color: p.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  tabLabelActive: {
    color: p.textStrong,
  },
  tasksContent: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 12,
  },
  tasksEmpty: {
    color: p.textFaint,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    paddingVertical: 26,
    paddingHorizontal: 16,
  },
  /**
   * The card. A contained surface with a subtle edge — enough to say "this
   * is a defined thing", not enough to compete with the text inside it.
   */
  taskCard: {
    backgroundColor: p.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: p.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 10,
    gap: 8,
  },
  taskCardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  /** The request: the artifact, so it gets the size and the brightness. */
  taskCardText: {
    flex: 1,
    color: p.textStrong,
    fontSize: 14,
    lineHeight: 19,
  },
  /**
   * The quoted discussion: the SAME card, one tier down. A rule and a dimmer
   * colour rather than a nested box — this is context, not a second thing.
   */
  taskCardContext: {
    borderLeftWidth: 2,
    borderLeftColor: p.teamRule,
    paddingLeft: 9,
    gap: 2,
  },
  taskCardContextLead: {
    color: p.textMuted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  taskCardContextText: {
    color: p.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  taskCardMeta: {
    color: p.textFaint,
    fontSize: 11,
  },
  replyRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  /** A pill, matching the circle beside it — same pair as the agent pane. */
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: p.inputBorder,
    backgroundColor: p.raised,
    color: p.textStrong,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 13,
    textAlignVertical: "top",
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: p.agentTintMid,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  /** A real button now — outlined and quiet, with a check beside the word. */
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: p.borderStrong,
  },
  secondaryText: {
    color: p.textStrong,
    fontSize: 14,
    fontWeight: "600",
  },
  /** The flow's own footer: what is picked, what to do, and the two exits. */
  flowBar: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  flowActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  selectHint: {
    color: p.textMuted,
    fontSize: 12,
    flexShrink: 1,
  },
  taskBtn: {
    // The row's main event: it takes the room Resolve leaves.
    flexGrow: 1,
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: ACTION_PADDING_H,
    borderRadius: 12,
    // Blue: this hands work to the AGENT, and blue is what the agent's
    // half of the overlay is coloured throughout.
    backgroundColor: p.agent,
  },
  taskText: {
    color: p.onAccent,
    fontSize: 14,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.65,
  },
  disabled: {
    opacity: 0.4,
  },
}));
