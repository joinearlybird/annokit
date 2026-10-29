/**
 * WHICH AGENT, WHICH MODEL — read and switched over the optional `/agent`
 * routes (docs/protocol.md, *Agent*).
 *
 * A server that runs agents can say which ones it has, which is in use and
 * on which model, and let the person holding the phone change them: Settings
 * → Agent. The server owns all of it — what is installed, what each one's
 * models are (asked of the agent's own CLI, so this package never carries a
 * list that goes stale), and which is current. The overlay only shows it and
 * asks for a change.
 *
 * PER TASK. Which agent and model a task runs on is chosen in the composer
 * (the pill, src/agent-pill.tsx) or in Settings → Agent, and rides on the
 * task itself (`agent` on the annotation body). Nothing chosen: the task
 * says nothing and the server runs it on its own current agent. The choice
 * is held for the session, like the other settings.
 *
 * OPTIONAL. A server without the route answers 404; the read is then null
 * and neither the pill nor the Agent row appears. Nothing else in the
 * overlay depends on it.
 *
 * Pure apart from the three transport calls, so the wording is tested
 * without a tree.
 */

/** The slice of the transport this needs, so tests can fake it. */
export interface AgentTransport {
  getJson<T = unknown>(path: string): Promise<T | null>;
  getJsonAt<T = unknown>(path: string): Promise<{ status: number; data: T | null }>;
  patchJson<T = unknown>(path: string, body: unknown): Promise<T | null>;
}

/**
 * The server answered 404: it has no /agent. Remembered for the session,
 * so a server without the route is asked once, not every time Settings
 * opens and every time an event arrives while it is open. Any other
 * failure is not remembered — it may be gone on the next try.
 */
let routeAbsent = false;

/** Tests, and anything that swaps servers under us. */
export function forgetAgentRoute(): void {
  routeAbsent = false;
}

/** One agent the server knows, installed or not. */
export interface AgentOption {
  id: string;
  label: string;
  installed: boolean;
  /**
   * Installed and signed in. False: on PATH but not signed in, so its tasks
   * would fail. Absent: the server does not say, and installed is taken
   * to mean usable.
   */
  connected?: boolean;
  version?: string;
  /** Its edits are auto-approved with shell access, not file tools only. */
  shell?: boolean;
}

export interface AgentConfig {
  /** False: the server runs no agent at all (turned off there). */
  enabled: boolean;
  /** The agent in use, or null when none is installed or it is off. */
  current: { id: string; label: string; model: string | null; shell?: boolean } | null;
  /** Why there is no current agent, in one line. */
  error?: string | null;
  /** Tasks it is working on right now. */
  working?: number;
  agents: AgentOption[];
  /**
   * The server runs each task on the `agent` the task carries. Without
   * it, a choice sent with a task would be ignored with nothing on screen
   * to say so — so the pill is not drawn, and Settings → Agent switches
   * the server's current agent instead (no effort: that rides on a task).
   */
  perTask?: boolean;
}

export interface AgentModel {
  id: string;
  label: string;
  description?: string;
  /** The CLI's own default. */
  default?: boolean;
  /** Effort levels this model takes, lowest first. Empty: none. Absent: as the agent's. */
  efforts?: string[];
  /** The level it runs at when none is asked for, when the CLI or its settings say. */
  defaultEffort?: string;
}

export type AgentModels =
  | {
      ok: true;
      models: AgentModel[];
      /** What "Default" stands for, when the agent's CLI says ("Opus 5.5"). */
      defaultLabel?: string;
      /** Something the person should know before using it ("not signed in"). */
      note?: string;
      /** Effort levels the Default model takes, lowest first. Absent: it takes none. */
      efforts?: string[];
      /** The level the Default model runs at when none is asked for. */
      defaultEffort?: string;
    }
  | { ok: false; message: string };

const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/** A server's answer as an AgentConfig, or null if it is not one. */
export function readAgentConfig(raw: unknown): AgentConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== "boolean" || !Array.isArray(r.agents)) return null;
  const agents: AgentOption[] = [];
  for (const a of r.agents as unknown[]) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const id = str(o.id, 40), label = str(o.label, 60);
    if (!id || !label) continue;
    agents.push({
      id,
      label,
      installed: o.installed === true,
      ...(typeof o.connected === "boolean" ? { connected: o.connected } : {}),
      ...(str(o.version, 80) ? { version: str(o.version, 80) } : {}),
      ...(o.shell === true ? { shell: true } : {}),
    });
  }
  const c = r.current as Record<string, unknown> | null | undefined;
  const currentId = c && typeof c === "object" ? str(c.id, 40) : undefined;
  return {
    enabled: r.enabled,
    current: currentId
      ? {
          id: currentId,
          label: str(c!.label, 60) ?? currentId,
          model: str(c!.model) ?? null,
          ...(c!.shell === true ? { shell: true } : {}),
        }
      : null,
    error: str(r.error, 300) ?? null,
    working: typeof r.working === "number" && r.working > 0 ? Math.floor(r.working) : 0,
    agents,
    ...(r.perTask === true ? { perTask: true } : {}),
  };
}

