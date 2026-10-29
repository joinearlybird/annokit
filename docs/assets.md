# Assets

How an app's assets reach a task: listed in the composer's **+ Attach →
Assets**, attached as a reference, and used by the agent. The protocol half
is in [protocol.md](./protocol.md#references-attach-panel); this page is the
design behind it and how the example servers implement it.

## Who needs what

An asset has three readers, and each needs something different:

| Reader | Needs | Field |
|---|---|---|
| The app's Attach picker | a list, and a thumbnail it can load | `GET /assets` → `previewUrl` |
| The agent, writing code | the string to put in code | the reference's `value` (`publicPath`) |
| The agent, looking at it | somewhere it can open the file | the reference's `open` (`agentPath`) |

`value` and `open` are often the same string, but not always:

| Where assets live | `value` (in code) | `open` (to look) |
|---|---|---|
| The app's own folder | `assets/images/logo.png` | `assets/images/logo.png`, a path in the agent's checkout |
| A CDN | `https://cdn.example.com/logo.png` | the same URL |
| S3, private | whatever the app's code uses for it | `s3://bucket/key`, for an agent with S3 access (an MCP server, say) |

A server that cannot give the agent a way in leaves `open` out. The agent
then has the name and `value` only, which is still enough to write code
against.

## Routes

All optional. A server without them leaves the Assets tab empty, and
nothing else in the overlay depends on them.

- `GET /assets` → `{"assets": [Asset], "writable"?: boolean}`
- `POST /assets` (multipart, one `file` part) → `201 Asset`. Optional; a
  read-only store answers `405`.
- `DELETE /assets/<path>` → `204`. Optional, as above.

```jsonc
{
  "path": "uploads/logo.png",          // the store's own key
  "name": "logo.png",
  "publicPath": "assets/uploads/logo.png", // what code uses; becomes the reference's value
  "agentPath": "assets/uploads/logo.png",  // where the agent can open it; becomes `open`
  "previewUrl": "http://…/assets/raw/uploads/logo.png", // display only; images only
  "contentType": "image/png",
  "size": 18234,
  "uploaded": "2026-10-28T12:00:00.000Z"
}
```

A picked asset becomes:

```jsonc
{ "type": "asset", "value": "assets/uploads/logo.png", "label": "logo.png", "open": "assets/uploads/logo.png" }
```

`open` is additive. A server that does not know it ignores it, and
`protocolVersion` stays 1.

## The agent must be told

A reference the agent never sees does nothing. A server that runs an agent
puts every reference into its prompt, with how to use each type:

```
ATTACHED:
  asset logo.png: use "assets/uploads/logo.png" in code; open assets/uploads/logo.png to see it
  link: https://example.com/spec
  data API: GET /api/data/todos (Todos — Show the list)
```

## The store, behind the routes

A server keeps the rules in one place and the storage behind an interface,
so the same routes can sit in front of a folder, a bucket or anything else:

```ts
interface AssetStore {
  kind: string;      // "local", "s3", …
  writable: boolean; // false: POST and DELETE answer 405
  list(): Promise<Asset[]>;
  read?(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  put?(name: string, bytes: Uint8Array, contentType: string): Promise<Asset>;
  remove?(path: string): Promise<boolean>;
}
```

The server, not the store, owns what every store needs: refusing paths
that leave the store (`..`, absolute paths, symlinks out), checking an
upload's type from its bytes rather than its claimed type, size limits,
and serving previews with `X-Content-Type-Options: nosniff` and a
`Content-Security-Policy` that runs nothing.

## The example servers

Both use a **local store**: the app's own `assets/` folder. Assets there are
files in the agent's checkout, so it can open them and `require()` them, and
a new one hot reloads like any other edit.

| | Package stub (`npm run server`) | `annotate-namespace-example` |
|---|---|---|
| Lists | the app's `assets/` folder | the same |
| Adds | files you put in the folder, and images pasted into the app's composer | the same, plus uploads in the web panel; delete there too |
| Uploads | saved to `assets/uploads/` only; PNG, JPEG, GIF and WebP, checked from the bytes | the same |
| Previews | raster images, served by the stub | the same |

## Pasting an image

With `expo-paste-input` in the app, an image pasted into the composer
(Cmd+V on the simulator, which shares the Mac's clipboard) shows as a chip.
When the task or note is sent it is uploaded with `POST /assets`, lands in
`assets/uploads/` as `pasted-<date>-<time>.png`, and rides on the task as an
`asset` reference — so the agent gets its path, can open it, and can use it
in code. Nothing is uploaded until the send: a composer dismissed with an
image in it leaves nothing behind.

Not covered yet: S3 and other remote stores (an agent with its own access
can already be pointed at them through `open`), and anything but images in
the upload.
