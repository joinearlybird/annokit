/**
 * THE SETTINGS PANEL — appearance, who you are, and what this thing is
 * wired to.
 *
 * WHY THE OVERLAY HAS ONE AT ALL. The web overlay does not: its parent
 * builder page pushes an appearance in over postMessage, and its only
 * settings-ish surface is a keyboard-shortcuts list, which means nothing on
 * a touch screen. A React Native app has no parent frame to push anything,
 * so the overlay has to decide its own appearance — and the moment it can
 * decide, the user should be able to.
 *
 * THE BLOCKS, IN THE ORDER PEOPLE COME LOOKING:
 *   1. THEME. System / Light / Dark, resolved in src/theme.ts.
 *   1b. AGENT. Which agent the server runs tasks with, and on which model,
 *      when the server has the optional /agent route (src/agent-config.ts).
 *   2. MARKER COLOURS. One curated swatch row per KIND — the agent's and
 *      the team's — because the colour is what tells the two marks apart.
 *      The only rule is that they may not be the same (src/accent.ts).
 *      Then TEXT COLOUR: a curated set of text ramps, every one readable
 *      on both themes (src/text-tone.ts).
 *   3. OUTPUT DETAIL. How much context leaves the app with a task
 *      (src/payload.ts trims the body; src/prefs.ts holds the choice).
 *   4. THIS SESSION. Clear the queue after sending, and hide the overlay
 *      until the app restarts — a floating button costs more on a phone
 *      than on a desktop, and the row says how to get it back.
 *   5. YOU. The name on your team notes, editable ONLY when this device is
 *      the thing that chose it (src/settings-view.ts explains why an
 *      editable field over a server identity would be a lie).
 *   6. DIAGNOSTICS. Read-only: the package version, the negotiated protocol
 *      version, the endpoint HOST (never the token), and which optional
 *      peers resolved. For support, and for anyone implementing the
 *      protocol against this client.
 *
 * EVERY SETTING IS SESSION MEMORY. Nothing here is written to disk — no
 * storage peer for a dev overlay — so a reload returns to whatever the host
 * app passed as props. The theme block says so on screen; the rest inherit
 * the same promise.
 *
 * Rows, not cards — the same calm treatment as the queue and notes panels,
 * and for the same reason: a panel of nested boxes reads as five surfaces
 * when it is one.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import { ACCENTS, ACCENT_KEYS, accentSelectable } from "./accent";
import type { AccentKey, AccentRole } from "./accent";
import {
  OUTPUT_DETAILS,
  annoKitPreferences,
  chooseAccent,
  chooseOutputDetail,
  chooseTextTone,
  hideUntilRestart,
  outputDetailLabel,
  outputDetailSummary,
  setAgentBanner,
  setBlockSendWhileWorking,
  setClearOnSend,
  subscribeToPreferences,
} from "./prefs";
import type { OutputDetail } from "./prefs";
import { TEXT_TONES, TEXT_TONE_SPECS, textToneSwatch } from "./text-tone";
import {
  agentStatus,
  agentUsable,
  sessionModels,
  setAgentConfig,
  keepEffort,
  modelEfforts,
  chooseAgentRun,
  chosenAgentRun,
  modelRowSelected,
  modelRows,
  effectiveAgentRun,
  fetchAgentConfig,
  fetchAgentModels,
  subscribeToAgentRun,
} from "./agent-config";
import type { AgentConfig, AgentModels, AgentRun, AgentTransport } from "./agent-config";
import { onAnnoKitEvent } from "./events";
import type { TextTone } from "./text-tone";
import { PACKAGE_VERSION } from "./env";
import { negotiatedProtocolVersion } from "./handshake";
import { EffortSlider } from "./effort-slider";
import { AnnoKitIcon } from "./icon";
import { AnnoKitNamePrompt, useViewerIdentity } from "./name-prompt";
import { screenshotsAvailable } from "./screenshot";
import {
  diagnosticsRows,
  identityActionLabel,
  identityView,
  settingsPageTitle,
  settingsRootRows,
} from "./settings-view";
import type { SettingsPage } from "./settings-view";
import { shakeAvailable } from "./shake";
import { svgAvailable } from "./svg";
import { THEME_PREFERENCES, themeOptionAccessibilityLabel, themePreferenceLabel } from "./theme";
import type { ThemePreference } from "./theme";

interface Props {
  /** The endpoint, for the diagnostics block. Only its host is shown. */
  endpoint: string | null;
  /** For the server's optional /agent routes. Absent: no Agent row. */
  transport?: AgentTransport;
  /** Open on this page: the toolbar's Agent item opens on "agent". */
  initialPage?: SettingsPage;
  /** What the provider already knows of /agent, so that page is not blank while it is re-read. */
  initialAgent?: AgentConfig | null;
  onClose: () => void;
}

