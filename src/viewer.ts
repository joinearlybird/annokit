/**
 * WHO "YOU" ARE, ON A DEVICE THAT WAS NEVER TOLD.
 *
 * A chat has to know which messages are yours — that is the whole of the
 * right-aligned, tinted side, and the name over everyone else's. This module
 * holds every place an identity can come from, in strict priority order:
 *
 *   1. HOST (`prop`) — `<AnnoKitProvider author={{id, name}} />`. An app
 *      that already knows who is signed in says so, and nothing is ever
 *      asked. Known before the first write, which is the point.
 *   2. VIEWER ENDPOINT (`viewer`) — `GET {endpoint}/me`, answered from the
 *      credentials of THAT REQUEST (our platform: the verified sandbox
 *      claims). This is the authoritative server answer and it is fetched
 *      once at startup, beside the /health handshake.
 *   3. ENV (`env`) — `EXPO_PUBLIC_ANNOKIT_AUTHOR_ID` / `_NAME`, written by
 *      whatever provisioned the preview. It is a BOOTSTRAP CONVENIENCE only:
 *      it is baked per CONTAINER, so if two devices ever open the same
 *      session (the QR / multiplayer path), every one of them would claim
 *      the session opener. It therefore ranks BELOW the viewer endpoint and
 *      is overwritten the moment /me disagrees.
 *   4. ECHO (`server`) — the author the server put on our own writes, which
 *      IS us on a server that authenticates. The original mechanism, kept as
 *      the fallback for a server with no /me route.
 *   5. PROMPTED (`prompt`) — nothing above yielded anything by the time the
 *      user first tries to POST: ask them, once, for a display name
 *      (src/name-prompt.tsx), and send it as an ADVISORY `authorName` hint
 *      on the write. A server with real auth MUST ignore that hint; a server
 *      without any (a standalone deployment, a local stub) uses it to label
 *      the message.
 *
 * TWO RULES THIS MODULE EXISTS TO KEEP:
 *
 *   · THE SERVER WINS ON DISPLAY. What a message SAYS its author is always
 *     comes from the message. Nothing here ever renames what came back — the
 *     local name is used to send a hint and to recognise ourselves, never to
 *     relabel a message the server already attributed.
 *   · OWNERSHIP IS IMMEDIATE. With an identity in hand, the FIRST message is
 *     already on the right side. Waiting for an echo was the old bug: your
 *     own opening line rendered as a stranger's.
 *
 * PERSISTENCE IS SESSION-MEMORY ONLY. No async-storage dependency for a dev
 * overlay; a reload asks again. See docs/protocol.md ("Who you are").
 */

import type { Comment, CommentAuthor, CommentMessage } from "./comments";

/** Which tier supplied the identity currently in force. */
export type ViewerSource = "prop" | "viewer" | "env" | "server" | "prompt";

/** This device's identity, as everything downstream reads it. */
export interface ViewerIdentity {
  /** Author id, when a tier above the prompt supplied one. */
  id: string | null;
  /** Display name, when one is known. */
  name: string | null;
  /** Avatar, when a tier that carries one supplied it. */
  avatarUrl: string | null;
  /** Where the identity came from — null while there is none at all. */
  source: ViewerSource | null;
}

/** An answer to "who is using this device". Every field optional. */
export interface AuthorHint {
  id?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

/** Longest display name we keep. A name is a label, not a paragraph. */
export const MAX_VIEWER_NAME = 40;

/**
 * A typed name, as it will be stored and sent: trimmed, inner whitespace
 * collapsed, capped. Null for anything that is not a name — so "   " can
 * never become an author called nothing.
 */
export function normalizeViewerName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, MAX_VIEWER_NAME);
}

/** Whether the prompt's confirm button does anything yet. */
export function canConfirmViewerName(raw: string): boolean {
  return normalizeViewerName(raw) !== null;
}

// ── The tiers, held for the session ──────────────────────────────────────

interface Tier {
  id: string | null;
  name: string | null;
  avatarUrl: string | null;
}

const EMPTY: Tier = { id: null, name: null, avatarUrl: null };

/** In priority order. `echo` carries an id only, `prompt` a name only. */
const tiers: Record<Exclude<ViewerSource, never>, Tier> = {
  prop: { ...EMPTY },
  viewer: { ...EMPTY },
  env: { ...EMPTY },
  server: { ...EMPTY },
  prompt: { ...EMPTY },
};

const ORDER: ViewerSource[] = ["prop", "viewer", "env", "server", "prompt"];

function readTier(hint: AuthorHint | null | undefined): Tier {
  const id = typeof hint?.id === "string" && hint.id.trim() ? hint.id.trim() : null;
  const avatarUrl =
    typeof hint?.avatarUrl === "string" && hint.avatarUrl.trim() ? hint.avatarUrl.trim() : null;
  return { id, name: normalizeViewerName(hint?.name), avatarUrl };
}

function has(tier: Tier): boolean {
  return !!(tier.id || tier.name);
}

/** Recomputed on write so `useSyncExternalStore` sees a stable snapshot. */
let snapshot: ViewerIdentity = { id: null, name: null, avatarUrl: null, source: null };
const listeners = new Set<() => void>();

/**
 * The identity: the ID comes from the highest tier that has one, and the
 * NAME/AVATAR only from that tier or above it.
 *
 * That last clause is the whole point of the ordering. Env identity is baked
 * per container, so on a session two devices opened it names the session's
 * opener; when `/me` answers with a different id, keeping the env NAME
 * beside the viewer's ID would put someone else's name on this device's
 * messages — a subtler version of exactly the bug the ranking prevents. A
 * tier that loses the id loses the person.
 *
 * ONE EXCEPTION: an echoed id. The server made it from our own write, so it
 * names whoever typed the prompt's name — not some other person. Stopping
 * at the echo there dropped the typed name after the first note, and every
 * note after it went out unsigned.
 */