/** A list of effort levels, or undefined when it is not a list at all. */
function readEfforts(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return (raw as unknown[]).map((e) => str(e, 20)).filter((e): e is string => !!e).slice(0, 8);
}

export function readModels(raw: unknown): AgentModels {
  if (!raw || typeof raw !== "object") return { ok: false, message: "Could not load models." };
  const r = raw as Record<string, unknown>;
  if (r.ok !== true || !Array.isArray(r.models)) {
    return { ok: false, message: str(r.message, 300) ?? "Could not load models." };
  }
  const models: AgentModel[] = [];
  for (const m of r.models as unknown[]) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const id = str(o.id);
    if (!id) continue;
    const efforts = readEfforts(o.efforts);
    const defaultEffort = str(o.defaultEffort, 20);
    models.push({
      id,
      label: str(o.label, 120) ?? id,
      ...(str(o.description, 300) ? { description: str(o.description, 300) } : {}),
      ...(o.default === true ? { default: true } : {}),
      ...(efforts ? { efforts } : {}),
      ...(defaultEffort && efforts?.includes(defaultEffort) ? { defaultEffort } : {}),
    });
  }
  const defaultLabel = str(r.defaultLabel, 80);
  const note = str(r.note, 300);
  const efforts = readEfforts(r.efforts) ?? [];
  const defaultEffort = str(r.defaultEffort, 20);
  return {
    ok: true,
    models,
    ...(defaultLabel ? { defaultLabel } : {}),
    ...(note ? { note } : {}),
    ...(efforts.length ? { efforts } : {}),
    ...(defaultEffort && efforts.includes(defaultEffort) ? { defaultEffort } : {}),
  };
}

/** `GET /agent`. Null when the server has no such route or did not answer. */
export async function fetchAgentConfig(transport: AgentTransport, refresh = false): Promise<AgentConfig | null> {
  if (routeAbsent) return null;
  const { status, data } = await transport.getJsonAt(refresh ? "/agent?refresh=1" : "/agent");
  if (status === 404) routeAbsent = true;
  return readAgentConfig(data);
}

/**
 * `GET /agent/models?agent=…` — slow: the server asks the agent's CLI.
 * `refresh` asks it to skip its own cache and ask the CLI again.
 */
export async function fetchAgentModels(transport: AgentTransport, agentId: string, refresh = false): Promise<AgentModels> {
  const raw = await transport.getJson(`/agent/models?agent=${encodeURIComponent(agentId)}${refresh ? "&refresh=1" : ""}`);
  return raw ? readModels(raw) : { ok: false, message: "Could not load models." };
}

/** `PATCH /agent`. A new agent starts on its own default model, server-side. */
export async function setAgentConfig(
  transport: AgentTransport,
  change: { agent?: string; model?: string | null },
): Promise<AgentConfig | null> {
  return readAgentConfig(await transport.patchJson("/agent", change));
}

/** Where the agent stands, in one line and a tone, for the page and the menu. */
export function agentStatus(config: AgentConfig, run: AgentRun | null = chosenRun): { tone: "ok" | "busy" | "warn" | "off"; line: string } {
  if (!config.enabled) return { tone: "off", line: "Turned off on the server" };
  const eff = effectiveAgentRun(config, run);
  if (!eff) {
    // A server's own reason, as a sentence: a trailing colon means it was
    // cut from a longer message ("…Install one:"), which reads as broken.
    const reason = config.error?.trim().replace(/[\s:]+$/, "");
    if (!reason && config.agents.some((a) => a.installed)) return { tone: "warn", line: "No agent is signed in on the server" };
    return { tone: "warn", line: reason || "No agent installed on the server" };
  }
  if (config.working) return { tone: "busy", line: config.working === 1 ? "Working on a task" : `Working on ${config.working} tasks` };
  return { tone: "ok", line: `Connected to ${agentLabelOf(config, eff.agent)}` };
}

