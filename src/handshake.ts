/**
 * Startup handshake for the AnnoKit Protocol v1 (README.md):
 *
 *   1. `GET {endpoint}/health` → `{"status":"ok","protocolVersion":1}`.
 *      A missing/unreachable server or a protocolVersion this client does
 *      not speak disables the overlay LOUDLY (dev-log warning) and never
 *      throws into the host app.
 *   2. `POST {endpoint}/sessions` with the configured id — idempotent
 *      register/reuse of the annotation session.
 *   3. `GET {endpoint}/me` → who this device is, per REQUEST. OPTIONAL: a
 *      server without it (or without anyone authenticated) costs the overlay
 *      one 404 and nothing else.
 *
 * Split out of the provider so the protocol contract is unit-testable
 * without mounting the RN tree.
 */

import { detectFlavor, setServerFlavor } from "./agentation";
import { SUPPORTED_PROTOCOL_VERSION } from "./env";
import { debugLog } from "./log";
import { setServerQueuesTasks } from "./prefs";
import type { AnnoKitTransport } from "./transport";
import type { AuthorHint } from "./viewer";

export interface HealthResponse {
  status?: string;
  protocolVersion?: number;
  /**
   * The server takes a new task while another is `working` and runs it
   * when its turn comes, so Send need not wait (src/prefs.ts,
   * `blockSendWhileWorking`). Optional; absent means "assume it does not".
   */
  queuesTasks?: boolean;
}

/**
 * The version the server actually answered with, once it has.
 *
 * Module state rather than a return value because the only reader is the
 * settings panel's diagnostics block (src/settings-view.ts), several
 * components away from the one call site, and threading a number through
 * the whole provider for a read-only fact would be a worse trade. Null
 * until a handshake succeeds — "not negotiated" is a real answer and is
 * shown as one.
 */
let negotiated: number | null = null;

export function negotiatedProtocolVersion(): number | null {
  return negotiated;
}

/** Tests, and anything that swaps servers under us. */
export function forgetProtocolVersion(): void {
  negotiated = null;
}

/**
 * What /health said: "ok" when the server speaks a protocol this client
 * can (an AnnoKit Protocol version we support, or agentation-mcp, whose
 * /health has no `protocolVersion` at all — src/agentation.ts);
 * "unreachable" when nothing answered usefully, which may change — the
 * server may simply not be up yet; "mismatch" when it answered with a
 * version this client cannot speak, which will not. Never throws.
 */
export type ProtocolCheck = "ok" | "unreachable" | "mismatch";

export async function probeProtocol(transport: AnnoKitTransport): Promise<ProtocolCheck> {
  const health = await transport.getJson<HealthResponse>("/health");
  if (!health) {
    console.warn("[annokit] health check failed — the overlay appears once the server answers");
    return "unreachable";
  }
  const flavor = detectFlavor(health);
  if (flavor === "agentation") {
    setServerFlavor("agentation");
    debugLog("agentation-mcp server detected — compat mode");
    return "ok";
  }
  setServerFlavor("annokit");
  setServerQueuesTasks(health.queuesTasks === true);
  if (typeof health.protocolVersion === "number") negotiated = health.protocolVersion;
  if (health.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
    console.warn(
      `[annokit] protocol mismatch: server=${String(health.protocolVersion)} supported=${SUPPORTED_PROTOCOL_VERSION} — overlay disabled`,
    );
    return "mismatch";
  }
  return "ok";
}

/** probeProtocol as a yes or no. */
export async function checkProtocol(transport: AnnoKitTransport): Promise<boolean> {
  return (await probeProtocol(transport)) === "ok";
}

/**
 * How long to wait before asking an unreachable server again, by attempt
 * (0 = after the first failure). Quick at first — the common case is a
 * server started a moment after the app — then every half minute, for as
 * long as the app runs.
 */
export function handshakeRetryDelay(attempt: number): number {
  return [2_000, 5_000, 15_000][attempt] ?? 30_000;
}

/**
 * `GET {endpoint}/me` → who the SERVER thinks is holding this device,
 * answered from the credentials of THIS request (our platform: the verified
 * sandbox claims), never from anything the client said.
 *
 * FAIL-SOFT IN THREE WAYS, all of which mean the same thing to the caller —
 * "no server viewer, ask the next tier" (src/viewer.ts):
 *   · the route does not exist (an older server, a standalone one) → the
 *     transport already logged a 404 and handed back null;
 *   · the server answers `{"id": null}`, the documented way to say "nobody
 *     is authenticated here" — a 200, deliberately, because having no viewer
 *     is not an error;
 *   · the shape is unrecognisable.
 * It never blocks activation and never warns loudly: an overlay that made a
 * noise about an optional route would train people to ignore its log.
 */
export async function fetchViewer(transport: AnnoKitTransport): Promise<AuthorHint | null> {
  const data = await transport.getJson<Record<string, unknown>>("/me");
  if (!data || typeof data !== "object") return null;
  const raw = (data.viewer ?? data) as Record<string, unknown>;
  const pick = (key: string): string | undefined =>
    typeof raw[key] === "string" && (raw[key] as string).trim() ? (raw[key] as string) : undefined;
  const hint: AuthorHint = {
    ...(pick("id") ? { id: pick("id") } : {}),
    ...(pick("name") ? { name: pick("name") } : {}),
    ...(pick("avatarUrl") ? { avatarUrl: pick("avatarUrl") } : {}),
  };
  return hint.id || hint.name ? hint : null;
}

/**
 * Register the annotation session, returning the id everything else must
 * use.
 *
 * AnnoKit Protocol: idempotent — passing our configured id reuses it, and
 * the return IS that id (even when the POST fails; the server knows the
 * session by other means).
 *
 * agentation compat: their server ASSIGNS session ids and never dedupes
 * (same url twice = two sessions — recon doc), so this creates exactly one
 * per app run and returns the id from the response. Null when that create
 * failed — the caller disables rather than posting annotations into a
 * session that does not exist.
 */
export async function registerSession(
  transport: AnnoKitTransport,
  sessionId: string,
  routeName: string | null,
  flavor: "annokit" | "agentation" = "annokit",
): Promise<string | null> {
  if (flavor === "agentation") {
    const created = await transport.postJson<{ id?: unknown }>("/sessions", {
      url: `app://native${routeName ?? "/"}`,
    });
    return created && typeof created.id === "string" ? created.id : null;
  }
  await transport.postJson("/sessions", {
    id: sessionId,
    url: routeName ?? "/",
    title: "native",
  });
  return sessionId;
}
