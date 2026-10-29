/**
 * The queue panel: the agent's pending tasks
 * (GET {endpoint}/sessions/{sid}/pending) with "Send to the agent"
 * underneath.
 *
 * TASKS ONLY. This panel briefly listed team notes alongside tasks, badged by
 * destination. The owner's refinement: the queue IS the send-to-the-agent
 * workflow, and everything it offers — tick, send, delete — only ever applied
 * to the tasks. A note in here was a row you could not act on, in a list whose
 * button ignored it. So the note rows are gone, and with them the per-row
 * destination badge (every row is a task now; a badge that never varies is
 * noise) and the "no checkbox, here's why" special case. Team notes have their
 * own toolbar entry — src/notes.tsx — plus their markers and detail pane.
 *
 * The row vocabulary is still `src/queue-list.ts`, pure and tested; the mixed
 * builders there stay exported for whatever wants them next.
 *
 * Send → POST {endpoint}/annotations/send with { annotationIds } (an empty
 * array means "address all pending", the server-side convention — which is
 * why the button always names the count it is about to hand over).
 *
 * Tapping a row opens its detail (src/thread-view.tsx); the checkbox — not
 * the row — is what toggles send-selection, so browsing never silently
 * changes what Send would hand over.
 *
 * DONE, THE OTHER TAB. A task the agent has finished leaves the pending
 * list, and with it the app: no row, no marker. The Done tab reads the
 * session's tasks (`GET /sessions/:sid`) and lists the finished ones, most
 * recent first, each with how its last run went (src/runs.ts); tapping one
 * opens the same detail pane, where its run history sits above the thread.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { serverFlavor } from "./agentation";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import { AnnoKitIcon } from "./icon";
import { taskOriginA11yLabel } from "./message-task";
import {
  buildTaskRows,
  queueEmptyText,
  queueTitle,
  sendLabel,
  sendableIds,
  tickedIds,
} from "./queue-list";
import { AnnoKitThreadView } from "./thread-view";
import { formatChatTime } from "./chat";
import { onAnnoKitEvent } from "./events";
import { doneRow, doneTasks } from "./runs";
import { sessionPath } from "./url";
import { postAccepted, type AnnoKitTransport } from "./transport";
import type { ServerAnnotation } from "./types";

interface Props {
  transport: AnnoKitTransport;
  annotations: ServerAnnotation[];
  /** An agent already has a task: a second one may not start (queue-list.ts). */
  agentBusy?: boolean;
  onRefresh: () => void;
  onDelete: (id: string) => void;
  /**
   * Open the team note a task came from. Omitted and the origin line is
   * still shown, just not tappable — the fact is worth stating either way.
   */
  onOpenNote?: (commentId: string) => void;
  /**
   * The ids the server just took (empty = "all pending", the send route's
   * own convention). Present only when the session preference asks for the
   * queue to be cleared after a send — src/prefs.ts.
   */
  onSent?: (annotationIds: readonly string[]) => void;
  /**
   * The session, for the Done tab's read of every task in it. Absent (an
   * agentation server has no such route): no Done tab.
   */
  sessionId?: string;
  onClose: () => void;
}

