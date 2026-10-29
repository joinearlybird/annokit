/**
 * THE MESSAGE LIST, drawn as a conversation.
 *
 * One component for both detail panes, because a thread is a thread: the
 * agent-task thread (src/thread-view.tsx) and the team-note thread
 * (src/comment-view.tsx) differ in who is speaking, not in how speech is
 * read. What varies is one colour — blue where the agent acts, orange
 * where the team talks — and it arrives as a prop.
 *
 * WHY BUBBLES HERE, WHEN THE REST OF THE SHEET LOST ITS BOXES. The pass
 * that flattened this overlay was right: a composer wrapped in a card
 * inside a card inside a sheet is three borders saying one thing. A
 * conversation is the exception, and the only one — the bubble is not
 * decoration around a message, it IS the message's extent, and the edge it
 * is pinned to is who said it. Take those away and a thread becomes a wall
 * of text where nobody is speaking (product owner, device testing).
 *
 * The rules it draws — side, grouping, time — are in src/chat.ts and tested
 * there. This file only lays them out:
 *
 *   · your messages right, in the destination's colour at low saturation;
 *     everyone else (and the agent) left, on a neutral surface
 *   · a burst from one author inside the window is ONE turn: one avatar,
 *     one name, one time, tight inside, generous between
 *   · the last bubble of a turn drops its inner corner, so a turn has a
 *     shape rather than being a stack of identical rectangles
 *
 * WHAT IS TAPPABLE HERE, and why that is still safe. A team-note bubble can
 * be turned into an agent task, so a bubble carries an action and (once it
 * has spawned one) a chip that opens the task. All of it is optional — the
 * agent-task thread passes none of it and renders exactly as before — and
 * all of it lives inside the detail sheet, which is a Modal rendered OUTSIDE
 * AnnoKitCaptureRoot (src/index.tsx). The overlay's rule holds: nothing
 * interactive is inside the subtree the inspector hit-tests.
 *
 * The action is a VISIBLE control, not a long-press. A hidden gesture is a
 * feature nobody finds (product owner); the long-press is kept only as a
 * shortcut into the same selection mode the note's "Create Agent Task"
 * button opens.
 */

import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import { chatInitial, formatChatTime, groupChatMessages } from "./chat";
import type { ChatGroup, ChatMessage } from "./chat";
import { AnnoKitIcon } from "./icon";
import { MESSAGE_TASK_MARK_LABEL, messageSelectionLabel, messageTaskMarkLabel } from "./message-task";
import type { MessageTaskMark } from "./message-task";


interface Props {
  messages: readonly ChatMessage[];
  /**
   * The destination's colour, LOW SATURATION, for your own bubbles — blue
   * on agent tasks, orange on team notes. Passed in by the pane that owns
   * the thread, because only it knows which half of the overlay this is.
   */
  ownBubble: string;
  /** The same colour at full strength, for the avatar mark and its text. */
  accent: string;
  /** Existing per-message testIDs are `${testIDPrefix}-${flat index}`. */
  testIDPrefix: string;
  /** Calm, when there is nothing yet. */
  empty?: string;
  /**
   * SELECTION MODE. On: every bubble is a checkbox. Off (and with `onMake`
   * given): every bubble carries its own small action instead. Absent
   * entirely: a plain thread, which is what the agent-task pane renders.
   */
  selecting?: boolean;
  selectedIds?: readonly string[];
  /** Tick/untick in selection mode. */
  onToggle?: (id: string) => void;
  /** The per-bubble action: make an agent task out of this one message. */
  onMake?: (id: string) => void;
  /** The shortcut into selection mode. Never the only way in. */
  onLongPress?: (id: string) => void;
  /** Bubbles that already spawned a task, by message id. */
  marks?: Record<string, MessageTaskMark>;
  /** Open the task a marked bubble points at. */
  onOpenTask?: (annotationId: string) => void;
  /** The blue the agent's half of the overlay is drawn in. Defaults to it. */
  taskAccent?: string;
  /**
   * HOW THE THREAD IS DRAWN. "chat" is the bubble conversation — sides,
   * tints, tails — and is what the agent-task thread renders: you and the
   * agent taking turns. "comments" is the flat, annotation-style list the
   * team note wears since the redesign: every message left-aligned under an
   * avatar + name + time header, plain text, the make-a-task control riding
   * the row's free right edge. A discussion pinned to an element reads as
   * comments on it, not as a messaging app.
   */
  layout?: "chat" | "comments";
}


