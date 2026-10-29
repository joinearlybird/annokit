/**
 * AGENT TASK detail: the queued task plus its follow-up thread, with a reply
 * box. Opened by tapping a list row — or by tapping the task's marker on the
 * screen itself (src/markers.tsx).
 *
 * The pane itself (sheet, header, destination badge, Delete/Back) is
 * src/detail-shell.tsx, shared with the team-note detail so the two read as
 * one thing with different contents; only the body and the actions below
 * differ. "Annotation" is still the wire word — see src/destination.ts for
 * why the UI says "agent task" instead.
 *
 * THIS PANE OWNS ITS TASK once it is open. It is handed a seed annotation
 * (the row that was tapped) and then re-reads `GET /annotations/:aid`,
 * which is the only place the whole object — thread AND status — can be had.
 * Owning it matters because the task's state moves while the pane is up: the
 * agent replies into the thread, the agent RESOLVES it (at which point it
 * leaves the pending list the pane was opened from, so a pane deriving its
 * annotation from that list would evaporate mid-conversation), and a human
 * reply reopens it. The pane closes when the user closes it, when the task is
 * deleted, or when the server says the id is gone — never because a list
 * behind it changed.
 *
 * IT REFRESHES WHILE IT IS OPEN, on the team-note conversation's cadence and
 * with its stop-on-failure rule (src/poll.ts). Only an open pane polls; the
 * decisions about what a poll may overwrite are src/thread.ts.
 *
 * AND IT CAN SEND. Replying to a task re-queues it server-side, but nothing
 * starts a turn until a human says so — so the commit lives here, one tap
 * from where the refinement was typed, instead of only in the queue's bulk
 * Send (which, for a task the agent had already resolved, did not list it at
 * all).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { TEXT_MAX } from "./limits";
import { serverFlavor } from "./agentation";
import { onAnnoKitEvent, streamLive as readStreamLive, subscribeToStreamLive } from "./events";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import { AnnoKitChatThread } from "./chat-thread";
import { formatChatTime, threadChatMessages } from "./chat";
import { AnnoKitDetailShell } from "./detail-shell";
import { detailContextLabel, routeDisplay, sourceRef } from "./detail-line";
import { autoScrollAnimated, isNearBottom, shouldAutoScroll, shouldFollowResize } from "./thread-scroll";
import type { ScrollReason } from "./thread-scroll";
import { AnnoKitIcon } from "./icon";
import {
  TASK_CONTEXT_LEAD_IN,
  TASK_ORIGIN_LABEL,
  isReopenedTask,
  splitTaskBody,
  taskOriginA11yLabel,
  taskOriginLine,
  taskReopenLabel,
} from "./message-task";
import { detailSendLabel } from "./queue-list";
import { taskProgress } from "./agent-activity";
import { readRuns, runLines } from "./runs";
import {
  THREAD_POLL_INTERVAL_MS,
  annotationThread,
  applyPolledThread,
  fetchAnnotation,
  newReplyLabel,
  postThreadReply,
  shouldPollThread,
} from "./thread";
import type { ThreadMessage } from "./thread";
import { createSequencer } from "./sequence";
import {
  isOpenableLink,
  openableA11yLabel,
  pictureUrl,
  referenceLine,
  screenshotA11yLabel,
  splitReferences,
} from "./reference-view";
import { AnnoKitScreenshotViewer } from "./screenshot-viewer";
import { postAccepted, type AnnoKitTransport } from "./transport";
import type { ServerAnnotation } from "./types";

interface Props {
  transport: AnnoKitTransport;
  annotation: ServerAnnotation;
  onClose: () => void;
  /**
   * Passed straight through to the shell: what this pane covers, and whether
   * the app under it is currently pushed up to clear it (src/push.ts). The
   * provider owns both, because the thing that moves is the app, not this
   * Modal.
   */
  onCovered?: (height: number) => void;
  pushing?: boolean;
  /**
   * Delete this annotation. Optional: the caller owns the pending list, and
   * dropping the annotation from it is what removes the row and the marker.
   * The pane closes itself.
   */
  onDelete?: (id: string) => void;
  /**
   * Open the team note this task was made from (the reverse of the note's
   * Tasks tab). Omitted — or absent on the task — and the origin is stated
   * as plain text rather than as a link that goes nowhere.
   */
  onOpenNote?: (commentId: string) => void;
  /**
   * The task's server state changed under the pane (an agent reply reopened
   * nothing, but a human reply re-queues it, and the agent resolves it).
   * The caller re-reads its pending list so the queue and the markers agree
   * with what this pane is showing.
   */
  onChanged?: () => void;
  /**
   * The task was handed to the agent from here. The caller closes whatever
   * it wants closed and refreshes; the pane itself does nothing further.
   */
  onSent?: () => void;
  /** An agent already has a task: a second one may not start (queue-list.ts). */
  agentBusy?: boolean;
}