export function AnnoKitQueue({
  transport,
  annotations,
  agentBusy,
  onRefresh,
  onDelete,
  onOpenNote,
  onSent,
  sessionId,
  onClose,
}: Props) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  /** Held back from Send. Opt-out: every task starts ticked (src/queue-list.ts). */
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  /**
   * The task whose detail is open — held as the OBJECT, not an id looked up
   * in `annotations`.
   *
   * The list is this session's PENDING tasks, and the whole point of the
   * detail pane is that you can keep talking to the agent about a task it
   * has finished with: the moment the agent resolves it, it leaves this list.
   * Deriving the open pane from the list meant the pane vanished mid-sentence
   * exactly when the conversation mattered most. The pane re-reads
   * `GET /annotations/:aid` itself and closes on its own terms.
   */
  const [openTask, setOpenTask] = useState<ServerAnnotation | null>(null);
  const [tab, setTab] = useState<"queue" | "done">("queue");
  /** The finished tasks; null until read. */
  const [done, setDone] = useState<ServerAnnotation[] | null>(null);
  const loadDone = useCallback(() => {
    if (!sessionId) return;
    void transport
      .getJson<{ annotations?: ServerAnnotation[] }>(sessionPath(sessionId))
      .then((session) => {
        if (session) setDone(doneTasks(Array.isArray(session.annotations) ? session.annotations : []));
      });
  }, [transport, sessionId]);
  // Read when the tab is shown, and again whenever the server says
  // something moved — a run finishing is exactly what lands a task here.
  useEffect(() => {
    if (tab !== "done") return;
    loadDone();
    return onAnnoKitEvent(loadDone);
  }, [tab, loadDone]);

  const rows = buildTaskRows(annotations, p);
  const selected = new Set(tickedIds(rows, unticked));
  const send = sendLabel({ rows, selected, sending, agentBusy });

  useEffect(() => {
    onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string) => {
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Deletion is owned by the provider (it holds the pending list, so the
  // marker disappears with the row); the panel only forgets the row's tick.
  const remove = (id: string) => {
    setUnticked((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    onDelete(id);
  };

  const sendToAgent = async () => {
    if (!send.enabled) return;
    setSending(true);
    // Exactly what is ticked — never [], which the route reads as "all
    // pending" and would hand over a task someone added since this drew.
    const ids = sendableIds(rows, selected);
    // agentation compat: there is no handover — a pending annotation is
    // already live to `agentation_watch_annotations` the moment it was
    // posted, and no /annotations/send route exists. The button keeps its
    // meaning ("the agent has these") by succeeding without a request.
    const sent =
      serverFlavor() === "agentation"
        ? true
        : (await postAccepted(transport, "/annotations/send", { annotationIds: ids })).ok;
    setSending(false);
    if (sent) {
      setUnticked(new Set());
      onSent?.(ids);
      onRefresh();
      onClose();
    }
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          // Tap-outside to dismiss; a screen reader uses Done instead.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={styles.panel} testID="annokit-queue">
          <View style={styles.header}>
            {sessionId ? (
              <View style={styles.tabs} accessibilityRole="tablist">
                {(["queue", "done"] as const).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setTab(t)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: tab === t }}
                    accessibilityLabel={t === "queue" ? "Queue: tasks waiting to be sent" : "Done: tasks the agent has finished"}
                    style={[styles.tab, tab === t && styles.tabActive]}
                    testID={`annokit-queue-tab-${t}`}
                  >
                    <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                      {t === "queue" ? `Queue${rows.length ? ` ${rows.length}` : ""}` : "Done"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.headerTitle}>{queueTitle(rows)}</Text>
            )}
            <Pressable
              onPress={onClose}
              hitSlop={8}
              testID="annokit-queue-close"
              accessibilityRole="button"
              // A close, not "Done": the panel commits nothing on the way
              // out, and Done read as if it would send what was ticked.
              accessibilityLabel="Close the agent queue"
            >
              <AnnoKitIcon name="close" size={18} color={p.textMuted} />
            </Pressable>
          </View>
          {tab === "done" ? (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent} testID="annokit-done">
              {done === null ? (
                <Text style={styles.empty}>Loading…</Text>
              ) : done.length === 0 ? (
                <Text style={styles.empty} testID="annokit-done-empty">
                  Nothing finished yet. Tasks the agent has worked on show here, with how each run went.
                </Text>
              ) : (
                done.map((task, i) => {
                  const row = doneRow(task);
                  const toneColor = { ok: p.online, busy: p.agentText, bad: p.danger, muted: p.textMuted }[row.tone];
                  return (
                    <Pressable
                      key={row.id}
                      onPress={() => setOpenTask(task)}
                      style={({ pressed }) => [styles.item, pressed && styles.itemSelected]}
                      testID={`annokit-done-item-${i}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Open finished task: ${row.text}.${row.request ? ` Asked: ${row.request}.` : ""} ${row.who ? `${row.who}, ` : ""}${row.how}`}
                    >
                      <View style={[styles.doneDot, { backgroundColor: toneColor }]} />
                      <View style={styles.itemBody}>
                        <Text style={[styles.itemText, !!row.request && styles.doneTitle]} numberOfLines={2}>
                          {row.text}
                        </Text>
                        {/* With a title, the request is one tap away in the detail, not repeated here. */}
                        {!!row.who && (
                          <Text style={styles.itemMeta} numberOfLines={1}>
                            {row.who}
                          </Text>
                        )}
                        <Text style={[styles.itemMeta, { color: toneColor }]} numberOfLines={1}>
                          {row.how}
                          {row.runCount ? ` · ${row.runCount} runs` : ""}
                        </Text>
                      </View>
                      {!!row.at && <Text style={styles.doneWhen}>{formatChatTime(row.at)}</Text>}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          ) : (
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {rows.length === 0 && (
              <Text style={styles.empty} testID="annokit-queue-empty">
                {queueEmptyText("agent")}
              </Text>
            )}
            {rows.map((row, i) => {
              const checked = selected.has(row.id);
              return (
                <Pressable
                  key={row.id}
                  onPress={() => setOpenTask(annotations.find((a) => a.id === row.id) ?? null)}
                  style={[styles.item, (checked || row.working) && styles.itemSelected]}
                  testID={`annokit-queue-item-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Open agent task: ${row.text}`}
                >
                  {row.selectable ? (
                    <Pressable
                      onPress={() => toggle(row.id)}
                      hitSlop={10}
                      accessibilityRole="checkbox"
                      // Ticking chooses a SUBSET to send; the row itself opens
                      // the task. Different actions, so different semantics.
                      accessibilityState={{ checked }}
                      accessibilityLabel={`Select agent task: ${row.text}`}
                      style={[styles.checkbox, checked && styles.checkboxChecked]}
                      testID={`annokit-queue-select-${i}`}
                    >
                      {checked && <AnnoKitIcon name="check" size={12} color={p.onAccent} />}
                    </Pressable>
                  ) : (
                    // The agent already has it: nothing to tick, and the
                    // space says whose it is instead of sitting empty.
                    <View style={styles.checkboxSlot} testID={`annokit-queue-working-${i}`}>
                      <AnnoKitIcon name="agent" size={14} color={p.agentText} />
                    </View>
                  )}
                  <View style={styles.itemBody}>
                    {/*
                      THE TWO ROWS THAT SAY SOMETHING. Most rows are waiting
                      to be sent — that is what the panel IS — so only two
                      kinds carry a word: the one the agent is WORKING on,
                      and one it finished that a reply REOPENED. Without the
                      second, "I answered the agent's question" and "I have
                      not sent this yet" look identical.
                    */}
                    {!!row.status && (
                      <View
                        style={styles.reopened}
                        accessibilityLabel={
                          row.working
                            ? "The agent is working on this task"
                            : `${row.status} by a reply — waiting to be sent again`
                        }
                        testID={`annokit-queue-${row.working ? "status-working" : "reopened"}-${i}`}
                      >
                        <AnnoKitIcon name="agent" size={10} color={p.agentText} />
                        <Text style={styles.reopenedText}>{row.status}</Text>
                      </View>
                    )}
                    <Text style={styles.itemText} numberOfLines={2}>
                      {row.text}
                    </Text>
                    {!!row.meta && (
                      <Text style={styles.itemMeta} numberOfLines={1}>
                        {row.meta}
                      </Text>
                    )}
                    {!!row.progress && (
                      <Text style={styles.itemProgress} numberOfLines={1} testID={`annokit-queue-progress-${i}`}>
                        {row.progress}
                      </Text>
                    )}
                    {/*
                      WHERE IT CAME FROM. A task made out of a team-note
                      message says so here, and taps back to that discussion:
                      the same relationship the note's Tasks tab states from
                      the other end.
                    */}
                    {!!row.originLabel && (
                      <Pressable
                        onPress={() =>
                          row.sourceCommentId && onOpenNote?.(row.sourceCommentId)
                        }
                        disabled={!onOpenNote || !row.sourceCommentId}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: !onOpenNote || !row.sourceCommentId }}
                        accessibilityLabel={taskOriginA11yLabel(
                          !!onOpenNote && !!row.sourceCommentId,
                        )}
                        style={({ pressed }) => [styles.origin, pressed && styles.originPressed]}
                        testID={`annokit-queue-origin-${i}`}
                      >
                        <AnnoKitIcon name="comment" size={10} color={p.team} />
                        <Text style={styles.originText} numberOfLines={1}>
                          {onOpenNote && row.sourceCommentId
                            ? `${row.originLabel} · Open`
                            : row.originLabel}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                  <Pressable
                    onPress={() => remove(row.id)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Delete this agent task"
                    style={styles.deleteBtn}
                    testID={`annokit-queue-delete-${i}`}
                  >
                    <AnnoKitIcon name="close" size={15} color={p.textFaint} />
                  </Pressable>
                </Pressable>
              );
            })}
          </ScrollView>
          )}
          {tab === "queue" && (
          <Pressable
            onPress={sendToAgent}
            disabled={!send.enabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: !send.enabled }}
            accessibilityLabel={send.label}
            style={[styles.sendBtn, !send.enabled && styles.sendDisabled]}
            testID="annokit-queue-send"
          >
            <Text style={styles.sendText}>{send.label}</Text>
          </Pressable>
          )}
        </View>
      </View>
      {openTask && (
        <AnnoKitThreadView
          transport={transport}
          annotation={openTask}
          onDelete={remove}
          onOpenNote={
            onOpenNote
              ? (commentId) => {
                  // Leaving for the other half of the overlay: close this
                  // pane and the panel, so the note is not opened behind two
                  // sheets the user has to dismiss to get back.
                  setOpenTask(null);
                  onClose();
                  onOpenNote(commentId);
                }
              : undefined
          }
          // A reply reopened it (or the agent resolved it): the rows behind
          // this pane are stale until the list is re-read.
          onChanged={() => {
            onRefresh();
            if (tab === "done") loadDone();
          }}
          // Handed over from the detail: same ending as the bulk Send, so
          // the user is not left staring at a pane that has just been given
          // away.
          onSent={() => {
            setOpenTask(null);
            onRefresh();
            onClose();
          }}
          onClose={() => setOpenTask(null)}
        />
      )}
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
    paddingBottom: 10,
  },
  // Underlined, like the note detail's tabs (src/comment-view.tsx): the
  // tab is navigation, so it wears the ink, not a filled button.
  tabs: {
    flexDirection: "row",
    gap: 18,
  },
  tab: {
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: p.textStrong,
  },
  tabText: {
    color: p.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  tabTextActive: {
    color: p.textStrong,
  },
  doneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  doneTitle: {
    color: p.textStrong,
    fontWeight: "600",
  },
  doneWhen: {
    color: p.textFaint,
    fontSize: 11,
    marginTop: 2,
  },
  headerTitle: {
    color: p.textStrong,
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
  },
  closeText: {
    color: p.agentText,
    fontSize: 14,
    fontWeight: "600",
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
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 10,
  },
  itemSelected: {
    backgroundColor: p.agentTintSoft,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: p.control,
    marginTop: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  /** Where a working row's checkbox would be, so the text stays aligned. */
  checkboxSlot: {
    width: 18,
    height: 18,
    marginTop: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: p.agent,
    borderColor: p.agent,
  },
  checkmark: {
    color: p.onAccent,
    fontSize: 11,
    lineHeight: 13,
  },
  itemBody: {
    flex: 1,
  },
  itemText: {
    color: p.textBody,
    fontSize: 14,
    lineHeight: 19,
  },
  deleteBtn: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: {
    color: p.textFaint,
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "700",
  },
  itemMeta: {
    color: p.textFaint,
    fontSize: 11,
    marginTop: 2,
  },
  /** The agent's latest step on a working task, in the agent's colour. */
  itemProgress: {
    color: p.agentText,
    fontSize: 11,
    marginTop: 2,
  },
  /** Blue: the agent's colour, because it is the agent's turn again. */
  reopened: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginBottom: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 7,
    backgroundColor: p.agentTintMid,
  },
  reopenedText: {
    color: p.agentSoft,
    fontSize: 10,
    fontWeight: "700",
  },
  /** Orange: it points back into the team's half of the overlay. */
  origin: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 5,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 7,
    backgroundColor: p.teamTintSoft,
  },
  originPressed: {
    opacity: 0.65,
  },
  originText: {
    // teamText, not team: it is type, and type follows src/accent.ts's rule.
    color: p.teamText,
    fontSize: 10,
    fontWeight: "700",
  },
  sendBtn: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: p.agent,
    paddingVertical: 12,
    alignItems: "center",
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendText: {
    color: p.onAccent,
    fontSize: 14,
    fontWeight: "700",
  },
}));
