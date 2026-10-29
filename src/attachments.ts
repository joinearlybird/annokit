/**
 * Attachments — the data side of the composer's "Attach" panel.
 *
 * OPEN BY DESIGN. The panel renders `AttachmentSource`s: a source lists
 * pickable items, a picked item contributes one `references[]` entry to the
 * annotation. The package ships ONE built-in source — the app's asset
 * library (`GET /assets`, part of the AnnoKit Protocol) — and hosts
 * extend the panel by passing more sources to `<AnnoKitProvider
 * attachmentSources={…}>`. Anything platform-specific (a data-API manifest,
 * a design-token catalog, a CMS) belongs in a host-supplied source, not in
 * this package.
 *
 * `references[]` is a wire contract the consuming agent reads, so the
 * construction stays out of the RN components (same reason as payload.ts):
 * drift here is a protocol break, not a styling change.
 *
 * Everything degrades to an empty picker rather than failing: an older
 * server may not implement `/assets` at all, a host source may reject — and
 * neither may block or crash the overlay.
 */

import {
  ATTACHMENT_ITEMS_MAX,
  clampList,
  clampText,
  FIELD_MAX,
  REFERENCES_MAX,
} from "./limits";

/**
 * One entry of an annotation's `references[]` — advisory context the
 * consuming agent resolves alongside the comment.
 *
 * `"screenshot" | "url" | "asset" | "api"` are the types the protocol
 * already teaches agents about; host sources may mint their own (the string
 * union is deliberately open). The server appends `{type:"screenshot"}`
 * itself when a screenshot upload lands — composers never build that one.
 */
export interface AnnotationReference {
  type: "screenshot" | "url" | "asset" | "api" | (string & {});
  value: string;
  label?: string;
  /**
   * Where the agent can open the thing to look at it, when that is not
   * `value` itself: a path in its checkout, a URL, `s3://…`. Optional and
   * additive (docs/assets.md). `value` stays what goes in code.
   */
  open?: string;
  /**
   * An image URL a person can be shown, for an asset that is a picture —
   * the server's `previewUrl` (docs/assets.md). Display only, like the
   * thumbnail in the picker; the agent uses `value` and `open`.
   */
  preview?: string;
}

/**
 * One pickable row of the attach panel, whatever its source.
 *
 * `id` is the toggle/dedupe identity (an asset's public path, an endpoint's
 * value…); `reference` is what actually rides on the annotation when the
 * item is picked. Everything else is presentation.
 */
export interface AttachmentItem {
  id: string;
  /** Chip text and row title. */
  title: string;
  /** Muted second line under the title, when there is one. */
  subtitle?: string;
  /** Optional thumbnail (short-TTL preview URLs are fine — display only). */
  thumbnailUri?: string;
  /** Rows sharing a `group` render under one heading, in list order. */
  group?: string;
  /** The wire entry a pick contributes. */
  reference: AnnotationReference;
}

/**
 * One tab of the attach panel. `list` is called when the panel opens and
 * must resolve (empty on failure — fail-soft, no error UI to get stuck in).
 */
export interface AttachmentSource {
  /** Stable key — testIDs and list caching hang off it. */
  key: string;
  /** Tab title. */
  title: string;
  /** The one-line copy shown when `list` resolves empty. */
  emptyText: string;
  list(transport: AttachmentTransport): Promise<AttachmentItem[]>;
}

/**
 * An asset from the app's library (`GET /assets`).
 *
 * `publicPath` is the stable `/api/assets/{path}` URL that belongs in
 * generated code — that, never `previewUrl`, is what a reference carries.
 * `previewUrl` is a short-TTL presigned URL for on-device display only
 * (images only; absent for other file types).
 */
export interface AssetItem {
  path: string;
  name: string;
  publicPath: string;
  /** Where the agent can open it (docs/assets.md); becomes the reference's `open`. */
  agentPath?: string;
  previewUrl?: string;
  contentType?: string;
  size?: number;
  uploaded?: string;
}

/**
 * The transport surface sources need (keeps tests dependency-free).
 * Deliberately non-generic — bodies are validated by each source, not typed
 * at the call site, because they come from a server on another branch.
 */
export interface AttachmentTransport {
  getJson(path: string): Promise<unknown>;
}

/** Protocol route: the app's asset library. */
export const ASSETS_PATH = "/assets";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * `GET /assets` → the asset library, or `[]` on any failure/garbage.
 *
 * Never null: the picker distinguishes "loading" from "loaded and empty"
 * with its own state, and a failed fetch shows the same empty copy as a
 * genuinely empty library.
 */
