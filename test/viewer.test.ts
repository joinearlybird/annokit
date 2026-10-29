/**
 * WHO "YOU" ARE (src/viewer.ts) — the tier order, and what it protects.
 *
 * Getting this wrong is not cosmetic: too eager and a teammate's words sit
 * on your side of the thread in your colour; too timid and your own first
 * message reads as a stranger's, which is the bug this file was written for.
 * The ordering also carries a multiplayer hazard — env identity is baked per
 * CONTAINER, so on a session two devices opened it names only the opener —
 * hence the tests that pin env BELOW the per-request /me answer.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Comment, CommentMessage } from "../src/comments";
import {
  canConfirmViewerName,
  forgetViewer,
  isOwnAuthor,
  needsViewerName,
  normalizeViewerName,
  rememberViewer,
  setEnvAuthor,
  setHostAuthor,
  setViewerFromServer,
  setViewerName,
  subscribeToViewer,
  viewerFromCreatedComment,
  viewerFromEcho,
  viewerId,
  viewerIdentity,
  viewerName,
} from "../src/viewer";

const message = (id: string, content: string, authorId: string): CommentMessage => ({
  id,
  content,
  author: { id: authorId },
});

beforeEach(() => {
  forgetViewer();
});

describe("nothing known", () => {
  it("starts with no identity at all", () => {
    expect(viewerIdentity()).toEqual({ id: null, name: null, avatarUrl: null, source: null });
    expect(viewerId()).toBe(null);
    expect(viewerName()).toBe(null);
  });

  it("is the ONLY state that asks the user for a name", () => {
    expect(needsViewerName()).toBe(true);
  });
});

describe("the tier order", () => {
  it("1 · the host's prop outranks everything", () => {
    setEnvAuthor({ id: "env-user", name: "Env" });
    setViewerFromServer({ id: "me-user", name: "Me" });
    rememberViewer("echo-user");
    setViewerName("Typed");
    setHostAuthor({ id: "host-user", name: "Host" });

    expect(viewerIdentity()).toMatchObject({ id: "host-user", name: "Host", source: "prop" });
  });

  it("2 · the viewer endpoint outranks env, echo and the prompt", () => {
    setEnvAuthor({ id: "env-user", name: "Env" });
    rememberViewer("echo-user");
    setViewerName("Typed");
    setViewerFromServer({ id: "me-user", name: "Me", avatarUrl: "https://x/y.png" });

    expect(viewerIdentity()).toEqual({
      id: "me-user",
      name: "Me",
      avatarUrl: "https://x/y.png",
      source: "viewer",
    });
  });

  it("3 · env speaks only when nothing above it did", () => {
    setEnvAuthor({ id: "env-user", name: "Env" });
    expect(viewerIdentity()).toMatchObject({ id: "env-user", name: "Env", source: "env" });
  });

  it("4 · the echoed id is the fallback for a server with no /me route", () => {
    rememberViewer("echo-user");
    expect(viewerIdentity()).toMatchObject({ id: "echo-user", name: null, source: "server" });
  });

  it("5 · the prompt is last, and only names — it never invents an id", () => {
    setViewerName("Johnny");
    expect(viewerIdentity()).toMatchObject({ id: null, name: "Johnny", source: "prompt" });
  });
});

describe("env must never beat the viewer endpoint", () => {
  it("is overruled the moment /me answers with a different id", () => {
    // The container was provisioned for the session's opener…
    setEnvAuthor({ id: "opener", name: "Opener" });
    expect(viewerId()).toBe("opener");

    // …but THIS device's request is somebody else's.
    setViewerFromServer({ id: "second-device", name: "Dana" });
    expect(viewerIdentity()).toMatchObject({ id: "second-device", name: "Dana", source: "viewer" });
  });

  it("takes the opener's NAME down with the opener's id", () => {
    setEnvAuthor({ id: "opener", name: "Opener" });
    // A /me answer with no name must not leave the env name stranded beside
    // a different person's id — that is the same bug, quieter.
    setViewerFromServer({ id: "second-device" });
    expect(viewerName()).toBe(null);
  });

  it("keeps the env id only while /me has said nothing", () => {
    setEnvAuthor({ id: "opener" });
    setViewerFromServer(null);
    expect(viewerId()).toBe("opener");
  });
});

describe("fail-soft: a server with no viewer to report", () => {
  it("falls through when /me 404s (older server ⇒ null)", () => {
    setEnvAuthor({ id: "env-user" });
    setViewerFromServer(null);
    expect(viewerIdentity()).toMatchObject({ id: "env-user", source: "env" });
  });

  it("falls through when /me answers {id: null} — not an error, just nobody", () => {
    setViewerFromServer({ id: null, name: null });
    expect(viewerIdentity()).toMatchObject({ id: null, source: null });
    expect(needsViewerName()).toBe(true);
  });
});

describe("when the user is asked", () => {
  it("is not asked when the host named them", () => {
    setHostAuthor({ name: "Host" });
    expect(needsViewerName()).toBe(false);
  });

  it("is not asked when the host gave only an id", () => {
    setHostAuthor({ id: "host-user" });
    expect(needsViewerName()).toBe(false);
  });

  it("is not asked when /me answered", () => {
    setViewerFromServer({ id: "me-user" });
    expect(needsViewerName()).toBe(false);
  });

  it("is not asked when the env named them", () => {
    setEnvAuthor({ name: "Env" });
    expect(needsViewerName()).toBe(false);
  });

  it("is not asked when the server already echoed an id back", () => {
    rememberViewer("echo-user");
    expect(needsViewerName()).toBe(false);
  });

  it("is asked once, and not again after they answer", () => {
    expect(needsViewerName()).toBe(true);
    setViewerName("Johnny");
    expect(needsViewerName()).toBe(false);
  });

  it("is asked again if the answer is cleared", () => {
    setViewerName("Johnny");
    setViewerName("   ");
    expect(needsViewerName()).toBe(true);
  });
});

describe("a typed name", () => {
  it("is trimmed, collapsed and capped", () => {
    expect(normalizeViewerName("  Johnny   Feliz ")).toBe("Johnny Feliz");
    expect(normalizeViewerName("x".repeat(80))).toHaveLength(40);
  });

  it("is null for anything that is not a name", () => {
    expect(normalizeViewerName("   ")).toBe(null);
    expect(normalizeViewerName(undefined)).toBe(null);
    expect(canConfirmViewerName("  ")).toBe(false);
    expect(canConfirmViewerName("J")).toBe(true);
  });
});

describe("recognising our own messages", () => {
  const identity = () => viewerIdentity();

  it("is IMMEDIATE with a host identity — the first message included", () => {
    setHostAuthor({ id: "u1", name: "Johnny" });
    // No write has happened, nothing has been echoed: this is the case the
    // old echo-only client got wrong.
    expect(isOwnAuthor({ id: "u1" }, identity())).toBe(true);
  });

  it("is immediate with a typed name, on a server that has no ids for us", () => {
    setViewerName("Johnny");
    expect(isOwnAuthor({ id: "anon-7", name: "Johnny" }, identity())).toBe(true);
  });

  it("matches a host id even when the server labels us with a name only", () => {
    setHostAuthor({ id: "u1", name: "Johnny" });
    expect(isOwnAuthor({ id: "", name: "Johnny" }, identity())).toBe(true);
  });

  it("is false for a teammate", () => {
    setHostAuthor({ id: "u1", name: "Johnny" });
    expect(isOwnAuthor({ id: "u2", name: "Dana" }, identity())).toBe(false);
  });

  it("is false for an author the server could not resolve", () => {
    setHostAuthor({ id: "u1", name: "Johnny" });
    expect(isOwnAuthor({ id: "" }, identity())).toBe(false);
    expect(isOwnAuthor(undefined, identity())).toBe(false);
  });

  it("claims nothing while no tier has answered", () => {
    expect(isOwnAuthor({ id: "u1", name: "Johnny" }, identity())).toBe(false);
  });
});

describe("the server stays authoritative", () => {
  it("never renames what came back: the hint is only ever sent, never applied", () => {
    setViewerName("Johnny");
    // A server that authenticated us as someone else wins outright — the
    // identity we hold does not rewrite the author on the message…
    setViewerFromServer({ id: "u9", name: "J. Feliz" });
    expect(viewerIdentity()).toMatchObject({ id: "u9", name: "J. Feliz", source: "viewer" });
    // …and the hint we would send next is the server's answer, not ours.
    expect(viewerName()).toBe("J. Feliz");
  });

  it("keeps the typed name once the server echoes an id for it", () => {
    // A no-auth server labels the first note with the hint we sent, and
    // echoes an id made from it. That id is us — it came back from our own
    // write — so the name we typed still names us. Dropping it sent every
    // later note as "Someone", with no prompt to say so.
    setViewerName("Sam");
    rememberViewer("name:sam");
    expect(viewerIdentity()).toMatchObject({ id: "name:sam", name: "Sam" });
    expect(viewerName()).toBe("Sam");
    expect(needsViewerName()).toBe(false);
  });

  it("re-attributes ownership when the server's id disagrees with the typed name", () => {
    setViewerName("Johnny");
    setViewerFromServer({ id: "u9", name: "J. Feliz" });
    // A teammate the no-auth server had labelled "Johnny" stops being us.
    expect(isOwnAuthor({ id: "u3", name: "Johnny" }, viewerIdentity())).toBe(false);
    expect(isOwnAuthor({ id: "u9" }, viewerIdentity())).toBe(true);
  });
});

describe("subscribers", () => {
  it("hear a change once, and not when nothing changed", () => {
    let beats = 0;
    const off = subscribeToViewer(() => {
      beats += 1;
    });
    setViewerName("Johnny");
    setViewerName("Johnny");
    expect(beats).toBe(1);
    off();
    setViewerName("Dana");
    expect(beats).toBe(1);
  });
});

describe("the echo of a reply we posted", () => {
  it("is the author of the newest message with our text", () => {
    const messages = [
      message("c1", "Copy reads odd", "u2"),
      message("c2", "Fixed?", "u1"),
    ];
    expect(viewerFromEcho(messages, "Fixed?")).toBe("u1");
  });

  it("matches ignoring the whitespace the send trims", () => {
    expect(viewerFromEcho([message("c1", "Fixed?", "u1")], "  Fixed?  ")).toBe("u1");
  });

  it("takes the LAST match, so a teammate quoting us cannot steal the identity", () => {
    const messages = [
      message("c1", "Ship it", "u2"),
      message("c2", "Ship it", "u1"),
    ];
    expect(viewerFromEcho(messages, "Ship it")).toBe("u1");
  });

  it("is null when nothing came back with our text", () => {
    expect(viewerFromEcho([message("c1", "something else", "u2")], "Fixed?")).toBe(null);
  });

  it("is null for an empty send or an unresolved author", () => {
    expect(viewerFromEcho([message("c1", "hi", "u1")], "   ")).toBe(null);
    expect(viewerFromEcho([message("c1", "hi", "")], "hi")).toBe(null);
  });
});

describe("remembering an echoed id", () => {
  it("keeps what it is told", () => {
    rememberViewer("u1");
    expect(viewerId()).toBe("u1");
  });

  it("ignores nothing-shaped ids rather than forgetting a good one", () => {
    rememberViewer("u1");
    rememberViewer(null);
    rememberViewer(undefined);
    rememberViewer("   ");
    expect(viewerId()).toBe("u1");
  });

  it("cannot override the tiers above it", () => {
    setViewerFromServer({ id: "me-user" });
    rememberViewer("echo-user");
    expect(viewerId()).toBe("me-user");
  });
});

describe("a comment this device created", () => {
  const comment = (authorId: string): Comment => ({
    id: "cmt-1",
    status: "open",
    author: { id: authorId },
    messages: [],
  });

  it("is authored by the viewer, by definition", () => {
    expect(viewerFromCreatedComment(comment("u1"))).toBe("u1");
  });

  it("teaches nothing when the create failed or the author is unresolved", () => {
    expect(viewerFromCreatedComment(null)).toBe(null);
    expect(viewerFromCreatedComment(comment(""))).toBe(null);
  });
});