/** The Settings menu row's value: the agent and model the next task runs on, or why there is none. */
export function agentSummary(config: AgentConfig, run: AgentRun | null = chosenRun): string {
  if (!config.enabled) return "Off";
  const eff = effectiveAgentRun(config, run);
  if (!eff) return "Not connected";
  const label = agentLabelOf(config, eff.agent);
  const model = eff.modelLabel ?? eff.model;
  return model ? `${label} · ${model}` : label;
}

function agentLabelOf(config: AgentConfig, id: string): string {
  return config.agents.find((a) => a.id === id)?.label ?? (config.current?.id === id ? config.current.label : id);
}

// ── The per-task choice ─────────────────────────────────────────────────

/** An agent a task can run on: installed, and not known to be signed out. */
export function agentUsable(agent: AgentOption | undefined): boolean {
  return !!agent && agent.installed && agent.connected !== false;
}

/** The agent, model and effort a task asks for. Null model/effort: the agent's default. */
export interface AgentRun {
  agent: string;
  model: string | null;
  effort: string | null;
  /** What the pill calls the model; the id is what is sent. */
  modelLabel?: string;
}

let chosenRun: AgentRun | null = null;
const runListeners = new Set<() => void>();

/** What was chosen this session, or null: the server's current agent. */
export function chosenAgentRun(): AgentRun | null {
  return chosenRun;
}

export function subscribeToAgentRun(listener: () => void): () => void {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}

/** The pill's and Settings → Agent's one way to change it. Null goes back to the server's. */
export function chooseAgentRun(run: AgentRun | null): void {
  chosenRun = run;
  for (const listener of runListeners) listener();
}

/**
 * What a new task should carry: the choice, while the server still has
 * that agent installed. An agent uninstalled since — or a server that was
 * swapped — drops the choice back to the server's own, rather than sending
 * a task to an agent that cannot run it.
 */
export function taskAgentRun(config: AgentConfig | null, run: AgentRun | null = chosenRun): AgentRun | null {
  if (!config || !config.enabled || !config.perTask || !run) return null;
  return agentUsable(config.agents.find((a) => a.id === run.agent)) ? run : null;
}

/**
 * Model lists the session has already been given, by agent. The server
 * starts the agent's CLI to answer, so the pill does not ask again every
 * time the composer opens — and a task reads the default effort from here.
 */
export const sessionModels = new Map<string, AgentModels>();

/**
 * What a new task carries: exactly what the pill shows — the agent, the
 * model, and the effort, with the model's default level filled in as that
 * level. Spelled out rather than left to the server's own defaults, so the
 * task records what it was asked to run at, and runs at it on a server
 * whose agent settings differ. Model null stays null: the agent's Default
 * model is a choice the CLI makes, and its name is not a model id.
 * Null when there is no agent to send it to.
 */
export function taskRun(
  config: AgentConfig | null,
  run: AgentRun | null = chosenRun,
  models: ReadonlyMap<string, AgentModels> = sessionModels,
): AgentRun | null {
  // A server that would ignore it is not sent it.
  if (!config?.perTask) return null;
  const eff = effectiveAgentRun(config, run);
  if (!eff) return null;
  const list = models.get(eff.agent);
  // Lists not loaded yet: the choice as made, nothing filled in.
  if (!list?.ok) return eff;
  const { efforts, defaultEffort } = modelEfforts(list, eff.model);
  // A level the model does not take is never sent; a model that takes
  // none gets none.
  const effort = eff.effort && efforts.includes(eff.effort) ? eff.effort : defaultEffort;
  return { ...eff, effort };
}

/** The run a task will actually get: the choice, else the server's current agent. */
export function effectiveAgentRun(config: AgentConfig | null, run: AgentRun | null = chosenRun): AgentRun | null {
  const chosen = taskAgentRun(config, run);
  if (chosen) return chosen;
  if (!config?.enabled || !config.current) return null;
  // The server's current agent, unless it says that one is not signed in.
  if (config.agents.find((a) => a.id === config.current!.id)?.connected === false) return null;
  return { agent: config.current.id, model: config.current.model, effort: null };
}

/** How many of each agent's models the pill's menu offers; Settings → Agent has them all. */
export const PILL_MODELS = 3;


/**
 * This sheet's lists, with the session's cache under them. A list fetched
 * by an earlier sheet is not fetched again, so this sheet's own state never
 * holds it — read without the cache, a connected agent showed only Default.
 */
