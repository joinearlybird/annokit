/**
 * Configuration resolution for the AnnoKit overlay.
 *
 * PROPS-FIRST: explicit `<AnnoKitProvider endpoint= sessionId= token= />`
 * props always win. The EXPO_PUBLIC_* env reads below are the FALLBACK
 * defaults — they are the Earlybird platform's wiring convention (written
 * into app/.env.local by the platform's startDevServer), not part of the
 * AnnoKit Protocol itself. Any host can wire the provider by
 * props against any server that implements the protocol (see README.md).
 *
 * The overlay activates ONLY when all of these hold:
 *   - __DEV__ (never in a store/production bundle — this gate is absolute
 *     and cannot be overridden by props)
 *   - `enabled` prop is not explicitly false
 *   - an endpoint and sessionId resolved (props or env)
 *
 * Env fallbacks:
 *   - EXPO_PUBLIC_ANNOKIT_ENDPOINT — the annotation server base URL (for the
 *     Earlybird platform: https://<fe-sandbox>/sessions/<sandboxSessionId>/agentation)
 *   - EXPO_PUBLIC_ANNOKIT_SESSION_ID — the annotation session id
 *   - EXPO_PUBLIC_ANNOKIT_TOKEN — optional bearer (see AUTH NOTE)
 *
 * AUTH NOTE: bearer auth is OPTIONAL in the protocol. Servers may treat the
 * endpoint as a capability URL (unguessable ⇒ no token needed — the
 * reference server's default posture today) or require a bearer token on
 * mutating routes. When a token resolves (prop or env) it rides as an
 * `Authorization: Bearer` header on every call; when the server later
 * turns enforcement on, whatever provisions the endpoint env must inject
 * the token env alongside it (or the host app passes the `token` prop).
 */
import { plaintextRemote, safeEndpoint, validResourceId } from "./url";

export interface AnnoKitConfig {
  /** AnnoKit Protocol base URL (all routes hang off this). */
  endpoint: string;
  /** AnnoKit session id used in /sessions/<sid>/… routes. */
  sessionId: string;
  /** Optional bearer token. */
  token: string | null;
  /**
   * The HOST's answer to "who is using this device" (the `author` prop).
   * Highest-priority identity tier — see src/viewer.ts.
   */
  author: AnnoKitAuthor | null;
  /**
   * The identity the ENV suggested (`EXPO_PUBLIC_ANNOKIT_AUTHOR_*`). Kept
   * SEPARATE from `author` because it ranks differently: env identity is
   * baked per container, so it must never outrank the per-request answer
   * from `GET /me` (src/viewer.ts explains what that would break).
   */
  envAuthor: AnnoKitAuthor | null;
}

/** Who the overlay should treat as "you". Every field optional. */
export interface AnnoKitAuthor {
  id?: string;
  name?: string;
  avatarUrl?: string;
}

export interface AnnoKitConfigProps {
  /** Protocol base URL — overrides EXPO_PUBLIC_ANNOKIT_ENDPOINT. */
  endpoint?: string;
  /** Session id — overrides EXPO_PUBLIC_ANNOKIT_SESSION_ID. */
  sessionId?: string;
  /** Bearer token — overrides EXPO_PUBLIC_ANNOKIT_TOKEN. */
  token?: string;
  /**
   * This device's user, when the host app already knows. Outranks every
   * other identity source, and means the user is never asked for a name.
   */
  author?: AnnoKitAuthor;
  /** Explicit off-switch; `false` disables even when config is present. */
  enabled?: boolean;
}

declare const __DEV__: boolean | undefined;
// Module-scoped declaration: Metro inlines these at build time, so no Node
// types are needed (and this does not clash with @types/node in consumers).
declare const process: { env: Record<string, string | undefined> };

function envVar(name: string): string | null {
  // Metro statically inlines process.env.EXPO_PUBLIC_* — but only for
  // literal member accesses, so each variable is read explicitly.
  try {
    switch (name) {
      case "EXPO_PUBLIC_ANNOKIT_ENDPOINT":
        return process.env.EXPO_PUBLIC_ANNOKIT_ENDPOINT ?? null;
      case "EXPO_PUBLIC_ANNOKIT_SESSION_ID":
        return process.env.EXPO_PUBLIC_ANNOKIT_SESSION_ID ?? null;
      case "EXPO_PUBLIC_ANNOKIT_TOKEN":
        return process.env.EXPO_PUBLIC_ANNOKIT_TOKEN ?? null;
      case "EXPO_PUBLIC_ANNOKIT_AUTHOR_ID":
        return process.env.EXPO_PUBLIC_ANNOKIT_AUTHOR_ID ?? null;
      case "EXPO_PUBLIC_ANNOKIT_AUTHOR_NAME":
        return process.env.EXPO_PUBLIC_ANNOKIT_AUTHOR_NAME ?? null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Null unless the overlay should activate (dev build + not explicitly
 * disabled + endpoint/sessionId resolved from props or env).
 */
export function resolveAnnoKitConfig(props?: AnnoKitConfigProps): AnnoKitConfig | null {
  if (typeof __DEV__ === "undefined" || !__DEV__) return null;
  if (props?.enabled === false) return null;
  const endpoint = props?.endpoint ?? envVar("EXPO_PUBLIC_ANNOKIT_ENDPOINT");
  const sessionId = props?.sessionId ?? envVar("EXPO_PUBLIC_ANNOKIT_SESSION_ID");
  if (!endpoint || !sessionId) return null;
  if (!safeEndpoint(endpoint) || !validResourceId(sessionId)) {
    console.warn("[annokit] unusable endpoint or session id — overlay disabled");
    return null;
  }
  // Said once per resolved config, not per request: a LAN endpoint is a
  // legitimate way to reach a stub server from a device, and the adopter
  // owns that call. They should still know the token is in the clear.
  if (plaintextRemote(endpoint)) {
    console.warn(
      "[annokit] endpoint is plaintext HTTP to a remote host — the bearer token " +
      "and any screenshots cross the network unencrypted. Use HTTPS off the local machine.",
    );
  }
  const envId = envVar("EXPO_PUBLIC_ANNOKIT_AUTHOR_ID");
  const envName = envVar("EXPO_PUBLIC_ANNOKIT_AUTHOR_NAME");
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    sessionId,
    token: props?.token ?? envVar("EXPO_PUBLIC_ANNOKIT_TOKEN"),
    author: props?.author && (props.author.id || props.author.name) ? props.author : null,
    // NOT merged with the prop above, and not a fallback for it: the two are
    // different tiers with different trust (see AnnoKitConfig.envAuthor).
    envAuthor: envId || envName ? { ...(envId ? { id: envId } : {}), ...(envName ? { name: envName } : {}) } : null,
  };
}

/** The protocol version this package speaks (checked against GET /health). */
export const SUPPORTED_PROTOCOL_VERSION = 1;

/**
 * This package's own version, for the settings panel's diagnostics block.
 *
 * A literal, not a `package.json` import: Metro would inline the whole
 * manifest into the bundle, and a `require` of it from a library is exactly
 * the kind of thing that breaks in one consumer's bundler and not another's.
 * Kept in step with package.json by the test in test/env.test.ts, which
 * reads both and refuses to let them drift.
 */
export const PACKAGE_VERSION = "0.1.0";