function annotationText(a: ServerAnnotation): string {
  const value = a.comment ?? a.content ?? a.text;
  return typeof value === "string" && value.trim() ? value.trim() : "(no change text)";
}

export function AnnoKitThreadView({
  transport,
  annotation: seed,
  onClose,
  onDelete,
  onOpenNote,
  onChanged,
  onSent,
  agentBusy,
  onCovered,
  pushing,
}: Props) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  // The seed is the row that was tapped; everything after is the server's.
  const [annotation, setAnnotation] = useState<ServerAnnotation>(seed);
  const [messages, setMessages] = useState<ThreadMessage[]>(seed.thread ?? []);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  // Stops the backstop timer the first time the read fails — the same rule
  // the comment poll follows, for the same reason (src/poll.ts).
  const [available, setAvailable] = useState(true);
  // Replies that arrived while the reader was up in the history. The scroll
  // rule deliberately does not yank them back down, so without this a reply
  // can land with no sign of it anywhere on screen.
  const [unseen, setUnseen] = useState(0);
  // The thread lands at its newest message and follows your own replies
  // down; the rules (and the one case where following would be hostile) are
  // src/thread-scroll.ts.
  const scroller = useRef<ScrollView>(null);
  const atBottom = useRef(true);
  const reason = useRef<ScrollReason>("open");
  // Read by the poll, which must not clobber a reply that is still in flight.
  const busy = useRef(false);
  busy.current = sending;

  const annotationId = seed.id;
  const previousStatus = useRef<string | undefined>(seed.status);
  // The poll compares against what is on screen; a callback closing over
  // `messages` would rebuild — and so restart the timer — on every message.
  const messagesRef = useRef<ThreadMessage[]>(messages);
  messagesRef.current = messages;
  // Callers pass inline lambdas. Held in refs so `read` (and therefore the
  // open effect and the timer) does not rebuild on every parent render.
  const handlers = useRef({ onClose, onChanged });
  handlers.current = { onClose, onChanged };
  // One sequencer per pane, reset when the pane changes subject so a read
  // for the previous annotation cannot land in the new one.
  const readSeq = useRef(createSequencer());
  /** A server-granted screenshot, opened full size. Null when closed. */
  const [viewing, setViewing] = useState<string | null>(null);
  useEffect(() => {
    readSeq.current.reset();
  }, [annotationId, transport]);

  /**
   * One read of the whole annotation.
   *
   * `first` is the open read: it is authoritative over whatever the seed row
   * carried and it lands on the newest message without animating, whatever
   * the list was doing before it arrived. Every later read is a poll and
   * goes through `applyPolledThread`, which is where "leave the pane alone"
   * lives.
   */
  const read = useCallback(
    async (first: boolean): Promise<void> => {
      // ISSUE ORDER, NOT ARRIVAL ORDER. Three things drive this read — the
      // open effect, the backstop timer and any server event — and they
      // routinely overlap. Without this, a slow read started before a fast
      // one can land after it and put an older annotation back: a status
      // the agent has since changed, or a thread missing the reply that
      // just arrived. Stale answers are dropped whole, `gone` included,
      // because "it was deleted a moment ago" is not news about now.
      const ticket = readSeq.current.begin();
      const { annotation: fresh, gone } = await fetchAnnotation(transport, annotationId);
      if (!readSeq.current.accept(ticket)) return;
      // The server answered that this id does not exist — deleted, here or
      // elsewhere. A failed read is NOT this and leaves the pane standing.
      if (gone) {
        handlers.current.onClose();
        return;
      }
      if (!fresh) {
        if (!first) setAvailable(false);
        return;
      }
      setAvailable(true);
      setAnnotation(fresh);
      // A status change (the agent resolved it; our reply reopened it) is
      // news for whoever owns the pending list behind this pane.
      if (fresh.status !== previousStatus.current) {
        previousStatus.current = fresh.status;
        handlers.current.onChanged?.();
      }
      const thread = annotationThread(fresh);
      if (first) {
        if (!thread) return;
        reason.current = "open";
        setMessages(thread);
        return;
      }
      const polled = applyPolledThread(messagesRef.current, thread, busy.current);
      if (!polled.messages) return;
      reason.current = "incoming";
      setMessages(polled.messages);
      // Only count what the reader cannot see. At the bottom the messages
      // simply appear, which needs no announcement.
      if (polled.added > 0 && !atBottom.current) setUnseen((n) => n + polled.added);
    },
    [transport, annotationId],
  );

  // Opening: the seed row carries no thread, so this is the real first read.
  useEffect(() => {
    void read(true);
  }, [read]);

  // The backstop, alive only while this pane is (the component is mounted
  // exactly when the sheet is open), off once the read has failed, and off
  // while the event stream is live (src/events.ts).
  const streamLive = useSyncExternalStore(subscribeToStreamLive, readStreamLive, readStreamLive);
  useEffect(() => {
    if (!shouldPollThread({ enabled: true, available, streamLive })) return;
    const timer = setInterval(() => void read(false), THREAD_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [available, streamLive, read]);

  // The stream coming back: catch up on what it missed while it was down.
  // Not on first mount — the opening read above has just done that.
  const wasLive = useRef(streamLive);
  useEffect(() => {
    if (streamLive && !wasLive.current) void read(false);
    wasLive.current = streamLive;
  }, [streamLive, read]);

  // 5b: a server event lands the same read the timer would, immediately —
  // an agent reply appears while you are looking at the thread, which is
  // the whole point. Same read, so applyPolledThread's rules still govern.
  useEffect(() => {
    return onAnnoKitEvent(() => void read(false));
  }, [read]);

  const jumpToNewest = () => {
    setUnseen(0);
    scroller.current?.scrollToEnd({ animated: true });
  };

  const send = async () => {
    const content = reply.trim();
    if (!content || sending) return;
    setSending(true);
    setReply("");
    reason.current = "own";
    const ok = await postThreadReply(transport, annotationId, content, setMessages);
    setSending(false);
    // Failed send: the optimistic message is already gone, so put the text
    // back in the box instead of losing what the user typed.
    if (!ok) {
      setReply(content);
      return;
    }
    // A human reply re-queues a task the agent had finished with. Re-read so
    // the pane (and the list behind it) show that rather than waiting up to
    // a whole poll interval to notice.
    void read(false);
  };

  const handOver = async () => {
    if (handingOver) return;
    setHandingOver(true);
    // agentation compat: already live to the agent — see queue.tsx.
    const sent =
      serverFlavor() === "agentation"
        ? true
        : (await postAccepted(transport, "/annotations/send", { annotationIds: [annotationId] })).ok;
    setHandingOver(false);
    if (sent) onSent?.();
  };

  const origin = { source: annotation.source, routeName: annotation.routeName };
  const taskParts = splitTaskBody(annotationText(annotation));
  // Pictures to show, everything else to list (src/reference-view.ts).
  const refs = splitReferences(annotation.references);
  const reopened = isReopenedTask(annotation);
  const reopenLabel = taskReopenLabel(annotation);
  const progress = taskProgress(annotation);
  const runs = readRuns(annotation.runs);
  const handOverAction = detailSendLabel({
    status: annotation.status,
    reopened,
    sending: handingOver,
    agentBusy,
  });
  const unseenLabel = newReplyLabel(unseen);

  return (
    <AnnoKitDetailShell
      destination="agent"
      onCovered={onCovered}
      pushing={pushing}
      title={annotation.element || "This screen"}
      sourceRef={sourceRef(origin.source)}
      route={routeDisplay(origin.routeName)}
      contextLabel={detailContextLabel(origin)}
      onDelete={
        onDelete
          ? () => {
              // Closing here rather than waiting for a list behind the pane
              // to drop the row: this pane no longer derives from that list.
              onClose();
              onDelete(annotationId);
            }
          : undefined
      }
      deleteLabel="Delete this agent task"
      onClose={onClose}
      testID="annokit-thread"
      footer={
        <View style={styles.footer}>
          {/*
            THE REPLY THAT ARRIVED BEHIND YOU. Shown only when the reader is
            up in the history — at the bottom the message is simply there.
          */}
          {unseen > 0 && (
            <Pressable
              onPress={jumpToNewest}
              accessibilityRole="button"
              accessibilityLabel={`${unseenLabel}. Jump to the newest message`}
              style={({ pressed }) => [styles.unseen, pressed && styles.pressed]}
              testID="annokit-thread-unseen"
            >
              <AnnoKitIcon name="chevron" size={12} color={p.agentSoft} />
              <Text style={styles.unseenText}>{unseenLabel}</Text>
            </Pressable>
          )}
          <View style={styles.replyRow}>
            <TextInput
              testID="annokit-thread-input"
              maxLength={TEXT_MAX}
              style={styles.input}
              placeholder="Add detail…"
              placeholderTextColor={p.textMuted}
              multiline
              value={reply}
              onChangeText={setReply}
            />
            {/*
              A circle with an arrow, not a worded button: the input's own
              send. The words live in the accessibility label, and the one
              action that needs words — the hand-over below — keeps them.
            */}
            <Pressable
              onPress={send}
              disabled={!reply.trim() || sending}
              hitSlop={6}
              style={[styles.replyBtn, (!reply.trim() || sending) && styles.disabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !reply.trim() || sending, busy: sending }}
              accessibilityLabel="Post this reply on the task"
              testID="annokit-thread-send"
            >
              <AnnoKitIcon name="send" size={16} color={p.agentText} />
            </Pressable>
          </View>
          {/*
            WHAT THE AGENT IS DOING, while it is. The button below only says
            "With the agent"; the server's latest step says what that means
            right now (src/agent-activity.ts). Refreshed by the same event
            reads as the thread.
          */}
          {!!progress && (
            <View style={styles.progressRow} testID="annokit-thread-progress">
              <AnnoKitIcon name="agent" size={12} color={p.agentText} />
              <Text style={styles.progressText} numberOfLines={2}>
                {progress}
              </Text>
            </View>
          )}
          {/*
            THE COMMIT. Separate from Reply on purpose: a refinement is typed
            a sentence at a time, and starting a turn on each one would set
            the agent off on half a thought (src/queue-list.ts).
          */}
          <Pressable
            onPress={handOver}
            disabled={!handOverAction.enabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: !handOverAction.enabled }}
            accessibilityLabel={handOverAction.label}
            style={[styles.handOverBtn, !handOverAction.enabled && styles.disabled]}
            testID="annokit-thread-send-agent"
          >
            <Text style={styles.handOverText}>{handOverAction.label}</Text>
          </Pressable>
        </View>
      }
    >
      <ScrollView
        ref={scroller}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        scrollEventThrottle={64}
        onScroll={(e) => {
          atBottom.current = isNearBottom(e.nativeEvent);
          // Reaching the bottom IS reading them.
          if (atBottom.current && unseen > 0) setUnseen(0);
        }}
        onLayout={() => {
          // The sheet settles its height after the opening jump.
          if (shouldFollowResize(atBottom.current)) scroller.current?.scrollToEnd({ animated: false });
        }}
        onContentSizeChange={() => {
          const why = reason.current;
          // Anything that grows the content after this is someone else's
          // message until the user does something themselves.
          reason.current = "incoming";
          if (!shouldAutoScroll(why, atBottom.current)) return;
          scroller.current?.scrollToEnd({ animated: autoScrollAnimated(why) });
        }}
      >
        {/*
          WHERE IT CAME FROM. A task made out of a team-note message is a
          reply to a conversation, and reading it without being able to get
          back to that conversation is half the story — so the note's Tasks
          tab and this line are the same relationship, stated from both ends.
        */}
        {!!taskOriginLine(annotation) &&
          (onOpenNote && annotation.sourceCommentId ? (
            <Pressable
              onPress={() => onOpenNote(annotation.sourceCommentId as string)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={taskOriginA11yLabel(true)}
              style={({ pressed }) => [styles.origin, pressed && styles.originPressed]}
              testID="annokit-thread-origin"
            >
              <AnnoKitIcon name="comment" size={11} color={p.team} />
              <Text style={styles.originText}>{TASK_ORIGIN_LABEL} · Open the discussion</Text>
            </Pressable>
          ) : (
            <View
              style={styles.origin}
              accessibilityLabel={taskOriginA11yLabel(false)}
              testID="annokit-thread-origin"
            >
              <AnnoKitIcon name="comment" size={11} color={p.team} />
              <Text style={styles.originText}>{TASK_ORIGIN_LABEL}</Text>
            </View>
          ))}
        {/*
          THE TASK ITSELF, AS A CARD — the same card its row wears in the
          note's Tasks tab, so a task looks like a task wherever it is read
          (product owner). It was plain text here, which made the pane's one
          artifact indistinguishable from the chatter under it once the
          thread had a couple of replies in it.

          Two tiers inside the one surface: the request, then the quoted
          discussion it came out of, if any (src/message-task.ts splits what
          the protocol carries as one string).
        */}
        <View style={styles.taskCard} testID="annokit-thread-task">
          {/*
            REOPENED. The task is `pending` like any other — that is what
            gets it back in front of the agent — so the only thing that can
            tell the reader "this is work you argued with, not work you have
            never sent" is this line.
          */}
          {!!reopenLabel && (
            <View
              style={styles.reopened}
              accessibilityLabel={`${reopenLabel} by your reply — waiting to be sent again`}
              testID="annokit-thread-reopened"
            >
              <AnnoKitIcon name="agent" size={11} color={p.agentText} />
              <Text style={styles.reopenedText}>{reopenLabel} — waiting to be sent again</Text>
            </View>
          )}
          <Text style={styles.originalText}>{taskParts.request}</Text>
          {!!taskParts.context && (
            <View style={styles.taskContext}>
              <Text style={styles.taskContextLead}>{TASK_CONTEXT_LEAD_IN}</Text>
              <Text style={styles.taskContextText}>{taskParts.context}</Text>
            </View>
          )}
          {(refs.screenshots.length > 0 || refs.lines.length > 0) && (
            <View style={styles.refs}>
              {/*
                A PICTURE IS SHOWN, NOT SPELLED. Every reference used to be
                one line of text, which for a screenshot meant printing a
                presigned URL nobody can read — the least useful rendering
                of the one attachment whose whole value is being looked at.
              */}
              {refs.screenshots.length > 0 && (
                <View style={styles.refShots}>
                  {refs.screenshots.map((r, i) => (
                    <Pressable
                      key={`shot-${i}`}
                      onPress={() => setViewing(pictureUrl(r))}
                      testID={`annokit-task-screenshot-${i}`}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={screenshotA11yLabel(r)}
                    >
                      <Image
                        source={{ uri: pictureUrl(r) ?? undefined }}
                        style={styles.refShot}
                        resizeMode="cover"
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    </Pressable>
                  ))}
                </View>
              )}
              {refs.lines.map((r, i) =>
                // A link is a dead end as plain text: a worktree run reports
                // its result as a pull request the device cannot otherwise
                // reach, and the browser renders that diff far better than
                // this pane ever would.
                isOpenableLink(r) ? (
                  <Pressable
                    key={`${r.type}-${i}`}
                    onPress={() => { void Linking.openURL(r.value).catch(() => {}); }}
                    accessibilityRole="link"
                    accessibilityLabel={openableA11yLabel(r)}
                    testID={`annokit-ref-link-${i}`}
                  >
                    <Text style={[styles.refText, styles.refLink]} numberOfLines={1}>
                      {referenceLine(r)}
                    </Text>
                  </Pressable>
                ) : (
                  <Text key={`${r.type}-${i}`} style={styles.refText} numberOfLines={1}>
                    {referenceLine(r)}
                  </Text>
                ),
              )}
            </View>
          )}
        </View>
        {/*
          RUNS — every time an agent worked on this task, oldest first
          (src/runs.ts). Above the thread: the thread is what was said, this
          is what was done, and a re-run's reply reads better after the line
          saying which run it came from. Absent on a server with no history.
        */}
        {runs.length > 0 && (
          <View style={styles.runs} testID="annokit-thread-runs">
            <Text style={styles.runsLabel}>{runs.length === 1 ? "Run" : `Runs (${runs.length})`}</Text>
            {runs.map((run, i) => {
              const line = runLines(run);
              const tone = { ok: p.online, busy: p.agentText, bad: p.danger, muted: p.textMuted }[line.tone];
              return (
                <View key={run.id} style={styles.run} testID={`annokit-thread-run-${i}`}>
                  <View style={[styles.runDot, { backgroundColor: tone }]} />
                  <View style={styles.runBody}>
                    {/*
                      The run's title, then who ran it and how it went. Not
                      its summary or files: the agent's reply right below says
                      both, and saying them twice was noise (product owner).
                    */}
                    <Text style={styles.runWho} numberOfLines={1}>
                      {run.title ?? line.who}
                    </Text>
                    <Text style={[styles.runHow, { color: tone }]} numberOfLines={1}>
                      {run.title ? <Text style={styles.runMeta}>{`${line.who} · `}</Text> : null}
                      {line.how}
                      {run.startedAt ? <Text style={styles.runMeta}>{`  ·  ${formatChatTime(run.startedAt)}`}</Text> : null}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
        {/*
          The conversation. Blue is the agent's colour everywhere in this
          overlay, so your own bubbles carry it at low saturation — enough
          to read as "the agent's half", not enough to fight the text.

          EMPTY IS A DIVIDER, NOT A PARAGRAPH. "No replies yet" between two
          rules marks where the thread will start, under the task and above
          the reply box — a seam, not a message.
        */}
        {messages.length === 0 ? (
          <View style={styles.emptyDivider} testID="annokit-thread-empty">
            <View style={styles.emptyRule} />
            <Text style={styles.emptyText}>No replies yet</Text>
            <View style={styles.emptyRule} />
          </View>
        ) : (
          <AnnoKitChatThread
            messages={threadChatMessages(messages)}
            ownBubble={p.agentTintStrong}
            accent={p.agentText}
            testIDPrefix="annokit-thread-message"
          />
        )}
      </ScrollView>
      {viewing ? (
        <AnnoKitScreenshotViewer
          uri={viewing}
          label="Screenshot attached to this task, full size"
          onClose={() => setViewing(null)}
        />
      ) : null}
    </AnnoKitDetailShell>
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
  /**
   * The task, contained. The same surface the note's Tasks tab draws, so a
   * task is recognisably a task in both places.
   */
  runs: {
    marginTop: 12,
    gap: 8,
  },
  runsLabel: {
    color: p.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  run: {
    flexDirection: "row",
    gap: 8,
  },
  runDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 6,
  },
  runBody: {
    flex: 1,
    gap: 1,
  },
  runWho: {
    color: p.textBody,
    fontSize: 13,
    fontWeight: "600",
  },
  runHow: {
    fontSize: 12,
  },
  runMeta: {
    color: p.textMuted,
  },
  taskCard: {
    backgroundColor: p.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: p.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 8,
  },
  /** Blue: the agent's colour, because this is about the agent's turn. */
  reopened: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 8,
    backgroundColor: p.agentTintMid,
  },
  reopenedText: {
    color: p.agentSoft,
    fontSize: 11,
    fontWeight: "700",
  },
  /** The request: the headline of this pane, so it keeps size and weight. */
  originalText: {
    color: p.textStrong,
    fontSize: 15,
    lineHeight: 20,
  },
  /** The discussion it came out of: same card, one tier down. */
  taskContext: {
    borderLeftWidth: 2,
    borderLeftColor: p.teamRule,
    paddingLeft: 9,
    gap: 2,
  },
  taskContextLead: {
    color: p.textMuted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  taskContextText: {
    color: p.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  /** Orange, because it points back into the team's half of the overlay. */
  origin: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    marginBottom: 6,
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 8,
    backgroundColor: p.teamTintSoft,
  },
  originPressed: {
    opacity: 0.65,
  },
  originText: {
    // teamText, not team: it is type, and type follows src/accent.ts's rule.
    color: p.teamText,
    fontSize: 11,
    fontWeight: "700",
  },
  refs: {
    gap: 2,
  },
  refLink: {
    textDecorationLine: "underline",
  },
  refText: {
    color: p.textFaint,
    fontSize: 11,
  },
  // A row of them: an annotation can carry more than one over its life.
  refShots: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 6,
  },
  // Big enough to recognise the screen, small enough that the task text
  // stays the point of the card. Tapping opens the real thing.
  refShot: {
    width: 56,
    height: 100,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: p.border,
    backgroundColor: p.card,
  },
  footer: {
    paddingTop: 8,
  },
  /** The arrival cue, sitting just above the box the reader is looking at. */
  unseen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "center",
    marginBottom: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: p.agentTintStrong,
  },
  pressed: {
    opacity: 0.65,
  },
  unseenText: {
    color: p.agentTintInk,
    fontSize: 11,
    fontWeight: "700",
  },
  replyRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 20,
  },
  /** A pill, matching the circle beside it. Compact — hitSlop keeps the target. */
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
  /**
   * The input's own send: a tinted circle with an arrow, quieter than the
   * hand-over below it, because posting a reply is the smaller of the two
   * things this footer can do.
   */
  replyBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: p.agentTintMid,
    alignItems: "center",
    justifyContent: "center",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginTop: 8,
  },
  progressText: {
    flexShrink: 1,
    color: p.agentText,
    fontSize: 12,
  },
  handOverBtn: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: p.agent,
    // Full width because it has no partner — Reply belongs to the input
    // above it and Delete lives in the header.
    minHeight: 42,
    justifyContent: "center",
    alignItems: "center",
  },
  disabled: {
    opacity: 0.4,
  },
  handOverText: {
    color: p.onAccent,
    fontSize: 14,
    fontWeight: "700",
  },
  /** "No replies yet", as a seam between the task and the reply box. */
  emptyDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 18,
  },
  emptyRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: p.borderStrong,
  },
  emptyText: {
    color: p.textFaint,
    fontSize: 13,
  },
}));