export async function fetchAssets(transport: AttachmentTransport): Promise<AssetItem[]> {
  const data = await transport.getJson(ASSETS_PATH);
  const list = isRecord(data) ? data.assets : null;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (a): a is AssetItem =>
      isRecord(a) && typeof a.publicPath === "string" && typeof a.name === "string",
  );
}

/** `asset` reference: the STABLE public path, never the presigned preview. */
export function assetReference(asset: AssetItem): AnnotationReference {
  const open = typeof asset.agentPath === "string" && asset.agentPath.trim()
    ? clampText(asset.agentPath.trim(), FIELD_MAX)
    : undefined;
  const preview = typeof asset.previewUrl === "string" && /^https?:\/\//i.test(asset.previewUrl.trim())
    ? clampText(asset.previewUrl.trim(), FIELD_MAX)
    : undefined;
  return {
    type: "asset",
    value: asset.publicPath,
    label: asset.name,
    ...(open ? { open } : {}),
    ...(preview ? { preview } : {}),
  };
}

/** An asset, as the generic panel renders it. */
export function assetItem(asset: AssetItem): AttachmentItem {
  return {
    id: asset.publicPath,
    title: asset.name,
    subtitle: asset.publicPath,
    thumbnailUri: asset.previewUrl,
    reference: assetReference(asset),
  };
}

/** The built-in source: the app's asset library. */
export const assetsSource: AttachmentSource = {
  key: "assets",
  title: "Assets",
  emptyText: "No assets yet",
  async list(transport) {
    return (await fetchAssets(transport)).map(assetItem);
  },
};

/**
 * The `references[]` the composer sends: picked items in pick order. The
 * screenshot reference is NOT included — the server appends
 * `{type:"screenshot"}` itself when the multipart upload lands.
 */
export function buildReferences(picked: readonly AttachmentItem[]): AnnotationReference[] {
  // Bounded on the way out as well as in: a host driving the headless API
  // can pick programmatically, and the wire body is what a server has to
  // store (src/limits.ts).
  return clampList(picked, REFERENCES_MAX).map((item) => item.reference);
}

/**
 * Trim one source's contribution to the picker.
 *
 * Both the count and each item's strings: a source is host code reading a
 * server, and neither end is trusted to be bounded. Item identity is
 * preserved when nothing needs trimming, so the picker does not re-render
 * for the common case.
 */
export function clampItems(items: readonly AttachmentItem[]): AttachmentItem[] {
  return clampList(items, ATTACHMENT_ITEMS_MAX).map((item) => {
    const title = clampText(item.title, FIELD_MAX);
    const subtitle = item.subtitle === undefined ? undefined : clampText(item.subtitle, FIELD_MAX);
    const group = item.group === undefined ? undefined : clampText(item.group, FIELD_MAX);
    // Identity preserved when nothing needed trimming, so the common case
    // does not re-render the picker.
    if (title === item.title && subtitle === item.subtitle && group === item.group) return item;
    return {
      ...item,
      title,
      ...(subtitle === undefined ? {} : { subtitle }),
      ...(group === undefined ? {} : { group }),
    };
  });
}

/** The slice of the transport an upload needs. */
export interface AssetUploadTransport {
  postFormAt<T = unknown>(path: string, form: FormData): Promise<{ status: number; data: T | null }>;
}

export type AssetUpload =
  | { ok: true; asset: AssetItem }
  /** "unsupported": the server takes no uploads (404, 405); "failed": anything else. */
  | { ok: false; reason: "unsupported" | "failed"; status: number };

/**
 * `POST /assets` with one local image file (docs/assets.md) — how a pasted
 * image becomes an asset the agent can open. The answer is the asset, whose
 * reference then rides on the task like a picked one.
 */
export async function uploadAsset(
  transport: AssetUploadTransport,
  file: { uri: string; name: string; type: string },
): Promise<AssetUpload> {
  const form = new FormData();
  // React Native's multipart part: a file descriptor, not a Blob.
  form.append("file", { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  const { status, data } = await transport.postFormAt(ASSETS_PATH, form);
  if (status >= 200 && status < 300 && isRecord(data) && typeof data.publicPath === "string" && typeof data.name === "string") {
    return { ok: true, asset: data as unknown as AssetItem };
  }
  return { ok: false, reason: status === 404 || status === 405 ? "unsupported" : "failed", status };
}
