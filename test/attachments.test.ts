/**
 * Attachments data layer (src/attachments.ts): the generic source model,
 * the built-in assets source, and the `references[]` entries picks produce.
 *
 * The reference VALUES are a wire contract the consuming agent reads — an
 * `asset` reference's value is the stable `/api/assets/{path}` URL it can
 * embed in code, never the presigned preview. Drift here silently sends the
 * agent after files that do not exist, so these assertions are literal.
 *
 * Host-specific sources (the platform's data-API picker, for example) live
 * with the host app, not here — this file only proves the package renders
 * and forwards whatever a source produces.
 */

import { describe, expect, it, vi } from "vitest";
import { assetItem, assetReference, assetsSource, buildReferences, clampItems, fetchAssets } from "../src/attachments";
import { ATTACHMENT_ITEMS_MAX, FIELD_MAX, REFERENCES_MAX } from "../src/limits";
import type { AssetItem, AttachmentItem } from "../src/attachments";

/** A transport whose `getJson` answers per path (null = failed read). */
function transport(responses: Record<string, unknown>) {
  const getJson = vi.fn(async (path: string) => responses[path] ?? null);
  return { getJson, transport: { getJson } };
}

const LOGO: AssetItem = {
  path: "brand/logo.png",
  name: "logo.png",
  publicPath: "/api/assets/brand/logo.png",
  previewUrl: "https://r2.example/presigned/logo.png?sig=abc",
  size: 1234,
  uploaded: "2026-08-01T00:00:00.000Z",
};

describe("the built-in assets source", () => {
  it("assets come from GET /assets", async () => {
    const t = transport({ "/assets": { assets: [LOGO] } });
    await expect(fetchAssets(t.transport)).resolves.toEqual([LOGO]);
    expect(t.getJson).toHaveBeenCalledWith("/assets");
  });

  it("a failed /assets read is an empty library, not an error state", async () => {
    await expect(fetchAssets(transport({}).transport)).resolves.toEqual([]);
  });

  it("tolerates a body without the expected key (older server)", async () => {
    await expect(fetchAssets(transport({ "/assets": {} }).transport)).resolves.toEqual([]);
  });

  it("drops malformed entries rather than rendering half a row", async () => {
    const t = transport({ "/assets": { assets: [LOGO, { name: "no path" }, null, "junk"] } });
    await expect(fetchAssets(t.transport)).resolves.toEqual([LOGO]);
  });

  it("lists assets as generic items — identity is the publicPath, preview is display-only", async () => {
    const t = transport({ "/assets": { assets: [LOGO] } });
    await expect(assetsSource.list(t.transport)).resolves.toEqual([
      {
        id: "/api/assets/brand/logo.png",
        title: "logo.png",
        subtitle: "/api/assets/brand/logo.png",
        thumbnailUri: "https://r2.example/presigned/logo.png?sig=abc",
        reference: { type: "asset", value: "/api/assets/brand/logo.png", label: "logo.png", preview: "https://r2.example/presigned/logo.png?sig=abc" },
      },
    ]);
  });

  it("names its tab and empty state", () => {
    expect(assetsSource.key).toBe("assets");
    expect(assetsSource.title).toBe("Assets");
    expect(assetsSource.emptyText).toBe("No assets yet");
  });
});

describe("reference construction", () => {
  it("an asset reference's value is the STABLE publicPath, never the presigned preview", () => {
    // The preview rides along for people to look at, display only — it may
    // expire, and nothing that acts on the reference reads it.
    expect(assetReference(LOGO)).toEqual({
      type: "asset",
      value: "/api/assets/brand/logo.png",
      label: "logo.png",
      preview: "https://r2.example/presigned/logo.png?sig=abc",
    });
    expect(assetReference({ ...LOGO, previewUrl: "javascript:alert(1)" })).not.toHaveProperty("preview");
  });

  it("tells the agent where to open it, when the server says", () => {
    expect(assetReference({ ...LOGO, agentPath: " assets/brand/logo.png " })).toEqual({
      type: "asset",
      value: "/api/assets/brand/logo.png",
      label: "logo.png",
      open: "assets/brand/logo.png",
      preview: "https://r2.example/presigned/logo.png?sig=abc",
    });
    expect(assetReference({ ...LOGO, agentPath: "   " })).not.toHaveProperty("open");
  });

  it("buildReferences forwards picked items' references in pick order", () => {
    const hostItem: AttachmentItem = {
      id: "GET /api/data/todos",
      title: "Show the list",
      reference: { type: "api", value: "GET /api/data/todos", label: "Todos — Show the list" },
    };
    expect(buildReferences([assetItem(LOGO), hostItem])).toEqual([
      { type: "asset", value: "/api/assets/brand/logo.png", label: "logo.png", preview: "https://r2.example/presigned/logo.png?sig=abc" },
      { type: "api", value: "GET /api/data/todos", label: "Todos — Show the list" },
    ]);
  });

  it("is empty when nothing was attached (the composer then omits references)", () => {
    expect(buildReferences([])).toEqual([]);
  });

  it("never builds a screenshot reference — the server appends that itself", () => {
    expect(buildReferences([assetItem(LOGO)]).some((r) => r.type === "screenshot")).toBe(false);
  });
});

describe("clampItems / bounded references", () => {
  const item = (id: string, over = false) => ({
    id,
    title: over ? "t".repeat(5_000) : `Asset ${id}`,
    subtitle: over ? "s".repeat(5_000) : undefined,
    reference: { type: "asset", id } as never,
  });

  it("trims a runaway source list to the cap", () => {
    const many = Array.from({ length: 500 }, (_, i) => item(String(i)));
    expect(clampItems(many)).toHaveLength(ATTACHMENT_ITEMS_MAX);
  });

  it("trims oversized strings inside an item", () => {
    const [only] = clampItems([item("a", true)]);
    expect(only.title).toHaveLength(FIELD_MAX);
    expect(only.subtitle).toHaveLength(FIELD_MAX);
  });

  it("preserves item identity when nothing needs trimming", () => {
    // The picker should not re-render for the common case.
    const items = [item("a"), item("b")];
    const out = clampItems(items);
    expect(out[0]).toBe(items[0]);
    expect(out[1]).toBe(items[1]);
  });

  it("bounds the references a submit can carry", () => {
    const many = Array.from({ length: 100 }, (_, i) => item(String(i)));
    expect(buildReferences(many)).toHaveLength(REFERENCES_MAX);
  });

  it("leaves an ordinary pick list alone, in pick order", () => {
    const picked = [item("z"), item("a")];
    expect(buildReferences(picked).map((r) => (r as unknown as { id: string }).id)).toEqual(["z", "a"]);
  });
});
