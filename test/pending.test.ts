/**
 * Optimistic queue delete (src/pending.ts): the row and its marker must go
 * away the instant the × is tapped, and come back exactly where they were
 * if the server refuses.
 *
 * `setPending` here is the real `useState` updater contract (an updater
 * function applied to the previous list), backed by a plain array — no
 * React, no renderer.
 */

import { describe, expect, it, vi } from "vitest";
import { deleteAnnotation, deleteAnnotationPath } from "../src/pending";
import type { ServerAnnotation } from "../src/types";

function store(initial: ServerAnnotation[]) {
  let list = initial;
  return {
    get list() {
      return list;
    },
    setPending(update: (prev: ServerAnnotation[]) => ServerAnnotation[]) {
      list = update(list);
    },
  };
}

const A: ServerAnnotation = { id: "a", comment: "first" };
const B: ServerAnnotation = { id: "b", comment: "second" };
const C: ServerAnnotation = { id: "c", comment: "third" };

describe("delete route", () => {
  it("is the protocol's DELETE /annotations/:aid path", () => {
    expect(deleteAnnotationPath("a1")).toBe("/annotations/a1");
  });

  it("escapes ids that are not URL-safe", () => {
    expect(deleteAnnotationPath("a/b?c")).toBe("/annotations/a%2Fb%3Fc");
  });
});

describe("optimistic removal", () => {
  it("removes the row before the request resolves and keeps it removed on success", async () => {
    const s = store([A, B, C]);
    let release!: (ok: boolean) => void;
    const del = vi.fn(() => new Promise<boolean>((resolve) => (release = resolve)));

    const promise = deleteAnnotation({ del }, "b", s.setPending);
    // Optimistic: gone already, with the request still in flight.
    expect(s.list.map((a) => a.id)).toEqual(["a", "c"]);

    release(true);
    await expect(promise).resolves.toBe(true);
    expect(s.list.map((a) => a.id)).toEqual(["a", "c"]);
    expect(del).toHaveBeenCalledWith("/annotations/b");
  });

  it("leaves the other annotations untouched", async () => {
    const s = store([A, B, C]);
    await deleteAnnotation({ del: async () => true }, "b", s.setPending);
    expect(s.list).toEqual([A, C]);
  });

  it("is a no-op for an id that is not in the list (still calls the server)", async () => {
    const s = store([A]);
    const del = vi.fn(async () => true);
    await expect(deleteAnnotation({ del }, "zzz", s.setPending)).resolves.toBe(true);
    expect(s.list).toEqual([A]);
    expect(del).toHaveBeenCalledWith("/annotations/zzz");
  });
});

describe("revert on failure", () => {
  it("restores the annotation at its original index when the server rejects", async () => {
    const s = store([A, B, C]);
    await expect(deleteAnnotation({ del: async () => false }, "b", s.setPending)).resolves.toBe(
      false,
    );
    expect(s.list.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(s.list[1]).toBe(B);
  });

  it("restores a first/last row at its own end of the list", async () => {
    const first = store([A, B, C]);
    await deleteAnnotation({ del: async () => false }, "a", first.setPending);
    expect(first.list.map((a) => a.id)).toEqual(["a", "b", "c"]);

    const last = store([A, B, C]);
    await deleteAnnotation({ del: async () => false }, "c", last.setPending);
    expect(last.list.map((a) => a.id)).toEqual(["a", "b", "c"]);
  });

  it("does not duplicate the row when a refresh already re-added it", async () => {
    const s = store([A, B]);
    const del = async () => {
      // A pending-list refresh lands mid-flight and re-adds B.
      s.setPending((prev) => [...prev, B]);
      return false;
    };
    await deleteAnnotation({ del }, "b", s.setPending);
    expect(s.list.filter((a) => a.id === "b")).toHaveLength(1);
  });

  it("clamps the restore index when the list shrank while in flight", async () => {
    const s = store([A, B, C]);
    const del = async () => {
      s.setPending(() => []);
      return false;
    };
    await deleteAnnotation({ del }, "c", s.setPending);
    expect(s.list.map((a) => a.id)).toEqual(["c"]);
  });
});