export function AnnoKitSettings({
  endpoint,
  transport,
  initialPage = "root",
  initialAgent = null,
  onClose,
}: Props) {
  const { palette: p, preference, system, setPreference } = useAnnoKitTheme();
  const styles = useStyles();
  const identity = useViewerIdentity();
  const prefs = useSyncExternalStore(
    subscribeToPreferences,
    annoKitPreferences,
    annoKitPreferences,
  );
  const view = identityView(identity);
  const [editingName, setEditingName] = useState(false);
  const [page, setPage] = useState<SettingsPage>(initialPage);
  // The server's agent, read when the panel opens and again whenever the
  // server says something changed (a switch from the web panel, say).
  const [agent, setAgent] = useState<AgentConfig | null>(initialAgent);
  // The per-task choice, so the Agent row's summary follows it.
  const run = useSyncExternalStore(subscribeToAgentRun, chosenAgentRun, chosenAgentRun);
  const loadAgent = useCallback(
    (refresh = false) => {
      if (!transport) return;
      void fetchAgentConfig(transport, refresh).then((c) => c && setAgent(c));
    },
    [transport],
  );
  useEffect(() => {
    loadAgent();
    return onAnnoKitEvent(() => loadAgent());
  }, [loadAgent]);
  // The header's refresh: detection on the server, and the models after.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshAgent = () => {
    if (!transport || refreshing) return;
    setRefreshing(true);
    void fetchAgentConfig(transport, true)
      .then((c) => c && setAgent(c))
      .finally(() => {
        setRefreshing(false);
        setRefreshKey((n) => n + 1);
      });
  };

  // The Agent page's models, read here rather than in the page: the effort
  // slider pinned below the list needs them too (AgentEffortFooter).
  const eff = page === "agent" ? effectiveAgentRun(agent, run) : null;
  const agentModels = useAgentModels(transport, eff?.agent ?? null, refreshKey);
  const list = useRef<ScrollView | null>(null);
  // Where the Model section starts, so choosing an agent can scroll to it.
  const modelsY = useRef(0);
  const [listHeight, setListHeight] = useState(0);

  const rows = diagnosticsRows({
    version: PACKAGE_VERSION,
    protocolVersion: negotiatedProtocolVersion(),
    endpoint,
    peers: {
      svg: svgAvailable(),
      viewShot: screenshotsAvailable(),
      sensors: shakeAvailable(),
    },
  });

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          // Tap-outside to dismiss; a screen reader uses the sheet's own
          // close control instead of an unlabelled full-screen target.
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={styles.panel} testID="annokit-settings">
          <View style={styles.header}>
            {page === "root" ? (
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle}>{settingsPageTitle("root")}</Text>
                {/* The version in the header, where the web panel keeps it —
                    the first thing anyone reporting a problem is asked for. */}
                <Text style={styles.headerVersion}>v{PACKAGE_VERSION}</Text>
              </View>
            ) : (
              /*
               * Back is a HEADER control, not a row at the bottom of the
               * page: on a sheet this tall the bottom is off-screen, and a
               * way out you have to scroll to find is not a way out.
               */
              <Pressable
                onPress={() => setPage("root")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Back to all settings"
                testID="annokit-settings-back"
                style={styles.headerTitleWrap}
              >
                <View style={styles.backChevron}>
                  <AnnoKitIcon name="chevron" size={18} color={p.agentText} />
                </View>
                <Text style={styles.headerTitle}>{settingsPageTitle(page)}</Text>
              </Pressable>
            )}
            <View style={styles.headerActions}>
              {/*
                REFRESH, on the Agent page only: look for agents again (one
                installed since the server started) and re-read the
                models. A header action rather than a link in the status
                row, where it competed with the status it was refreshing.
              */}
              {page === "agent" && agent && transport ? (
                <Pressable
                  onPress={refreshAgent}
                  disabled={refreshing}
                  hitSlop={8}
                  testID="annokit-settings-agent-refresh"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: refreshing, busy: refreshing }}
                  accessibilityLabel="Look for agents again"
                  style={refreshing ? styles.refreshing : undefined}
                >
                  <AnnoKitIcon name="refresh" size={17} color={p.textMuted} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={onClose}
                hitSlop={8}
                testID="annokit-settings-close"
                accessibilityRole="button"
                // A close, not "Done": every setting applies as it is chosen.
                accessibilityLabel="Close settings"
              >
                <AnnoKitIcon name="close" size={18} color={p.textMuted} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            ref={list}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}
          >
            {/* ── The menu ──────────────────────────────────────────── */}
            {page === "root" &&
              settingsRootRows({
                theme: preference,
                agentAccent: prefs.agentAccent,
                teamAccent: prefs.teamAccent,
                textTone: prefs.textTone,
                outputDetail: prefs.outputDetail,
                clearOnSend: prefs.clearOnSend,
                identity,
                version: PACKAGE_VERSION,
                agent,
              }).map((row) => (
                <Pressable
                  key={row.page}
                  onPress={() => setPage(row.page)}
                  accessibilityRole="button"
                  // The value belongs in the announcement too — a screen
                  // reader user should not have to open a page to hear
                  // where it stands.
                  accessibilityLabel={`${row.title}. ${row.summary}`}
                  testID={`annokit-settings-menu-${row.page}`}
                  style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.optionLabel}>{row.title}</Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {row.summary}
                    </Text>
                  </View>
                  <View style={styles.menuChevron}>
                    <AnnoKitIcon name="chevron" size={16} color={p.textFaint} />
                  </View>
                </Pressable>
              ))}

            {/* ── Theme ─────────────────────────────────────────────── */}
            {page === "appearance" && (
            <>
            <Text style={styles.sectionLabel}>Theme</Text>
            {THEME_PREFERENCES.map((option) => (
              <ThemeOption
                key={option}
                option={option}
                selected={option === preference}
                onSelect={() => setPreference(option)}
              />
            ))}
            <Text style={styles.sectionNote}>
              {/*
                Said plainly, because it is the surprising half: nothing here
                is written to disk (no storage peer for a dev overlay), and
                "System" is the only choice that keeps answering after the
                phone changes its mind.
              */}
              System follows the phone. Chosen here for this session only — a
              reload returns to the app's default.
            </Text>

            {/* ── Marker colours ────────────────────────────────────── */}
            <Text style={styles.sectionLabel}>Marker colours</Text>
            <SwatchRow
              role="agent"
              label="Agent tasks"
              selected={prefs.agentAccent}
              taken={prefs.teamAccent}
            />
            <SwatchRow
              role="team"
              label="Team notes"
              selected={prefs.teamAccent}
              taken={prefs.agentAccent}
            />
            <Text style={styles.sectionNote}>
              {/* The one rule, said once (src/accent.ts). */}
              The two marks must differ — a colour in use by the other kind
              cannot be picked.
            </Text>

            {/* ── Text colour ───────────────────────────────────────── */}
            <Text style={styles.sectionLabel}>Text colour</Text>
            <TextToneRow selected={prefs.textTone} />
            </>
            )}

            {/* ── Agent ─────────────────────────────────────────────── */}
            {page === "agent" && agent && transport && (
              <AgentPage
                transport={transport}
                config={agent}
                onServerChange={setAgent}
                models={agentModels.models}
                onRetry={agentModels.retry}
                onModelsLayout={(y) => (modelsY.current = y)}
                modelsMinHeight={listHeight}
                onAgentChosen={() =>
                  // After the page has drawn the new agent's (loading) list.
                  requestAnimationFrame(() => list.current?.scrollTo({ y: Math.max(0, modelsY.current - 6), animated: true }))
                }
              />
            )}

            {/* ── Output detail ─────────────────────────────────────── */}
            {page === "output" && (
            <>
            <Text style={styles.sectionLabel}>Output detail</Text>
            {OUTPUT_DETAILS.map((detail) => (
              <DetailOption
                key={detail}
                detail={detail}
                selected={detail === prefs.outputDetail}
                onSelect={() => chooseOutputDetail(detail)}
              />
            ))}
            </>
            )}

            {/* ── Session switches ──────────────────────────────────── */}
            {page === "session" && (
            <>
            <Text style={styles.sectionLabel}>This session</Text>
            <Pressable
              onPress={() => setClearOnSend(!prefs.clearOnSend)}
              accessibilityRole="switch"
              accessibilityState={{ checked: prefs.clearOnSend }}
              accessibilityLabel="Clear the queue after a successful send"
              testID="annokit-settings-clear-on-send"
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <View style={styles.rowBody}>
                <Text style={styles.optionLabel}>Clear queue after sending</Text>
                <Text style={styles.rowMeta}>
                  Sent tasks leave the list instead of sitting in it.
                </Text>
              </View>
              <Switch value={prefs.clearOnSend} onValueChange={setClearOnSend} style={styles.switch} />
            </Pressable>
            <Pressable
              onPress={() => setAgentBanner(!prefs.agentBanner)}
              accessibilityRole="switch"
              accessibilityState={{ checked: prefs.agentBanner }}
              accessibilityLabel="Show a banner while the agent is working"
              testID="annokit-settings-agent-banner"
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <View style={styles.rowBody}>
                <Text style={styles.optionLabel}>Show agent activity</Text>
                <Text style={styles.rowMeta}>
                  A bar at the top while a task is being worked on. Only ever
                  appears when the server says so.
                </Text>
              </View>
              <Switch value={prefs.agentBanner} onValueChange={setAgentBanner} style={styles.switch} />
            </Pressable>
            <Pressable
              onPress={() => setBlockSendWhileWorking(!prefs.blockSendWhileWorking)}
              accessibilityRole="switch"
              accessibilityState={{ checked: prefs.blockSendWhileWorking }}
              accessibilityLabel="Wait for the agent to finish before sending another task"
              testID="annokit-settings-block-send"
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <View style={styles.rowBody}>
                <Text style={styles.optionLabel}>One task at a time</Text>
                <Text style={styles.rowMeta}>
                  Send waits while the agent is working. Turn off if your
                  server runs tasks in parallel or queues them itself.
                </Text>
              </View>
              <Switch
                value={prefs.blockSendWhileWorking}
                onValueChange={setBlockSendWhileWorking}
                style={styles.switch}
              />
            </Pressable>
            <Pressable
              onPress={() => {
                // Closing first is not cosmetic: this unmounts the overlay,
                // and a modal whose owner has gone is a modal nobody can
                // dismiss.
                onClose();
                hideUntilRestart();
              }}
              accessibilityRole="button"
              accessibilityLabel="Hide the overlay until you restart the app"
              testID="annokit-settings-hide"
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <View style={styles.rowBody}>
                <Text style={styles.optionLabel}>Hide the overlay</Text>
                {/* The way back is the whole reason this line exists. */}
                <Text style={styles.rowMeta}>Until you restart the app.</Text>
              </View>
              <Text style={styles.rowAction}>Hide</Text>
            </Pressable>
            </>
            )}

            {/* ── Identity ──────────────────────────────────────────── */}
            {page === "you" && (
            <>
            <Text style={styles.sectionLabel}>You</Text>
            {editingName ? (
              <AnnoKitNamePrompt
                accent={p.agent}
                initial={identity.name}
                onConfirm={() => setEditingName(false)}
                onCancel={() => setEditingName(false)}
                testID="annokit-settings-name"
              />
            ) : (
              <View style={styles.row}>
                <View style={styles.rowBody}>
                  <Text
                    style={[styles.rowValue, !view.hasName && styles.rowValueEmpty]}
                    numberOfLines={1}
                    testID="annokit-settings-identity"
                  >
                    {view.name}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {view.sourceLabel}
                  </Text>
                </View>
                {view.editable && (
                  <Pressable
                    onPress={() => setEditingName(true)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Change the name your team notes are posted under"
                    testID="annokit-settings-name-edit"
                  >
                    <Text style={styles.rowAction}>{identityActionLabel(identity)}</Text>
                  </Pressable>
                )}
              </View>
            )}
            {!!view.readOnlyNote && (
              <Text style={styles.sectionNote} testID="annokit-settings-identity-note">
                {view.readOnlyNote}
              </Text>
            )}
            </>
            )}

            {/* ── Diagnostics ───────────────────────────────────────── */}
            {page === "about" && (
            <>
            <Text style={styles.sectionLabel}>Diagnostics</Text>
            {rows.map((row) => (
              <View key={row.key} style={styles.factRow} testID={`annokit-settings-${row.key}`}>
                <Text style={styles.factLabel} numberOfLines={1}>
                  {row.label}
                </Text>
                <Text style={styles.factValue} numberOfLines={1}>
                  {row.value}
                </Text>
              </View>
            ))}
            </>
            )}
          </ScrollView>
          {/*
            EFFORT, PINNED: it applies to whichever model is chosen above,
            so it stays in reach however far that list scrolls.
          */}
          {page === "agent" && eff && agent?.perTask ? (
            <AgentEffortFooter config={agent!} models={agentModels.models} />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/**
 * One theme choice. A row, a tick, and the selected state said BOTH ways —
 * `accessibilityState` for the structured answer and in the label's words
 * for the announcement (src/theme.ts).
 */
function ThemeOption({
  option,
  selected,
  onSelect,
}: {
  option: ThemePreference;
  selected: boolean;
  onSelect: () => void;
}) {
  const { palette: p, system } = useAnnoKitTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={themeOptionAccessibilityLabel(option, selected, system)}
      testID={`annokit-settings-theme-${option}`}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
      ]}
    >
      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
        {themePreferenceLabel(option)}
      </Text>
      {selected && <AnnoKitIcon name="check" size={14} color={p.agentText} />}
    </Pressable>
  );
}

