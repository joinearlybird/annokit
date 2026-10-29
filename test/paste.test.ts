/**
 * Pasting an image into the composer (src/paste.ts) and uploading it as an
 * asset (src/attachments.ts, uploadAsset).
 */
import { describe, expect, it, vi } from "vitest";
import { pasteAvailable, pastedImages, PASTED_MAX } from "../src/paste";
import { uploadAsset } from "../src/attachments";
import type { AssetUploadTransport } from "../src/attachments";

const NOW = new Date(2026, 9, 28, 14, 7);

describe("pastedImages", () => {
  it("names each image for upload, numbered past the first", () => {
    const got = pastedImages({ type: "images", uris: ["file:///tmp/a.png", "file:///tmp/b.JPEG"] }, NOW);
    expect(got).toEqual([
      { uri: "file:///tmp/a.png", name: "pasted-20261028-1407.png", type: "image/png" },
      { uri: "file:///tmp/b.JPEG", name: "pasted-20261028-1407-2.jpg", type: "image/jpeg" },
    ]);
  });

  it("carries on the numbering from what is already pasted", () => {
    expect(pastedImages({ type: "images", uris: ["file:///tmp/c.gif"] }, NOW, 2)[0]!.name).toBe("pasted-20261028-1407-3.gif");
  });

  it("takes local files only, and treats an unknown type as PNG", () => {
    const got = pastedImages({ type: "images", uris: ["https://evil.example/x.png", "file:///tmp/x.heic", "javascript:1"] }, NOW);
    expect(got).toEqual([{ uri: "file:///tmp/x.heic", name: "pasted-20261028-1407.png", type: "image/png" }]);
  });

  it("stops at the cap, and ignores text and other pastes", () => {
    const many = Array.from({ length: 10 }, (_, i) => `file:///tmp/${i}.png`);
    expect(pastedImages({ type: "images", uris: many }, NOW)).toHaveLength(PASTED_MAX);
    expect(pastedImages({ type: "images", uris: many }, NOW, PASTED_MAX)).toEqual([]);
    expect(pastedImages({ type: "text", value: "hi" }, NOW)).toEqual([]);
    expect(pastedImages({ type: "unsupported" }, NOW)).toEqual([]);
  });

  it("is off where the native module is not in the build", () => {
    expect(pasteAvailable()).toBe(false);
  });
});

describe("uploadAsset", () => {
  const image = { uri: "file:///tmp/a.png", name: "pasted.png", type: "image/png" };
  const transport = (status: number, data: unknown): AssetUploadTransport =>
    ({ postFormAt: vi.fn(async () => ({ status, data })) }) as unknown as AssetUploadTransport;

  it("hands back the asset the server saved", async () => {
    const asset = { path: "uploads/pasted.png", name: "pasted.png", publicPath: "assets/uploads/pasted.png", agentPath: "assets/uploads/pasted.png" };
    const t = transport(201, asset);
    expect(await uploadAsset(t, image)).toEqual({ ok: true, asset });
    expect((t.postFormAt as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("/assets");
  });

  it("says when the server takes no uploads, and when it simply failed", async () => {
    expect(await uploadAsset(transport(405, { error: "read-only" }), image)).toEqual({ ok: false, reason: "unsupported", status: 405 });
    expect(await uploadAsset(transport(404, null), image)).toMatchObject({ reason: "unsupported" });
    expect(await uploadAsset(transport(415, { error: "not an image" }), image)).toMatchObject({ reason: "failed" });
    expect(await uploadAsset(transport(201, { nope: true }), image)).toMatchObject({ reason: "failed" });
  });
});