export function withCached(
  ids: string[],
  own: Record<string, AgentModels | undefined>,
  cache: ReadonlyMap<string, AgentModels>,
): Record<string, AgentModels | undefined> {
  const out: Record<string, AgentModels | undefined> = {};
  for (const id of ids) out[id] = own[id] ?? cache.get(id);
  return out;
}

/**
 * The effort levels a model takes, and the one it runs at by default.
 * Levels differ by model (an older Claude takes none; a Codex model may
 * stop short of another's top level), so they are asked per model; the
 * Default row has the agent's. No default known: null.
 */
export function modelEfforts(
  models: AgentModels | null | undefined,
  modelId: string | null,
): { efforts: string[]; defaultEffort: string | null } {
  if (!models?.ok) return { efforts: [], defaultEffort: null };
  const m = modelId ? models.models.find((x) => x.id === modelId) : undefined;
  if (m?.efforts) return { efforts: m.efforts, defaultEffort: m.defaultEffort ?? null };
  return { efforts: models.efforts ?? [], defaultEffort: models.defaultEffort ?? null };
}

/**
 * The effort to keep when the model changes: the chosen one if the new
 * model takes it, else back to that model's default. Never sent to a model
 * that does not take it.
 */
export function keepEffort(models: AgentModels | null | undefined, modelId: string | null, effort: string | null): string | null {
  if (!effort) return null;
  return modelEfforts(models, modelId).efforts.includes(effort) ? effort : null;
}

/** "xhigh" → "Extra high"; the rest capitalised; null → "Default". */
export function effortLabel(effort: string | null): string {
  if (!effort) return "Default";
  if (effort === "xhigh") return "Extra high";
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

/** What the slider says above the track. */
export function effortValueLabel(at: string | null, defaultEffort: string | null): string {
  if (!at) return "Default";
  return at === defaultEffort ? `${effortLabel(at)} · default` : effortLabel(at);
}

/** One row of a model list: the default model marked, not listed twice. */
export interface ModelRow {
  /** What choosing it sends: null on the default row — the agent's own default. */
  value: string | null;
  /** For test ids and keys. */
  key: string;
  label: string;
  description?: string;
  isDefault: boolean;
}

/**
 * The model rows for an agent: ONE per model, the default one tagged
 * rather than repeated as a separate "Default (Opus 5.5)" row. Choosing it
 * is choosing the agent's default (no model sent), so the task follows the
 * CLI if its default moves on. When the default is not among the listed
 * models (or nothing is listed), a lone "Default" row stands for it.
 * `count` caps the others, for the pill.
 */
export function modelRows(models: AgentModels | null | undefined, count = Infinity): ModelRow[] {
  const list = models?.ok ? models.models : [];
  const def =
    list.find((m) => m.default) ?? (models?.ok && models.defaultLabel ? list.find((m) => m.label === models.defaultLabel) : undefined);
  const head: ModelRow = def
    ? { value: null, key: def.id, label: def.label, ...(def.description ? { description: def.description } : {}), isDefault: true }
    : { value: null, key: "default", label: models?.ok && models.defaultLabel ? models.defaultLabel : "Default", isDefault: true };
  const rest = list
    .filter((m) => m !== def)
    .slice(0, count)
    .map((m) => ({ value: m.id, key: m.id, label: m.label, ...(m.description ? { description: m.description } : {}), isDefault: false }));
  return [head, ...rest];
}

/** Whether a row is the one a run is on: the default row also stands for its model chosen by name. */
export function modelRowSelected(row: ModelRow, model: string | null): boolean {
  return row.isDefault ? model === null || model === row.key : model === row.value;
}


/**
 * The pill: a green dot and the model a task will run on, or a red dot and
 * "No agent". The model's name, not the agent's — the agent is in the
 * menu — except on the default, where the CLI may not say what that is.
 */
export function agentPill(
  config: AgentConfig | null,
  run: AgentRun | null = chosenRun,
  models: Record<string, AgentModels | undefined> = {},
): { connected: boolean; label: string; agentLabel: string | null } {
  const eff = effectiveAgentRun(config, run);
  if (!config || !eff) return { connected: false, label: "No agent", agentLabel: null };
  const agentLabel = agentLabelOf(config, eff.agent);
  const list = models[eff.agent];
  let label: string;
  if (eff.model) {
    label = eff.modelLabel ?? (list?.ok ? list.models.find((m) => m.id === eff.model)?.label : undefined) ?? eff.model;
  } else {
    label = list?.ok && list.defaultLabel ? list.defaultLabel : agentLabel;
  }
  return { connected: true, label, agentLabel };
}