export function AnnoKitChatThread({
  messages,
  ownBubble,
  accent,
  testIDPrefix,
  empty = "No replies yet",
  selecting = false,
  selectedIds,
  onToggle,
  onMake,
  onLongPress,
  marks,
  onOpenTask,
  taskAccent,
  layout = "chat",
}: Props) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  if (messages.length === 0) {
    return <Text style={styles.empty}>{empty}</Text>;
  }
  const flat = layout === "comments";
  const groups = groupChatMessages(messages);
  const picked = new Set(selectedIds ?? []);
  // The flat index every message had before grouping — the testIDs the
  // device automation and the queue's deep links use are positional.
  let index = -1;
  const flatIndexById = new Map(messages.map((m, i) => [m.id, i] as const));
  return (
    <View style={styles.list}>
      {groups.map((group, g) => (
        <View
          key={group.key}
          style={[
            styles.group,
            g === 0 && styles.firstGroup,
            flat || group.side !== "own" ? styles.groupOther : styles.groupOwn,
          ]}
        >
          <GroupHeader
            group={group}
            accent={accent}
            flat={flat}
            trailing={
              /*
                IN THE FLAT LAYOUT THE MARK RIDES THE HEADER, after the time
                — "Johnny · 1:48 pm  [✦ Agent task]" — because the header is
                the row's one line of metadata and the mark IS metadata:
                what this message became, not part of what it says.
              */
              flat && marks
                ? group.messages
                    .filter((m) => marks[m.id])
                    .map((m) => (
                      <TaskMark
                        key={m.id}
                        mark={marks[m.id]}
                        accent={taskAccent ?? p.agentText}
                        onOpen={onOpenTask}
                        inHeader
                        testID={`${testIDPrefix}-task-${flatIndexById.get(m.id)}`}
                      />
                    ))
                : null
            }
          />
          <View
            style={
              flat
                ? styles.bubblesFlat
                : group.side === "own"
                  ? styles.bubblesOwn
                  : styles.bubblesOther
            }
          >
            {group.messages.map((message, m) => {
              index += 1;
              const last = m === group.messages.length - 1;
              const own = message.side === "own";
              const mark = marks?.[message.id];
              const isPicked = picked.has(message.id);
              // Flat mode: the message is plain text under its header — the
              // container is the sheet itself, so no bubble to tint or tail.
              const bubbleStyle = flat
                ? [styles.flatMessage, m > 0 && styles.bubbleStacked]
                : [
                    styles.bubble,
                    m > 0 && styles.bubbleStacked,
                    last && (own ? styles.tailOwn : styles.tailOther),
                    { backgroundColor: own ? ownBubble : p.chip },
                    selecting && isPicked && { borderColor: taskAccent, borderWidth: 1 },
                  ];
              const body = <Text style={styles.text}>{message.content}</Text>;
              const rowStyle = [
                styles.messageRow,
                flat || !own ? styles.messageRowOther : styles.messageRowOwn,
              ];

              /*
                SELECTION MODE: THE WHOLE ROW IS THE CONTROL.

                It used to be the bubble alone, with the checkbox drawn beside
                it as a plain View. That checkbox is the thing that LOOKS like
                the control, so it is the thing people tap — and tapping it
                did nothing at all (product owner, device testing: "the select
                messages is not working"). Making the checkbox its own
                Pressable would have fixed that one tap and left the same trap
                one refactor away, so instead there is exactly ONE press
                target per row and the checkbox is drawn inside it. A dead
                affordance is now not expressible here.
              */
              if (selecting && onToggle) {
                return (
                  <Pressable
                    key={message.id}
                    onPress={() => onToggle(message.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isPicked }}
                    accessibilityLabel={messageSelectionLabel(message.authorName, isPicked)}
                    testID={`${testIDPrefix}-${index}`}
                    style={({ pressed }) => [...rowStyle, pressed && styles.pressed]}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        isPicked && { backgroundColor: taskAccent, borderColor: taskAccent },
                      ]}
                      testID={`${testIDPrefix}-check-${index}`}
                    >
                      {isPicked && <AnnoKitIcon name="check" size={11} color={p.onAccent} />}
                    </View>
                    <View style={flat || !own ? styles.bubbleColumnOther : styles.bubbleColumnOwn}>
                      <View style={bubbleStyle}>{body}</View>
                    </View>
                  </Pressable>
                );
              }

              return (
                <View key={message.id} style={rowStyle}>
                  {/*
                    The control sits in the free space beside the bubble —
                    left of your own, right of everyone else's — so it never
                    pushes a message off its own edge. The FLAT layout does
                    not carry it (product owner): the footer's "Create agent
                    task" is the visible way in, long-press the shortcut,
                    and the rows stay clean reading surface.
                  */}
                  {onMake && !flat ? (
                    <Pressable
                      onPress={() => onMake(message.id)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Make an agent task from ${message.authorName}'s message`}
                      style={({ pressed }) => [styles.makeBtn, pressed && styles.pressed]}
                      testID={`${testIDPrefix}-make-${index}`}
                    >
                      <AnnoKitIcon name="agent" size={13} color={taskAccent} />
                    </Pressable>
                  ) : null}
                  <View style={flat || !own ? styles.bubbleColumnOther : styles.bubbleColumnOwn}>
                    {onLongPress ? (
                      <Pressable
                        onLongPress={() => onLongPress(message.id)}
                        delayLongPress={350}
                        // TEXT, not a button: this is the message itself,
                        // and long-press is a shortcut into the quote flow
                        // rather than the row's purpose. Announcing it as a
                        // button would promise a tap action there isn't one.
                        // The hint is how the gesture becomes discoverable.
                        accessibilityRole="text"
                        accessibilityHint="Long press to quote this message in an agent task"
                        accessibilityLabel={`${message.authorName}: ${message.content}`}
                        testID={`${testIDPrefix}-${index}`}
                        style={({ pressed }) => [...bubbleStyle, pressed && styles.pressed]}
                      >
                        {body}
                      </Pressable>
                    ) : (
                      <View
                        testID={`${testIDPrefix}-${index}`}
                        accessibilityLabel={`${message.authorName}: ${message.content}`}
                        style={bubbleStyle}
                      >
                        {body}
                      </View>
                    )}
                    {/* Flat layout: the mark already rode the header. */}
                    {!!mark && !flat && (
                      <TaskMark
                        mark={mark}
                        accent={taskAccent ?? p.agentText}
                        onOpen={onOpenTask}
                        testID={`${testIDPrefix}-task-${index}`}
                      />
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * THE MARK ON A BUBBLE THAT BECAME A TASK.
 *
 * This is what replaced "already with the agent". That old label was a
 * refusal; this is a pointer — a small blue chip under the message,
 * carrying the agent's own mark, that OPENS the task it produced. When the
 * task cannot be resolved (older data, a server that did not keep the link,
 * a task already sent) the same chip is drawn as plain text: it still tells
 * the truth about what happened, it just does not pretend to be a button.
 */
function TaskMark({
  mark,
  accent,
  onOpen,
  testID,
  inHeader = false,
}: {
  mark: MessageTaskMark;
  accent: string;
  onOpen?: (annotationId: string) => void;
  testID: string;
  /** Riding the name · time line rather than sitting under a message. */
  inHeader?: boolean;
}) {
  const styles = useStyles();
  const inner = (
    <>
      <AnnoKitIcon name="agent" size={10} color={accent} />
      <Text style={[styles.markText, { color: accent }]}>{MESSAGE_TASK_MARK_LABEL}</Text>
    </>
  );
  const base = [styles.mark, inHeader && styles.markInHeader];
  if (!mark.openable || !onOpen) {
    return (
      <View style={base} testID={testID} accessibilityLabel={messageTaskMarkLabel(mark)}>
        {inner}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onOpen(mark.annotationId)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={messageTaskMarkLabel(mark)}
      testID={testID}
      style={({ pressed }) => [...base, styles.markOpenable, pressed && styles.pressed]}
    >
      {inner}
    </Pressable>
  );
}

/**
 * Who is speaking, once per turn.
 *
 * In the CHAT layout your own turns carry no name — you know, and your side
 * of the thread says it — so they show only the time. In the flat COMMENTS
 * layout there are no sides, so every turn gets the full avatar + name +
 * time line, yours included; "· " joins name and time the way an
 * annotation header reads.
 */
function GroupHeader({
  group,
  accent,
  flat = false,
  trailing,
}: {
  group: ChatGroup;
  accent: string;
  flat?: boolean;
  /** Metadata after the time — the flat layout's task marks live here. */
  trailing?: ReactNode;
}) {
  const styles = useStyles();
  const time = formatChatTime(group.at);
  if (!flat && group.side === "own") {
    return time ? <Text style={[styles.time, styles.timeOwn]}>{time}</Text> : null;
  }
  return (
    <View style={[styles.header, flat && styles.headerFlat]}>
      <Avatar group={group} accent={accent} />
      <Text
        style={[
          styles.author,
          flat && styles.authorFlat,
          group.side === "agent" && { color: accent },
        ]}
        numberOfLines={1}
      >
        {group.authorName}
      </Text>
      {!!time && <Text style={styles.time}>{flat ? `· ${time}` : time}</Text>}
      {/* Pinned to the row's far edge — metadata, out of the text's way. */}
      {trailing ? <View style={styles.headerTrailing}>{trailing}</View> : null}
    </View>
  );
}

/**
 * The server's avatar when it sent one, initials otherwise — and for the
 * agent, its own mark. THE AGENT MUST NOT LOOK LIKE A TEAMMATE: a letter in
 * a circle is exactly what a person gets, so it is drawn as a rounded
 * square in the accent colour carrying the agent mark, which is the difference
 * a reader sees before reading a word.
 */
function Avatar({ group, accent }: { group: ChatGroup; accent: string }) {
  const styles = useStyles();
  if (group.side === "agent") {
    return (
      <View
        style={[styles.avatar, styles.avatarAgent, { borderColor: accent }]}
        accessibilityLabel="The agent"
      >
        <AnnoKitIcon name="agent" size={13} color={accent} />
      </View>
    );
  }
  if (group.avatarUrl) {
    return <Image source={{ uri: group.avatarUrl }} style={styles.avatar} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarText}>{chatInitial(group.authorName)}</Text>
    </View>
  );
}

const AVATAR = 24;
/** Bubbles line up under the name, not under the avatar. */
const INDENT = AVATAR + 8;

const useStyles = themedStyles((p) => ({
  list: {
    paddingBottom: 4,
  },
  empty: {
    color: p.textFaint,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 22,
  },
  /** The rhythm: this gap BETWEEN turns is what makes bursts read as one. */
  group: {
    marginTop: 18,
  },
  firstGroup: {
    marginTop: 6,
  },
  groupOwn: {
    alignItems: "flex-end",
  },
  groupOther: {
    alignItems: "flex-start",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 5,
    maxWidth: "92%",
  },
  /** Flat rows span the sheet, so the header takes the full width too. */
  headerFlat: {
    maxWidth: "100%",
    alignSelf: "stretch",
  },
  /** Whatever rides the header sits on its far edge. */
  headerTrailing: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
  },
  avatarFallback: {
    backgroundColor: p.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarAgent: {
    // Square-ish and outlined, where a person is a filled circle.
    borderRadius: 7,
    borderWidth: 1,
    backgroundColor: p.card,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: p.textBody,
    fontSize: 11,
    fontWeight: "700",
  },
  author: {
    color: p.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    flexShrink: 1,
  },
  time: {
    color: p.textFaint,
    fontSize: 10,
  },
  timeOwn: {
    marginBottom: 5,
  },
  bubblesOwn: {
    alignItems: "flex-end",
    maxWidth: "80%",
  },
  bubblesOther: {
    alignItems: "flex-start",
    maxWidth: "80%",
    marginLeft: INDENT,
  },
  /** Flat comments: full width under the header, no side to lean to. */
  bubblesFlat: {
    alignItems: "stretch",
    alignSelf: "stretch",
    marginLeft: INDENT,
  },
  /** Bubble + its controls. The controls take the free side. */
  messageRow: {
    alignItems: "center",
    gap: 8,
  },
  messageRowOwn: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  /** Reversed, so the same JSX puts the controls on the other free side. */
  messageRowOther: {
    flexDirection: "row-reverse",
    justifyContent: "flex-end",
  },
  bubbleColumnOwn: {
    alignItems: "flex-end",
    flexShrink: 1,
  },
  bubbleColumnOther: {
    alignItems: "flex-start",
    flexShrink: 1,
  },
  /** Quiet until wanted: an outlined dot, not a second Send button. */
  makeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: p.agentBorderMid,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: p.control,
    alignItems: "center",
    justifyContent: "center",
  },
  mark: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  /** On the header line the chip sits in the text's rhythm, not below it. */
  markInHeader: {
    marginTop: 0,
    flexShrink: 0,
  },
  markOpenable: {
    backgroundColor: p.agentTintSoft,
  },
  markText: {
    fontSize: 10,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.65,
  },
  bubble: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  /** Tight inside a turn — these lines were typed in one breath. */
  bubbleStacked: {
    marginTop: 3,
  },
  /**
   * Only the turn's LAST bubble drops its inner corner — that corner is the
   * tail, and a tail on every bubble of a burst says three turns again.
   */
  tailOwn: {
    borderBottomRightRadius: 6,
  },
  tailOther: {
    borderBottomLeftRadius: 6,
  },
  text: {
    color: p.textBody,
    fontSize: 14,
    lineHeight: 19,
  },
  /** Flat comments: the sheet is the surface, so the message is just text. */
  flatMessage: {
    paddingVertical: 1,
    flexShrink: 1,
  },
  /** Flat headers carry the name at reading weight, like the mock's. */
  authorFlat: {
    color: p.textStrong,
    fontSize: 13,
  },
}));
