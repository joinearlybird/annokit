# Security and privacy

## Credentials and transport

**`EXPO_PUBLIC_*` values are not secrets.** Metro inlines them into the
JavaScript bundle at build time, so anything passed that way — the
endpoint, the session id, `EXPO_PUBLIC_ANNOKIT_TOKEN` — ships inside the
app and can be read out of it. That is fine for what they are: local
development wiring for a build that cannot reach a store. It is not fine
for a credential you would mind seeing in a bundle. The same applies to the
`token` prop; there is no safe place in a client for a long-lived secret.

So: **prefer short-lived, narrowly scoped, revocable credentials** — a
token good for one session on one endpoint, expiring in hours rather than
months, revocable without redeploying anything. If your server treats the
endpoint itself as the capability (see [Server obligations](./protocol.md#server-obligations)), the same
rules apply to the URL, because it *is* the credential.

**Use HTTPS off the local machine.** The package does not force it. You
choose the endpoint, the overlay only runs under `__DEV__`, and plaintext
HTTP to a LAN address is how a physical device reaches a stub server on
your laptop — refusing it would break that workflow to protect you from
your own choice. What the package does instead is say so once, at config
time: a bearer token over plaintext is a token you have given away, and
the same is true of any screenshot. Endpoints that cannot be a protocol
URL at all — a non-HTTP scheme, a malformed authority, an impossible port
— and invalid session IDs still disable the overlay with a redacted
warning.

**What `__DEV__` does and does not protect.** The gate is absolute: no
endpoint, no props and no environment variable can activate the overlay in
a production bundle, so a shipped app carries no annotation UI and makes no
protocol requests. What it does *not* do is protect the data a development
build sends. A dev build pointed at a real endpoint uploads real
screenshots of whatever is on screen and real annotation text, over
whatever transport you configured, to whoever can read that server. Point
development builds at development servers.

## What a screenshot contains

On native, a capture is a **file** in the OS temp directory, and it holds
the whole screen — not just the element you selected. That can include
notifications, another app's content behind a transparent surface,
credentials in a field mid-type, and any personal data on the page.

**Nothing is captured until you ask for it.** The **camera** button in the
composer's icon row is what takes the shot: tap it and the sheet — and the
keyboard, if it is up — step out of the way for a beat while the screen
underneath is captured, so what the agent sees is the app rather than our
chrome on top of it. Never tap it and no capture is ever written to disk.

What you took appears as a chip beside your other attachments. Tap the chip
to see the capture full size before you send it; tap its ✕ (or the camera
again) to remove it, which **deletes the file** rather than keeping it
withheld. Worth opening at least once on a screen with anything sensitive
on it: the shot is the whole screen, and a chip is too small to show you
what came along with it.

The package deletes the file at every exit — dismissal, either kind of
submit (after the upload, when there is one), a failed capture, and
provider teardown — so a cancelled or text-only flow leaves nothing behind.
A failed submit keeps it, because the sheet is still open and a retry needs
it. Hosts driving the headless API own the URI while they hold it and get a
`releaseScreenshot()` helper ([headless-capture.md](./headless-capture.md)).

Screenshots are only ever sent to the endpoint you configured.

## Where a screenshot lives

**This package is not storage, and deliberately not.** It captures, hands
the bytes to your endpoint, and forgets them. Everything after the upload —
where the file sits, who may read it, how long it is kept, how a deletion
propagates — is yours to decide, because it is your data on your
infrastructure and only you know what it is worth.

What the client does, and all it does:

| | |
|---|---|
| **On the device (native)** | a PNG in the OS temp directory. The bytes never enter JS memory — the upload streams the file off disk — and the file is deleted on every exit: dismissal, either submit (after the upload lands), a failed capture, turning the camera off, provider teardown. A failed submit is the one case that keeps it, so a retry still has one. |
| **On the device (web)** | a `data:` URL held in memory until it becomes a Blob for the upload. Nothing touches disk, and the GC owns it. |
| **In transit** | one `multipart/form-data` `file` part to `POST /annotations/:aid/screenshot` or `POST /comments/:id/screenshot`. |
| **After that** | nothing. The client keeps no copy, no cache, no index, and never reads a screenshot back. |

So the retention question is not one this package answers or can answer.
[Server obligations](./protocol.md#server-obligations) states what a server implementing the protocol
has to decide — verification, limits, access, retention, deletion, audit —
and it is written that way because those are policy calls, not defaults a
dev-tooling client should be making on your behalf.

## What the package logs

Every request has a ceiling (`timeouts`, see [Configuration](./configuration.md)), and every failure is logged
and swallowed rather than thrown. Because **the endpoint may itself be the
credential** — some servers treat an unguessable capability URL as the
authentication — a failure line names only the method, the endpoint's
**host**, and a route label with ids replaced:

```
[annokit] GET sandbox.example /sessions/:id/pending — HTTP 500
[annokit] POST sandbox.example /annotations/:id/screenshot — timeout after 30000ms
```

Never logged: the full URL, the capability path or query, userinfo, the
bearer token, request bodies, response bodies, or the raw error object (a
runtime may hang the request URL off the `Error` it throws). The settings
panel applies the same rule and shows only the host.

**Redirects and trusted servers.** Configure an endpoint you control, and
serve protocol routes directly without redirects. Standard React Native
networking is supported without requiring Expo or expo-file-system. JSON
fetch requests ask the runtime to reject redirects where supported, but
React Native's XHR-backed fetch may ignore that setting; screenshot uploads
and event streams use XHR, which cannot block redirects before following
them. The final-origin check rejects cross-origin responses **after** the
request, so it cannot prevent a redirected request body from being disclosed.
This residual risk is accepted for the trusted, user-configured server model.

**Response limits.** JSON deadlines and cancellation remain active through
body consumption. JSON larger than 4 MiB is rejected before parsing. On
streaming fetch runtimes the limit is enforced while reading; standard RN
fetch buffers the response first, so the limit cannot bound the native
networking layer's initial allocation. Native uploads have both a native
and JavaScript deadline and are cancelled on disposal. Empty, dot-segment,
control-character, and unencodable resource IDs cannot dispatch a request.
