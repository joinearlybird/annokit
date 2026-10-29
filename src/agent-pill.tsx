/**
 * THE AGENT PILL — in the composer, under the input, beside the attach
 * row: which agent and model the task being written will run on, and a
 * short menu to change it.
 *
 * It replaced the toolbar's Agent item. Choosing an agent is part of
 * writing a task, not of configuring the overlay, so it sits where the task
 * is written and applies per task (src/agent-config.ts, *PER TASK*).
 *
 * THE MENU IS SHORT ON PURPOSE: each connected agent's default and its
 * first few models, which is what most people switch between, and the
 * effort fixed at its bottom. Every model is in Settings → Agent, one tap
 * away on the gear.
 *
 * Green dot and the model's name when a task will reach an agent; red dot
 * and "No agent" when the server has none to run it.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import {
  agentPill,
  agentUsable,
  chooseAgentRun,
  chosenAgentRun,
  effectiveAgentRun,
  fetchAgentModels,
  subscribeToAgentRun,
  keepEffort,
  modelEfforts,
  sessionModels,
  PILL_MODELS,
  modelRowSelected,
  modelRows,
  withCached,
} from "./agent-config";
import type { AgentConfig, AgentModels, AgentTransport } from "./agent-config";
import { EffortSlider } from "./effort-slider";
import { AnnoKitIcon } from "./icon";
import { themedStyles, useAnnoKitTheme } from "./theme-context";

/** The session's model lists (src/agent-config.ts), also read when a task is sent. */
const seen = sessionModels;

function useModels(transport: AgentTransport, ids: string[]): Record<string, AgentModels | undefined> {
  const [models, setModels] = useState<Record<string, AgentModels | undefined>>(() =>
    Object.fromEntries(ids.map((id) => [id, seen.get(id)])),
  );
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    for (const id of ids) {
      if (seen.get(id)?.ok) continue;
      void fetchAgentModels(transport, id).then((m) => {
        if (m.ok) seen.set(id, m);
        if (live) setModels((prev) => ({ ...prev, [id]: m }));
      });
    }
    return () => {
      live = false;
    };
    // `key` stands for `ids`, which is a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, key]);
  return withCached(ids, models, seen);
}

