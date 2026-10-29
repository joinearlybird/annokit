# Extending attachments: sending context to your own agent

The composer's **+ Attach** panel is generic. It renders `AttachmentSource`s
— you decide what is attachable in your world — and a picked item rides on
the annotation as one `references[]` entry your agent resolves. This is the
end-to-end walkthrough for a host wiring that loop against **its own server
and its own agent**: what to implement, what actually travels, and the one
contract that makes it all work.

The short version of that contract:

> **A reference never grants access — it points at something the agent can
> already reach.** You mint the pointer on the phone; your agent-side prompt
> teaches how to resolve it. Nothing enforces that the two halves agree, so
> you keep them in agreement.

## 1. Point the overlay at your server

The overlay speaks [AnnoKit Protocol v1](./protocol.md)
against one base URL — typically a small HTTP server on the dev machine,
reachable from the device over the same LAN as your bundler:

```tsx
// app/_layout.tsx
import { AnnoKitProvider } from "@joinearlybird/annokit";

export default function RootLayout() {
  return (
    <AnnoKitProvider endpoint="http://192.168.1.20:4788" sessionId="dev">
      <Stack />
    </AnnoKitProvider>
  );
}
```

The minimum routes for this loop: `GET /health` (the protocol handshake),
`POST /sessions/:sid/annotations` (the task itself), and — only if you want
screenshots — `POST /annotations/:aid/screenshot`. Everything else
(comments, threads, `/me` identity) is optional; the overlay fail-softs
around routes you have not implemented.

## 2. Define what "attachable" means in your world

An `AttachmentSource` is one tab of the panel. It lists pickable items, and
each item carries the exact `references[]` entry a pick contributes:

```tsx
import type { AttachmentSource } from "@joinearlybird/annokit";

const designTokensSource: AttachmentSource = {
  key: "tokens",                    // stable — tabs, caching, testIDs
  title: "Design Tokens",           // the tab's name
  emptyText: "No tokens defined",   // shown when list() resolves empty
  async list(transport) {
    // transport.getJson hits YOUR endpoint — any route you like.
    const data = await transport.getJson("/design-tokens");
    const tokens = Array.isArray((data as any)?.tokens) ? (data as any).tokens : [];
    return tokens.map((t: { name: string; value: string; category: string }) => ({
      id: t.name,                   // toggle/dedupe identity
      title: t.name,                // row title and chip text
      subtitle: t.value,            // muted second line
      group: t.category,            // rows sharing a group get one heading
      reference: {                  // what actually rides on the annotation
        type: "token",              // your own type — the union is open
        value: t.name,
        label: `${t.name} = ${t.value}`,
      },
    }));
  },
};
```

Register it on the provider (with or without the built-in asset-library
source):

```tsx
import { assetsSource } from "@joinearlybird/annokit";

<AnnoKitProvider
  endpoint="http://192.168.1.20:4788"
  sessionId="dev"
  attachmentSources={[assetsSource, designTokensSource]}
>
```

Source rules, all fail-soft by contract:

- `list()` resolving empty, rejecting, or hitting an unimplemented route all
  render the same one-line `emptyText` — never an error state, never a
  blocked composer.
- Skip malformed entries rather than guessing at them.
- `reference.value` must be **stable** — a short-TTL/presigned URL belongs
  in `thumbnailUri` (display only), never in the reference.

## 3. What actually travels

The user aims, types, picks attachments, taps **Create Agent Task**. One
JSON body lands on your server:

```jsonc
// POST {endpoint}/sessions/dev/annotations
{
  "id": "…",
  "comment": "use the brand color here",
  "element": "PrimaryButton",
  "source": { "file": "src/Button.tsx", "line": 12 },
  "boundingBox": { "x": 52, "y": 179.7, "width": 62, "height": 17 },
  "x": 120, "y": 340,
  "references": [
    { "type": "token", "value": "color.brand.500", "label": "color.brand.500 = #6D28D9" }
  ]
}
```

If the **Screenshot** switch was on, a second request follows —
`POST /annotations/{id}/screenshot`, multipart field `file`, a PNG. Your
server stores it wherever suits (local disk is fine for a dev tool) and
appends its **own** reference to the stored annotation:

```jsonc
{ "type": "screenshot", "value": "http://192.168.1.20:4788/shots/<id>.png" }
```

The client never builds the screenshot reference — the server does, when
the upload lands.

Note what did **not** happen: no attachment bytes traveled with the
annotation (the screenshot is the one upload). References are pointers.

## 4. Your agent's side: store → surface → teach

Your server holds the annotations; how your agent sees them is your choice
— MCP tools, a watched file, prompt injection. The one non-negotiable piece
is a **prompt sentence per reference type**, because a reference is just a
string until something explains it:

```
Annotations may carry a `references` array. Each entry has a `type`:
- `token` — a design-token name from tokens.json in this repo; look up its
  definition there and use the token, never the raw hex.
- `screenshot` — a URL you can fetch for visual context; never embed it in
  generated code.
```

Every type resolves through a channel the agent already has — pick one when
you design a source:

| channel | how it works | examples |
|---|---|---|
| **repo lookup** | the value names something in the codebase the agent is editing; zero network | `token` above; the reference platform's `api` type (`"GET /api/data/todos"` → its generated manifest) |
| **embed verbatim** | the value *is* the string that belongs in generated code | the built-in `asset` type (`/api/assets/logo.png`) |
| **fetch** | a URL the agent's environment can reach | `screenshot`, `url` |

## 5. The loop closes

The agent reads the annotation, resolves `color.brand.500` against
`tokens.json`, edits `Button.tsx` — and, if you implement the lifecycle
routes (`GET /annotations/:aid`, thread replies, resolve), the overlay's
queue and detail views reflect its progress on the phone.

## The two failure modes to design against

Nothing enforces the mint-side/resolve-side agreement, and both halves fail
silently when they drift:

1. **A source minting values the agent cannot resolve.** The agent just
   shrugs at the reference — no error anywhere. A pointer to a route that
   404s is worse than no reference at all.
2. **Ephemeral URLs in `reference.value`.** A presigned URL that expires
   turns a stored annotation's context into a dead link. `thumbnailUri` is
   where short-TTL display URLs go; `value` is forever.

The wire contract lives in the protocol's
[References (attach panel)](./protocol.md#references-attach-panel) section.