/**
 * One kind's colour, as a row of swatches drawn in the mark's own shape —
 * a circle for the agent's, a rounded square for the team's, exactly as
 * src/markers.tsx draws them. A swatch already taken by the other kind is
 * shown struck out and refuses the tap (src/accent.ts).
 */
function SwatchRow({
  role,
  label,
  selected,
  taken,
}: {
  role: AccentRole;
  label: string;
  selected: AccentKey;
  taken: AccentKey;
}) {
  const { theme } = useAnnoKitTheme();
  const styles = useStyles();
  return (
    <View style={styles.swatchRow} testID={`annokit-settings-accent-${role}`}>
      <Text style={styles.swatchLabel}>{label}</Text>
      <View style={styles.swatches}>
        {ACCENT_KEYS.map((key) => {
          const enabled = accentSelectable(key, taken);
          const chosen = key === selected;
          return (
            <Pressable
              key={key}
              disabled={!enabled}
              onPress={() => chooseAccent(role, key)}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen, disabled: !enabled }}
              accessibilityLabel={`${ACCENTS[key].label} for ${label.toLowerCase()}${
                chosen ? ", selected" : enabled ? "" : ", already used by the other kind"
              }`}
              testID={`annokit-settings-accent-${role}-${key}`}
              style={[
                styles.swatchHit,
                // The ring goes AROUND the swatch, in the sheet's own ink:
                // a ring drawn in the hue's own tone sat on top of the hue
                // and read as nothing at 24pt.
                chosen && styles.swatchHitChosen,
                !enabled && styles.swatchDisabled,
              ]}
            >
              <View
                style={[
                  styles.swatch,
                  role === "agent" ? styles.swatchCircle : styles.swatchSquare,
                  { backgroundColor: ACCENTS[key][theme].fill },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * The text colour, as a swatch row like the marker colours above it. Each
 * swatch is filled with its tone's muted step (src/text-tone.ts says why
 * that step), and the row's label is the chosen tone's name, drawn in that
 * tone's body step — so the choice previews itself without a list of rows.
 */
function TextToneRow({ selected }: { selected: TextTone }) {
  const { theme } = useAnnoKitTheme();
  const styles = useStyles();
  const chosenSpec = TEXT_TONE_SPECS[selected];
  return (
    <View style={styles.swatchRow} testID="annokit-settings-text">
      <Text style={[styles.swatchLabel, { color: chosenSpec[theme].textBody }]}>{chosenSpec.label}</Text>
      <View style={styles.swatches}>
        {TEXT_TONES.map((tone) => {
          const chosen = tone === selected;
          return (
            <Pressable
              key={tone}
              onPress={() => chooseTextTone(tone)}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen }}
              accessibilityLabel={`${TEXT_TONE_SPECS[tone].label} text colour${chosen ? ", selected" : ""}`}
              testID={`annokit-settings-text-${tone}`}
              style={[styles.swatchHit, chosen && styles.swatchHitChosen]}
            >
              <View style={[styles.swatch, styles.swatchCircle, { backgroundColor: textToneSwatch(tone, theme) }]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * SETTINGS → AGENT. Where the agent stands, which one runs tasks, and on
 * which model — all of it the server's (src/agent-config.ts); this page
 * shows it and asks for changes.
 *
 * Agents that are not installed are listed, disabled, rather than hidden:
 * "Gemini CLI — not installed" answers the question someone opened this
 * page with. Models are asked for only when the page is open, because the
 * server has to start the agent's CLI to list them.
 */
/**
 * The chosen agent's models, read when the agent changes and on the
 * header's refresh. Null while loading.
 */
function useAgentModels(
  transport: AgentTransport | undefined,
  agentId: string | null,
  refreshKey: number,
): { models: AgentModels | null; retry: () => void } {
  const [models, setModels] = useState<AgentModels | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The header's refresh asks the CLI itself again, past the server's cache.
  const lastRefresh = useRef(refreshKey);
  useEffect(() => {
    if (!transport || !agentId) return;
    const fresh = lastRefresh.current !== refreshKey;
    lastRefresh.current = refreshKey;
    let live = true;
    setModels(null);
    void fetchAgentModels(transport, agentId, fresh).then((m) => {
      // What the pill reads too, so it shows the same list.
      if (m.ok) sessionModels.set(agentId, m);
      if (live) setModels(m);
    });
    return () => {
      live = false;
    };
  }, [transport, agentId, attempt, refreshKey]);
  return { models, retry: () => setAttempt((n) => n + 1) };
}

/**
 * SETTINGS → AGENT, top to bottom in the order the choice is made: where
 * things stand, which agent, which of its models. Choosing an agent scrolls
 * to its models — the next thing to pick — and the effort is pinned below
 * the list (AgentEffortFooter).
 */
function AgentPage({
  transport,
  config,
  onServerChange,
  models,
  onRetry,
  onModelsLayout,
  onAgentChosen,
  modelsMinHeight,
}: {
  transport: AgentTransport;
  config: AgentConfig;
  /** A server without per-task runs answered a switch with its new state. */
  onServerChange: (config: AgentConfig) => void;
  models: AgentModels | null;
  onRetry: () => void;
  /** Where the Model section starts in the list. */
  onModelsLayout: (y: number) => void;
  /** An agent was tapped: the sheet scrolls to the models. */
  onAgentChosen: () => void;
  /**
   * The list's visible height. The models section is at least this tall,
   * so a short list (Codex has three) can still be scrolled to the top.
   */
  modelsMinHeight: number;
}) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  const run = useSyncExternalStore(subscribeToAgentRun, chosenAgentRun, chosenAgentRun);
  // What the next task runs on: the choice made here or in the composer's
  // pill, else the server's own current agent.
  const eff = effectiveAgentRun(config, run);
  const agentId = eff?.agent ?? null;
  const agentLabel = config.agents.find((a) => a.id === agentId)?.label ?? config.current?.label ?? "";

  // Per task where the server runs tasks on their own agent; otherwise the
  // older way, switching the server's current agent (and model) for all.
  const choose = (next: AgentRun) => {
    if (config.perTask) return chooseAgentRun(next);
    void setAgentConfig(transport, { agent: next.agent, model: next.model }).then((c) => c && onServerChange(c));
  };

  const status = agentStatus(config);
  const dot = { ok: p.online, busy: p.agent, warn: p.danger, off: p.textFaint }[status.tone];
  return (
    <>
      <View style={[styles.row, styles.statusRow]} testID="annokit-settings-agent-status">
        <View style={[styles.statusDot, { backgroundColor: dot }]} />
        <View style={styles.rowBody}>
          <Text style={styles.rowValue}>{status.line}</Text>
          {!!config.agents.find((a) => a.id === agentId)?.shell && (
            <Text style={styles.rowMeta}>Its edits are auto-approved, and that includes shell commands.</Text>
          )}
        </View>
      </View>

      {config.enabled && (
        <>
          <Text style={styles.sectionLabel}>Agent</Text>
          {config.agents.map((a) => (
            <AgentChoice
              key={a.id}
              label={a.label}
              meta={!a.installed ? "Not installed" : !agentUsable(a) ? "Not signed in" : (a.version ?? "Installed")}
              selected={a.id === agentId}
              disabled={!agentUsable(a)}
              // Tapping the chosen one again still goes to its models.
              reselectable
              onSelect={() => {
                // A model and an effort belong to an agent: a new one starts on its defaults.
                if (a.id !== agentId) choose({ agent: a.id, model: null, effort: null });
                onAgentChosen();
              }}
              testID={`annokit-settings-agent-${a.id}`}
            />
          ))}
        </>
      )}

      {eff && (
        <View style={{ minHeight: modelsMinHeight }} onLayout={(e) => onModelsLayout(e.nativeEvent.layout.y)}>
          <Text style={styles.sectionLabel}>{agentLabel} models</Text>
          {models?.ok && models.note ? <Text style={styles.sectionNote}>{models.note}</Text> : null}
          {models === null && <Text style={styles.sectionNote}>Loading {agentLabel}'s models…</Text>}
          {models && !models.ok && (
            <View style={styles.row}>
              <Text style={[styles.rowMeta, styles.rowBody]}>{models.message}</Text>
              <Pressable onPress={onRetry} hitSlop={8} accessibilityRole="button" accessibilityLabel="Load the models again">
                <Text style={styles.rowAction}>Retry</Text>
              </Pressable>
            </View>
          )}
          {models?.ok &&
            modelRows(models).map((m) => (
              <AgentChoice
                key={m.key}
                label={m.label}
                tag={m.isDefault ? "Default" : undefined}
                meta={m.description ?? (m.isDefault ? `What ${agentLabel} uses unless told otherwise` : m.key !== m.label ? m.key : undefined)}
                selected={modelRowSelected(m, eff.model)}
                onSelect={() =>
                  choose({
                    agent: eff.agent,
                    model: m.value,
                    ...(m.value ? { modelLabel: m.label } : {}),
                    effort: keepEffort(models, m.value, eff.effort),
                  })
                }
                testID={`annokit-settings-model-${m.isDefault ? "default" : m.key}`}
              />
            ))}
          {models?.ok && models.models.length === 0 && (
            <Text style={styles.sectionNote}>{agentLabel} cannot list its models, so it runs on its default.</Text>
          )}

          <Text style={styles.sectionNote}>
            {config.perTask
              ? "For the tasks you create from now on, until the app reloads. The pill under the composer's text field shows it and switches between the main models."
              : "This server runs every task on one agent: choosing here switches it for everyone using the server."}
          </Text>
        </View>
      )}
    </>
  );
}

/**
 * The effort, pinned below the Agent page's list, for the model chosen in
 * it. A model that takes no effort level says so in its place, so the
 * footer does not appear and vanish as models are tried.
 */
function AgentEffortFooter({ config, models }: { config: AgentConfig; models: AgentModels | null }) {
  const styles = useStyles();
  const run = useSyncExternalStore(subscribeToAgentRun, chosenAgentRun, chosenAgentRun);
  const eff = effectiveAgentRun(config, run);
  if (!eff || !models?.ok) return null;
  const { efforts, defaultEffort } = modelEfforts(models, eff.model);
  const modelName = eff.model
    ? eff.modelLabel ?? models.models.find((m) => m.id === eff.model)?.label ?? eff.model
    : modelRows(models)[0]!.label;
  return (
    <View style={styles.effortFooter} testID="annokit-settings-effort-footer">
      {efforts.length > 0 ? (
        <EffortSlider
          efforts={efforts}
          value={eff.effort}
          defaultEffort={defaultEffort}
          onChange={(effort) => chooseAgentRun({ ...eff, effort })}
          testID="annokit-settings-effort"
        />
      ) : (
        <Text style={styles.effortNone}>{modelName} has no effort setting.</Text>
      )}
    </View>
  );
}


/** One agent or model: a name, a line under it, a tick when chosen. */
function AgentChoice({
  label,
  meta,
  selected,
  disabled = false,
  reselectable = false,
  tag,
  onSelect,
  testID,
}: {
  label: string;
  meta?: string;
  selected: boolean;
  disabled?: boolean;
  /** Tappable while selected (an agent: tapping it goes to its models). */
  reselectable?: boolean;
  /** A small word after the label: "Default". */
  tag?: string;
  onSelect: () => void;
  testID: string;
}) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onSelect}
      disabled={disabled || (selected && !reselectable)}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${label}${tag ? `, ${tag.toLowerCase()}` : ""}${meta ? `. ${meta}` : ""}${selected ? ". Selected" : ""}`}
      testID={testID}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
        disabled && styles.optionDisabled,
      ]}
    >
      <View style={styles.rowBody}>
        <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
          {label}
          {tag ? <Text style={styles.optionTag}>{`  ${tag}`}</Text> : null}
        </Text>
        {!!meta && (
          <Text style={styles.rowMeta} numberOfLines={2}>
            {meta}
          </Text>
        )}
      </View>
      {selected && <AnnoKitIcon name="check" size={14} color={p.agentText} />}
    </Pressable>
  );
}

/** One Output Detail level: what it is called, and what it sends. */
function DetailOption({
  detail,
  selected,
  onSelect,
}: {
  detail: OutputDetail;
  selected: boolean;
  onSelect: () => void;
}) {
  const { palette: p } = useAnnoKitTheme();
  const styles = useStyles();
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${outputDetailLabel(detail)} output detail. ${outputDetailSummary(
        detail,
      )}${selected ? " Selected." : ""}`}
      testID={`annokit-settings-detail-${detail}`}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        pressed && styles.optionPressed,
      ]}
    >
      <View style={styles.rowBody}>
        <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
          {outputDetailLabel(detail)}
        </Text>
        <Text style={styles.rowMeta}>{outputDetailSummary(detail)}</Text>
      </View>
      {selected && <AnnoKitIcon name="check" size={14} color={p.agentText} />}
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  refreshing: {
    opacity: 0.4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTitleWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 7,
    flexShrink: 1,
  },
  /*
   * One chevron glyph in the set, pointing DOWN (src/icon-set.ts). Rotating
   * it is what keeps the icon set at one arrow instead of three — and the
   * rotations read the way the navigation moves: back points left, deeper
   * points right.
   */
  backChevron: {
    transform: [{ rotate: "90deg" }],
    alignSelf: "center",
  },
  menuChevron: {
    transform: [{ rotate: "-90deg" }],
    alignSelf: "center",
  },
  headerVersion: {
    color: p.textFaint,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  headerTitle: {
    color: p.textStrong,
    fontSize: 15,
    fontWeight: "700",
    flexShrink: 1,
  },
  list: {
    // GROW NO FURTHER THAN THE PANEL, and shrink to fit inside it. This
    // panel is the one list in the package that is genuinely taller than
    // its sheet, and without the shrink the ScrollView lays out at its full
    // content height, gets clipped by the panel, and stops scrolling with
    // the last rows unreachable (device-observed: Diagnostics was gone).
    flexGrow: 0,
    flexShrink: 1,
  },
  optionTag: {
    color: p.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  effortFooter: {
    borderTopWidth: 1,
    borderTopColor: p.hairline,
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  effortNone: {
    color: p.textMuted,
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  statusRow: {
    marginTop: 6,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  sectionLabel: {
    color: p.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    paddingHorizontal: 10,
    paddingTop: 14,
    paddingBottom: 4,
  },
  sectionNote: {
    color: p.textFaint,
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 10,
    paddingTop: 6,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: 10,
  },
  optionSelected: {
    backgroundColor: p.agentTintSoft,
  },
  optionPressed: {
    backgroundColor: p.pressed,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  optionLabel: {
    color: p.textBody,
    fontSize: 14,
  },
  optionLabelSelected: {
    color: p.textStrong,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  rowBody: {
    flex: 1,
  },
  rowValue: {
    color: p.textBody,
    fontSize: 14,
    lineHeight: 19,
  },
  rowValueEmpty: {
    color: p.textFaint,
  },
  rowMeta: {
    color: p.textFaint,
    fontSize: 11,
    marginTop: 2,
  },
  rowAction: {
    color: p.agentText,
    fontSize: 13,
    fontWeight: "700",
  },
  swatchRow: {
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  swatchLabel: {
    color: p.textBody,
    fontSize: 13,
    marginBottom: 6,
  },
  swatches: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  swatchHit: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchHitChosen: {
    borderColor: p.textStrong,
  },
  swatchDisabled: {
    // Not hidden: seeing that a colour is in use elsewhere is the
    // explanation for why it cannot be picked.
    opacity: 0.25,
  },
  swatch: {
    width: 24,
    height: 24,
  },
  swatchCircle: {
    borderRadius: 12,
  },
  swatchSquare: {
    borderRadius: 7,
  },
  switch: {
    transform: [{ scaleX: 0.78 }, { scaleY: 0.78 }],
  },
  factRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  factLabel: {
    color: p.textMuted,
    fontSize: 12,
    flexShrink: 1,
  },
  factValue: {
    flex: 1,
    color: p.textSecondary,
    fontSize: 12,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
}));