export function AgentPill({
  config,
  transport,
  onOpenSettings,
}: {
  config: AgentConfig;
  transport: AgentTransport;
  /** The gear: Settings → Agent. Absent: no gear. */
  onOpenSettings?: () => void;
}) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const run = useSyncExternalStore(subscribeToAgentRun, chosenAgentRun, chosenAgentRun);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null);
  const pill = useRef<View | null>(null);
  const win = useWindowDimensions();

  // Connected agents get their models; installed ones that are not signed
  // in are listed by name with a red dot, and never asked for models —
  // there is nothing they could run.
  const usable = config.enabled ? config.agents.filter(agentUsable) : [];
  const signedOut = config.enabled ? config.agents.filter((a) => a.installed && !agentUsable(a)) : [];
  const effective = effectiveAgentRun(config, run);
  // Closed, only the agent in use is asked about (for its default's name);
  // open, every connected one is.
  const models = useModels(transport, open ? usable.map((a) => a.id) : effective ? [effective.agent] : []);
  const state = agentPill(config, run, models);
  const chosenList = effective ? models[effective.agent] : undefined;
  const { efforts, defaultEffort } = modelEfforts(chosenList, effective?.model ?? null);

  const show = () => {
    const node = pill.current as unknown as {
      measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
    } | null;
    if (node?.measureInWindow) {
      node.measureInWindow((x, y, w) => {
        setAnchor({ right: Math.max(8, win.width - (x + w)), bottom: Math.max(8, win.height - y + 6) });
        setOpen(true);
      });
    } else {
      setAnchor(null);
      setOpen(true);
    }
  };

  return (
    <>
      <Pressable
        ref={pill}
        onPress={show}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={
          state.connected
            ? `Agent for this task: ${state.agentLabel}, ${state.label}. Change it`
            : "No agent connected. See the agents"
        }
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
        testID="annokit-agent-pill"
      >
        <View style={[styles.dot, { backgroundColor: state.connected ? p.online : p.danger }]} />
        <Text style={styles.pillText} numberOfLines={1}>
          {state.label}
        </Text>
        <AnnoKitIcon name="chevron" size={11} color={p.textMuted} />
      </Pressable>
      {open && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setOpen(false)}>
          <Pressable
            style={styles.backdrop}
            onPress={() => setOpen(false)}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <View
            style={[
              styles.menu,
              anchor ? { right: anchor.right, bottom: anchor.bottom } : styles.menuCentred,
              { maxHeight: Math.min(420, (anchor ? win.height - anchor.bottom : win.height) - 60) },
            ]}
            testID="annokit-agent-menu"
          >
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Agent for this task</Text>
              {onOpenSettings ? (
                <Pressable
                  onPress={() => {
                    setOpen(false);
                    // After the menu has gone: iOS presents nothing while
                    // a sheet is still on its way out.
                    setTimeout(onOpenSettings, 350);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="All models and settings for the agent"
                  testID="annokit-agent-menu-settings"
                >
                  <AnnoKitIcon name="gear" size={16} color={p.textMuted} />
                </Pressable>
              ) : null}
            </View>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.menuContent}>
              {usable.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No provider connected</Text>
                  <Text style={styles.meta}>
                    {!config.enabled
                      ? "The server's agent is turned off."
                      : signedOut.length > 0
                        ? "Sign in to one of these in a terminal on the machine running the server."
                        : config.error ?? "No agent is installed on the machine running the server."}
                  </Text>
                </View>
              ) : (
                usable.map((a) => {
                  const list = models[a.id];
                  const rows = modelRows(list, PILL_MODELS);
                  return (
                    <View key={a.id} style={styles.group}>
                      <Text style={styles.groupLabel}>{a.label}</Text>
                      {rows.map((m) => {
                        const selected = effective?.agent === a.id && modelRowSelected(m, effective.model);
                        return (
                          <Pressable
                            key={m.key}
                            onPress={() => {
                              chooseAgentRun({
                                agent: a.id,
                                model: m.value,
                                // Effort belongs to a model: kept only where the new one takes it.
                                effort: effective?.agent === a.id ? keepEffort(list, m.value, effective.effort) : null,
                                ...(m.value ? { modelLabel: m.label } : {}),
                              });
                              setOpen(false);
                            }}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            accessibilityLabel={`${a.label}, ${m.label}${m.isDefault ? ", default" : ""}${selected ? ", selected" : ""}`}
                            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                            testID={`annokit-agent-menu-${a.id}-${m.isDefault ? "default" : m.key}`}
                          >
                            <Text style={[styles.rowText, selected && styles.rowTextSelected]} numberOfLines={1}>
                              {m.label}
                            </Text>
                            {m.isDefault && <Text style={styles.defaultTag}>Default</Text>}
                            {selected && <AnnoKitIcon name="check" size={13} color={p.agentText} />}
                          </Pressable>
                        );
                      })}
                      {list && !list.ok && <Text style={styles.meta}>{list.message}</Text>}
                    </View>
                  );
                })
              )}
              {signedOut.map((a) => (
                <View
                  key={a.id}
                  style={styles.signedOut}
                  accessible
                  accessibilityLabel={`${a.label}, not signed in`}
                  testID={`annokit-agent-menu-${a.id}-signed-out`}
                >
                  <View style={[styles.dot, { backgroundColor: p.danger }]} />
                  <Text style={styles.signedOutText} numberOfLines={1}>
                    {a.label}
                  </Text>
                </View>
              ))}
            </ScrollView>
            {/*
              Fixed below the list, not in it: the effort applies to
              whichever model is chosen above, and stays in reach however
              long the list gets.
            */}
            {effective && efforts.length > 0 ? (
              <View style={styles.footer}>
                <EffortSlider
                  efforts={efforts}
                  defaultEffort={defaultEffort}
                  value={effective.effort}
                  onChange={(effort) => chooseAgentRun({ ...effective, effort })}
                  testID="annokit-agent-menu-effort"
                />
              </View>
            ) : null}
          </View>
        </Modal>
      )}
    </>
  );
}

const useStyles = themedStyles((p) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 190,
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: p.border,
    backgroundColor: p.chip,
  },
  pillPressed: {
    backgroundColor: p.pressed,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  pillText: {
    flexShrink: 1,
    color: p.textBody,
    fontSize: 12,
    fontWeight: "600",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  menu: {
    position: "absolute",
    width: 250,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: p.border,
    backgroundColor: p.raised,
    shadowColor: p.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    overflow: "hidden",
  },
  menuCentred: {
    alignSelf: "center",
    top: "30%",
  },
  menuContent: {
    paddingVertical: 6,
  },
  group: {
    paddingVertical: 4,
  },
  groupLabel: {
    color: p.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 34,
    paddingHorizontal: 12,
  },
  rowPressed: {
    backgroundColor: p.pressed,
  },
  rowText: {
    flex: 1,
    color: p.textBody,
    fontSize: 13,
  },
  defaultTag: {
    color: p.textMuted,
    fontSize: 11,
  },
  rowTextSelected: {
    color: p.textStrong,
    fontWeight: "600",
  },
  meta: {
    color: p.textMuted,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  signedOut: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 32,
    paddingHorizontal: 12,
  },
  signedOutText: {
    flex: 1,
    color: p.textMuted,
    fontSize: 13,
  },
  empty: {
    paddingVertical: 6,
  },
  emptyTitle: {
    color: p.textStrong,
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: p.hairline,
  },
  headerTitle: {
    color: p.textStrong,
    fontSize: 13,
    fontWeight: "700",
  },
  scroll: {
    flexShrink: 1,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: p.hairline,
  },
}));