function recompute(): void {
  const idIndex = ORDER.findIndex((key) => tiers[key].id !== null);
  const limit =
    idIndex === -1 || ORDER[idIndex] === "server" ? ORDER.length : idIndex + 1;
  let id: string | null = null;
  let name: string | null = null;
  let avatarUrl: string | null = null;
  let source: ViewerSource | null = null;
  for (let i = 0; i < limit; i += 1) {
    const key = ORDER[i]!;
    const tier = tiers[key];
    if (id === null) id = tier.id;
    if (name === null) name = tier.name;
    if (avatarUrl === null) avatarUrl = tier.avatarUrl;
    if (source === null && has(tier)) source = key;
  }
  const next: ViewerIdentity = { id, name, avatarUrl, source };
  if (
    next.id === snapshot.id &&
    next.name === snapshot.name &&
    next.avatarUrl === snapshot.avatarUrl &&
    next.source === snapshot.source
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Subscribe to identity changes (the React hook in src/name-prompt.tsx). */
export function subscribeToViewer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The identity in force, resolved across all three tiers. */
export function viewerIdentity(): ViewerIdentity {
  return snapshot;
}

/** The viewer's author id, or null when no tier has supplied one. */
export function viewerId(): string | null {
  return snapshot.id;
}

/**
 * The display name we would label ourselves with — sent as the ADVISORY
 * `authorName` hint on writes, or null when we have none.
 *
 * A server that authenticates its writers ignores it (ours does, verifiably:
 * fe-sandbox forwards only whitelisted fields and takes the acting user from
 * the sandbox claims). A server without auth uses it, and that is the only
 * reason it exists.
 */
export function viewerName(): string | null {
  return snapshot.name;
}

/**
 * Should we ask? Only when NOTHING above the prompt yielded an identity —
 * and nothing was typed earlier this session.
 */
export function needsViewerName(): boolean {
  if (tiers.prompt.name) return false;
  return !ORDER.some((key) => key !== "prompt" && has(tiers[key]));
}

/** Tier 1: whatever `<AnnoKitProvider author={…} />` resolved to. */
export function setHostAuthor(author: AuthorHint | null | undefined): void {
  tiers.prop = readTier(author);
  recompute();
}

/**
 * Tier 2: the answer from `GET /me`, resolved per REQUEST from the caller's
 * own credentials. Authoritative over the env tier below it, always — even
 * when it answers `{id: null}`, which simply means this server has no viewer
 * for us and the next tier should speak.
 */
export function setViewerFromServer(viewer: AuthorHint | null | undefined): void {
  tiers.viewer = readTier(viewer);
  recompute();
}

/** Tier 3: `EXPO_PUBLIC_ANNOKIT_AUTHOR_*` — per container, a bootstrap only. */
export function setEnvAuthor(author: AuthorHint | null | undefined): void {
  tiers.env = readTier(author);
  recompute();
}

/** Tier 4: an id the server echoed. Blank/absent ids are ignored, never stored. */
export function rememberViewer(id: string | null | undefined): void {
  if (typeof id === "string" && id.trim()) {
    tiers.server = { ...tiers.server, id: id.trim() };
    recompute();
  }
}

/** Tier 5: the name the user typed (or cleared, from the edit affordance). */
export function setViewerName(raw: string | null | undefined): void {
  tiers.prompt = { ...EMPTY, name: normalizeViewerName(raw) };
  recompute();
}

/** Forget everything (tests, and anything that swaps servers under us). */
export function forgetViewer(): void {
  for (const key of ORDER) tiers[key] = { ...EMPTY };
  recompute();
}

// ── Recognising ourselves ────────────────────────────────────────────────

/**
 * Is this message ours?
 *
 * Either half is enough, and both are needed. The ID is decisive when the
 * server and we agree on one — the platform case. The NAME carries the
 * standalone case: a server without auth labels our write with the hint we
 * sent, and no id we would recognise, so the name we typed is the only
 * thread back to ourselves. It also covers a host that passed its OWN user
 * id, which a no-auth server never saw.
 *
 * The cost is honest and small: on an unauthenticated server two people who
 * type the same display name look like one person to each other. A server
 * that cares about that is a server that should authenticate.
 */
export function isOwnAuthor(
  author: CommentAuthor | undefined,
  identity: ViewerIdentity,
): boolean {
  const id = author?.id?.trim();
  if (identity.id && id && id === identity.id) return true;
  const name = normalizeViewerName(author?.name);
  if (identity.name && name && name === identity.name) return true;
  return false;
}

/**
 * The author id the server just echoed for a message WE sent.
 *
 * Matched on content, from the end backwards: the reply we posted is the
 * newest message with that text, and a server free to append a teammate's
 * message in the same response must not be able to make us adopt theirs.
 */
export function viewerFromEcho(
  messages: readonly CommentMessage[],
  sentContent: string,
): string | null {
  const wanted = sentContent.trim();
  if (!wanted) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.content.trim() !== wanted) continue;
    const id = m.author?.id;
    return typeof id === "string" && id.trim() ? id : null;
  }
  return null;
}

/** A comment THIS device created is authored by the viewer, by definition. */
export function viewerFromCreatedComment(comment: Comment | null): string | null {
  const id = comment?.author?.id;
  return typeof id === "string" && id.trim() ? id : null;
}
