/**
 * Settings → Agent (src/agent-config.ts): what the server's optional /agent
 * routes say, read defensively, and the words the page and the menu use.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentPill,
  agentStatus,
  agentSummary,
  chooseAgentRun,
  effectiveAgentRun,
  taskAgentRun,
  modelRows,
  modelRowSelected,
  fetchAgentConfig,
  fetchAgentModels,
  forgetAgentRoute,
  readAgentConfig,
  setAgentConfig,
  withCached,
  modelEfforts,
  keepEffort,
  effortValueLabel,
  readModels,
  taskRun,
} from "../src/agent-config";
import type { AgentConfig, AgentTransport } from "../src/agent-config";
import { settingsRootRows } from "../src/settings-view";

const SERVER = {
  enabled: true,
  perTask: true,
  current: { id: "claude", label: "Claude Code", model: "sonnet", shell: false },
  error: null,
  working: 0,
  agents: [
    { id: "claude", label: "Claude Code", installed: true, version: "2.1.312" },
    { id: "gemini", label: "Gemini CLI", installed: false, shell: true },
  ],
};

function fake(over: Record<string, unknown> = {}): AgentTransport {
  return {
    getJson: vi.fn(async () => null),
    getJsonAt: vi.fn(async () => ({ status: 200, data: SERVER })),
    patchJson: vi.fn(async () => null),
    ...over,
  } as unknown as AgentTransport;
}

beforeEach(() => {
  forgetAgentRoute();
  chooseAgentRun(null);
});

describe("reading the server", () => {
  it("takes the documented shape", () => {
    const c = readAgentConfig(SERVER)!;
    expect(c.current).toEqual({ id: "claude", label: "Claude Code", model: "sonnet" });
    expect(c.agents.map((a) => [a.id, a.installed])).toEqual([["claude", true], ["gemini", false]]);
    expect(c.agents[1]!.shell).toBe(true);
  });

  it("refuses what is not one, and drops agents without an id or a label", () => {
    expect(readAgentConfig(null)).toBeNull();
    expect(readAgentConfig({ enabled: "yes", agents: [] })).toBeNull();
    const c = readAgentConfig({ enabled: true, current: null, agents: [{ id: "x" }, { label: "y" }, 7] })!;
    expect(c.agents).toEqual([]);
    expect(c.current).toBeNull();
  });
});

describe("the words", () => {
  const config = readAgentConfig(SERVER)!;

  it("says who is connected, and when it is working", () => {
    expect(agentStatus(config)).toEqual({ tone: "ok", line: "Connected to Claude Code" });
    expect(agentStatus({ ...config, working: 1 }).line).toBe("Working on a task");
    expect(agentStatus({ ...config, working: 3 }).line).toBe("Working on 3 tasks");
  });

  it("says why there is none", () => {
    expect(agentStatus({ ...config, current: null, agents: [], error: "no supported agent found" }).line).toBe(
      "no supported agent found",
    );
    expect(agentStatus({ ...config, enabled: false }).line).toBe("Turned off on the server");
    expect(agentStatus({ ...config, current: null, agents: [], error: "no supported agent found. Install one:" }).line).toBe(
      "no supported agent found. Install one",
    );
  });

  it("puts the agent and its model on the menu row, and only when the server has the route", () => {
    expect(agentSummary(config)).toBe("Claude Code · sonnet");
    expect(agentSummary({ ...config, current: { id: "codex", label: "Codex", model: null } })).toBe("Codex");
    expect(agentSummary({ ...config, current: null })).toBe("Not connected");
    const base = {
      theme: "system" as const, agentAccent: "blue" as const, teamAccent: "orange" as const,
      textTone: "neutral" as const, outputDetail: "standard" as const, clearOnSend: false,
      identity: { id: null, name: "Ada", avatarUrl: null, source: "prompt" } as never, version: "0.2.0",
    };
    expect(settingsRootRows(base).map((r) => r.page)).not.toContain("agent");
    const rows = settingsRootRows({ ...base, agent: config });
    expect(rows.map((r) => r.page).slice(0, 2)).toEqual(["appearance", "agent"]);
    expect(rows[1]!.summary).toBe("Claude Code · sonnet");
  });
});

describe("the routes", () => {
  it("asks a server without /agent once, then stops asking", async () => {
    const t = fake({ getJsonAt: vi.fn(async () => ({ status: 404, data: null })) });
    expect(await fetchAgentConfig(t)).toBeNull();
    expect(await fetchAgentConfig(t)).toBeNull();
    expect(t.getJsonAt).toHaveBeenCalledTimes(1);
  });

  it("keeps asking after a failure that is not a 404", async () => {
    const t = fake({ getJsonAt: vi.fn(async () => ({ status: 0, data: null })) });
    await fetchAgentConfig(t);
    await fetchAgentConfig(t);
    expect(t.getJsonAt).toHaveBeenCalledTimes(2);
  });

  it("asks the server to look again on refresh", async () => {
    const t = fake();
    await fetchAgentConfig(t, true);
    expect(t.getJsonAt).toHaveBeenCalledWith("/agent?refresh=1");
  });

  it("reads models, and a server's reason when it has none", async () => {
    const ok = fake({ getJson: vi.fn(async () => ({ ok: true, models: [{ id: "sonnet", label: "Sonnet 5.5" }, { label: "no id" }] })) });
    expect(await fetchAgentModels(ok, "claude")).toEqual({ ok: true, models: [{ id: "sonnet", label: "Sonnet 5.5" }] });
    expect((ok.getJson as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("/agent/models?agent=claude");
    const no = fake({ getJson: vi.fn(async () => ({ ok: false, message: "Grok is not signed in." })) });
    expect(await fetchAgentModels(no, "grok")).toEqual({ ok: false, message: "Grok is not signed in." });
  });

  it("reads what Default stands for, and a note to show, when the server says", async () => {
    const t = fake({ getJson: vi.fn(async () => ({
      ok: true, models: [{ id: "grok-4.5", label: "grok-4.5" }], defaultLabel: "grok-4.6", note: "Grok isn't signed in.",
    })) });
    expect(await fetchAgentModels(t, "grok")).toEqual({
      ok: true, models: [{ id: "grok-4.5", label: "grok-4.5" }], defaultLabel: "grok-4.6", note: "Grok isn't signed in.",
    });
  });

  it("switches with a PATCH and hands back the new state", async () => {
    const after = { ...SERVER, current: { id: "claude", label: "Claude Code", model: null } };
    const t = fake({ patchJson: vi.fn(async () => after) });
    const c = (await setAgentConfig(t, { model: null })) as AgentConfig;
    expect(t.patchJson).toHaveBeenCalledWith("/agent", { model: null });
    expect(c.current?.model).toBeNull();
  });
});

describe("the per-task choice", () => {
  const config = readAgentConfig({
    ...SERVER,
    agents: [...SERVER.agents, { id: "codex", label: "Codex", installed: true }],
  })!;
  const models = {
    claude: { ok: true as const, models: [{ id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet" }], defaultLabel: "Opus 5.5" },
    codex: { ok: true as const, models: [], defaultLabel: "GPT-6" },
  };

  it("sends nothing until something is chosen, and the server's current agent stands", () => {
    expect(taskAgentRun(config)).toBeNull();
    expect(effectiveAgentRun(config)).toEqual({ agent: "claude", model: "sonnet", effort: null });
    expect(agentPill(config, null, models)).toEqual({ connected: true, label: "Sonnet", agentLabel: "Claude Code" });
  });

  it("sends the choice while that agent is installed", () => {
    chooseAgentRun({ agent: "codex", model: null, effort: "high" });
    expect(taskAgentRun(config)).toEqual({ agent: "codex", model: null, effort: "high" });
    expect(agentPill(config, undefined, models).label).toBe("GPT-6");
    expect(agentSummary(config)).toBe("Codex");
    chooseAgentRun({ agent: "gemini", model: null, effort: null });
    expect(taskAgentRun(config)).toBeNull();
    expect(effectiveAgentRun(config)?.agent).toBe("claude");
  });

  it("names the model it was chosen by", () => {
    chooseAgentRun({ agent: "claude", model: "claude-opus-5-5", modelLabel: "Opus", effort: null });
    expect(agentPill(config).label).toBe("Opus");
    expect(agentSummary(config)).toBe("Claude Code · Opus");
  });

  it("treats an agent that is not signed in as one that cannot run the task", () => {
    const out = {
      ...config,
      agents: config.agents.map((a) => (a.id === "codex" ? { ...a, connected: false } : a)),
    };
    chooseAgentRun({ agent: "codex", model: null, effort: null });
    expect(taskAgentRun(out)).toBeNull();
    expect(effectiveAgentRun(out)?.agent).toBe("claude");
    // The server's current one not signed in, and nothing else: No agent.
    const none = { ...out, agents: out.agents.map((a) => ({ ...a, connected: false })) };
    expect(agentPill(none).connected).toBe(false);
    expect(agentStatus({ ...none, error: null })).toEqual({ tone: "warn", line: "No agent is signed in on the server" });
    expect(readAgentConfig({ ...SERVER, agents: [{ id: "x", label: "X", installed: true, connected: false }] })!.agents[0]!.connected).toBe(false);
  });

  it("says No agent when there is nothing to run the task", () => {
    expect(agentPill({ ...config, current: null, agents: [] })).toEqual({ connected: false, label: "No agent", agentLabel: null });
    expect(agentPill({ ...config, enabled: false }).connected).toBe(false);
    expect(agentPill(null).connected).toBe(false);
  });

  it("lists each model once, the default one marked rather than repeated", () => {
    // Codex marks its default; Claude names it ("Opus 5.5").
    const codex = { ok: true as const, models: [{ id: "sol", label: "Sol", default: true }, { id: "terra", label: "Terra" }, { id: "luna", label: "Luna" }] };
    expect(modelRows(codex).map((r) => [r.label, r.value, r.isDefault])).toEqual([
      ["Sol", null, true], ["Terra", "terra", false], ["Luna", "luna", false],
    ]);
    const claude = { ok: true as const, defaultLabel: "Opus", models: ["fable", "opus", "sonnet", "haiku", "old"].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) })) };
    // The pill: the default first, then three others.
    expect(modelRows(claude, 3).map((r) => r.label)).toEqual(["Opus", "Fable", "Sonnet", "Haiku"]);
    // A default that is not in the list, or no list: a lone Default row.
    expect(modelRows({ ok: true, models: [] }).map((r) => r.label)).toEqual(["Default"]);
    expect(modelRows({ ok: false, message: "x" })).toHaveLength(1);
    // The default row stands for its model by name too.
    const [def, terra] = modelRows(codex);
    expect(modelRowSelected(def!, null)).toBe(true);
    expect(modelRowSelected(def!, "sol")).toBe(true);
    expect(modelRowSelected(terra!, "terra")).toBe(true);
    expect(modelRowSelected(terra!, null)).toBe(false);
  });


  it("uses a list an earlier sheet fetched, which this one never asks for", () => {
    const cache = new Map([["codex", models.codex]]);
    expect(withCached(["claude", "codex"], { claude: models.claude }, cache)).toEqual({
      claude: models.claude,
      codex: models.codex,
    });
    // This sheet's own answer wins over the cache.
    const failed = { ok: false as const, message: "x" };
    expect(withCached(["codex"], { codex: failed }, cache).codex).toBe(failed);
  });

  it("asks each model for its own effort levels and default", () => {
    const m = readModels({
      ok: true,
      efforts: ["low", "medium", "high"],
      defaultEffort: "medium",
      models: [
        { id: "fable", label: "Fable", efforts: ["low", "medium", "high", "max"], defaultEffort: "high" },
        { id: "old", label: "Old", efforts: [] },
        { id: "plain", label: "Plain" },
      ],
    });
    expect(modelEfforts(m, null)).toEqual({ efforts: ["low", "medium", "high"], defaultEffort: "medium" });
    expect(modelEfforts(m, "fable")).toEqual({ efforts: ["low", "medium", "high", "max"], defaultEffort: "high" });
    // An older model that takes none, and one that does not say: the agent's.
    expect(modelEfforts(m, "old").efforts).toEqual([]);
    expect(modelEfforts(m, "plain").defaultEffort).toBe("medium");
    // Switching model keeps the effort only where the new one takes it.
    expect(keepEffort(m, "fable", "max")).toBe("max");
    expect(keepEffort(m, null, "max")).toBeNull();
    expect(keepEffort(m, "old", "low")).toBeNull();
  });

  it("sends nothing to a server that would not run the task on it", () => {
    const old = readAgentConfig({ ...SERVER, perTask: undefined })!;
    expect(old.perTask).toBeUndefined();
    chooseAgentRun({ agent: "claude", model: "opus", effort: "high" });
    expect(taskRun(old)).toBeNull();
    expect(taskAgentRun(old)).toBeNull();
    // What shows is then the server's own current agent, not the choice.
    expect(effectiveAgentRun(old)).toEqual({ agent: "claude", model: "sonnet", effort: null });
  });

  it("sends what the pill shows: the agent, the model, and the default level by name", () => {
    const lists = new Map([
      ["claude", readModels({
        ok: true, efforts: ["low", "medium", "high"], defaultEffort: "medium",
        models: [{ id: "fable", label: "Fable", efforts: ["low", "high"], defaultEffort: "high" }, { id: "old", label: "Old", efforts: [] }],
      })],
    ]);
    // Nothing chosen: the server's current agent, at its default level.
    const current = readAgentConfig({ ...SERVER, current: { id: "claude", label: "Claude Code", model: null } })!;
    expect(taskRun(current, null, lists)).toEqual({ agent: "claude", model: null, effort: "medium" });
    expect(taskRun(current, { agent: "claude", model: "fable", effort: null }, lists)?.effort).toBe("high");
    expect(taskRun(current, { agent: "claude", model: "fable", effort: "low" }, lists)?.effort).toBe("low");
    // A level the model does not take is not sent; nor is one for a model that takes none.
    expect(taskRun(current, { agent: "claude", model: "fable", effort: "medium" }, lists)?.effort).toBe("high");
    expect(taskRun(current, { agent: "claude", model: "old", effort: "low" }, lists)?.effort).toBeNull();
    // Lists not loaded: the choice as made.
    expect(taskRun(current, { agent: "claude", model: "fable", effort: "low" }, new Map())?.effort).toBe("low");
    expect(taskRun(null, null, lists)).toBeNull();
  });

  it("names the default level instead of offering Default as one", () => {
    expect(effortValueLabel("medium", "medium")).toBe("Medium · default");
    expect(effortValueLabel("xhigh", "medium")).toBe("Extra high");
    expect(effortValueLabel(null, null)).toBe("Default");
  });

  it("asks past the server's cache on refresh", async () => {
    const getJson = vi.fn(async () => ({ ok: true, models: [] }));
    await fetchAgentModels(fake({ getJson }), "claude");
    await fetchAgentModels(fake({ getJson }), "claude", true);
    expect(getJson.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      "/agent/models?agent=claude",
      "/agent/models?agent=claude&refresh=1",
    ]);
  });

  it("reads the efforts an agent takes", async () => {
    const t = fake({ getJson: vi.fn(async () => ({ ok: true, models: [], efforts: ["low", "high", 7, ""] })) });
    const m = await fetchAgentModels(t, "claude");
    expect(m.ok && m.efforts).toEqual(["low", "high"]);
  });
});
