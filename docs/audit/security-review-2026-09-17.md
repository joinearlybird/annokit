# Security review — 2026-09-17

Baseline: `b8af79cedaa64027559dbd94ad7e5123fe4e1918`, with the current working tree inspected. An existing change to `docs/audit/open-source-readiness.md` was left untouched. No application code or dependencies were changed during the initial audit; the subsequent remediation is recorded below.

## Scope and result

Reviewed dependency advisories, transport/authentication, URL construction, development activation, screenshot handling, payload privacy, server-response handling, and existing security documentation. This is a React Native client library; backend authorization, deployed endpoints, consumer builds, and native platform behavior were not penetration-tested.

`npm audit --json` returned **zero known vulnerabilities** across 304 reported dependencies. All **1,099 tests in 50 files passed**, and `npm run check` passed. These results do not establish that the implementation is vulnerability-free or cover optional peers absent from this installation. No critical issue was confirmed.

The principal findings are two implementation defects and one configuration-dependent transport risk. Severity reflects the development-only deployment model and stated prerequisites.

## 1. Medium — Redirect rejection happens after the request body is disclosed

Locations: `src/transport.ts:188–199`, `src/transport.ts` multipart `xhr.onload`, and `src/events.ts` stream response-origin check.

The fetch request follows redirects by default. Only after it completes does `originIsIntact()` compare the final origin. A 307/308 redirect can replay the original POST body at another origin before this guard returns null. Checking the upload's `responseURL` in `onload` has the same timing limitation; native replay behavior still requires device verification.

**Prerequisite:** a configured endpoint or its proxy returns a redirect, whether through misconfiguration, an open redirect, or compromise. This is not a claim that an unrelated attacker can redirect correctly authenticated HTTPS traffic.

**Evidence:** invoked the actual `AnnoKitTransport.postJson()` through Node 24.7.0 against two local HTTP servers using a synthetic token and annotation. The first server returned 307 to the second port. The second received `POST` with `{"comment":"SYNTHETIC_PRIVATE_ANNOTATION"}`; the library then logged `refused: cross-origin redirect` and returned null. Authorization was stripped in this reproduction: this proves **body disclosure**, not bearer-token replay. HTTPS encryption alone would not prevent replay to a different HTTPS destination.

**Fix:** reject redirects before following them. Use `redirect: "error"` where supported and verified; use native transport support that actually disables redirects for RN fetch/XHR paths. The final-origin comparison may remain as defense in depth but is not a disclosure-prevention control. Verify 301/302/303/307/308, cross-origin, and downgrade behavior on iOS, Android, and web for JSON, multipart, and SSE. Until that is enforced, configure servers/proxies to serve these routes directly and describe the residual limitation accurately.

Reference: [Fetch Standard, HTTP-redirect fetch](https://fetch.spec.whatwg.org/#http-redirect-fetch). The standard's redirect processing preserves request bodies for 307/308; cross-origin authorization stripping does not remove those bodies.

## 2. Medium — JSON body consumption escapes timeout and disposal

Locations: `src/transport.ts:197–199`, `src/transport.ts:212–228`; also used by POST, PATCH, and status-bearing GET.

`request()` clears its timer and removes the abort controller from `inflight` immediately after fetch resolves. With a streaming Fetch implementation, that happens when response headers arrive. `res.json()` runs afterward, outside the timeout and disposal lifecycle. A server can send headers and an incomplete body, leaving a handshake/read/mutation pending indefinitely. An arbitrarily large body is also parsed without a transport byte limit.

**Prerequisite:** a malicious, broken, or stalled server/proxy and a Fetch implementation that resolves on headers. This is primarily an availability/resource-exhaustion risk; existing provider sequencing mitigates some stale UI updates but does not cancel body consumption.

**Evidence:** the actual transport was configured with a 50 ms read timeout. A local server flushed headers and a partial JSON body immediately, then completed the body after 350 ms. Calling `dispose()` at 100 ms did not cancel the read: it returned `{ "ok": true }` at 355 ms. A body that never completes can stay pending indefinitely. This was verified under Node Fetch, not separately on each native stack.

**Fix:** keep the controller registered and timeout active until response consumption finishes; dispose must cancel that entire operation. Bound received bytes before parsing, and validate/cap returned collections and strings. Add integration tests that flush headers then stall, exceed a body limit, or complete after disposal; mocks that resolve an already-buffered response miss this issue.

## 3. Medium — Remote plaintext endpoints accept credentials and captures

Locations: `src/env.ts:108–119`, `src/transport.ts:115–118`, and `src/events.ts` request setup.

Configuration requires only a nonempty endpoint and session ID. There is no scheme/host restriction before bearer headers and payloads are sent. A non-loopback `http://` endpoint therefore transmits credentials, annotations, and screenshots unencrypted on platforms that permit cleartext traffic. Capability URLs are credentials too. README already acknowledges this risk; documentation is not enforcement.

**Prerequisite:** a host configures remote HTTP and the runtime permits it. An observer or active attacker on that network path can read or modify traffic. The development gate limits exposure to development builds but does not protect their contents.

**Fix:** require HTTPS by default; permit narrowly validated loopback HTTP for local development. If LAN HTTP is necessary, require an explicit insecure-development option and a safe warning. Apply the same policy to every transport, and reject unsupported schemes. Do not rely on platform-specific cleartext defaults.

## Additional low-severity hardening

**Dot-segment resource IDs escape their intended route segment.** `src/url.ts:33–34`, `src/pending.ts:23–24`, and other direct `encodeURIComponent(id)` builders accept `.` and `..` unchanged. For example, `deleteAnnotationPath("..")` yields `/annotations/..`, which a standard URL parser normalizes to `/`. With an endpoint prefix it targets that prefix's parent resource rather than the intended annotation. A server-supplied malicious ID plus a user action could cause an authenticated request to an unintended same-origin route. Whether that route does anything destructive depends on the backend; no backend exploit was demonstrated. Reject empty and exact dot-segment IDs centrally and use the validator at every resource route. Percent-encoding dots alone is insufficient because URL parsers can normalize encoded dot segments too.

## Existing controls and limits

- The provider configuration has an absolute `__DEV__` activation gate.
- Transport failures redact endpoint paths/query credentials and raw errors.
- Screenshot capture is opt-in, with explicit lifecycle cleanup paths.
- Default payload detail omits component stacks, styles, and accessibility context. It no longer omits nearby text — see the revision below.
- Endpoint/session changes reset runtime state and dispose old transports.
- Client IDs are documented as identifiers, not authorization credentials.

These controls were inspected in source and covered by the existing suite, not reverified on devices during this review. The older audit already documents incomplete native redirect verification; the body-replay reproduction above clarifies why a post-response guard is insufficient. No backend access-control review, full Git-history secret scan, production-bundle inspection, or native dependency/CocoaPods/Gradle advisory scan was performed. Consumer applications must be audited separately.

Recommended order: prevent redirect replay; extend cancellation and bounds through body consumption; enforce endpoint transport policy; reject dot-segment IDs. Keep focused regression tests for each change.


## Remediation — revised after compatibility review

The user explicitly accepted the residual redirect risk for servers they
configure and control. The proposed Expo-only transport was removed.
There is **no new Expo or expo-file-system dependency**, and neither module
is imported by the transport. Native screenshots retain their existing RN
file descriptors, and uploads and event streams retain XHR.

Implemented protections retained:

- JSON deadlines and disposal cover response body consumption, including
  non-streaming React Native responses. Cancellation also settles callers
  if an adapter ignores abort.
- JSON is limited to 4 MiB before parsing. Streaming runtimes enforce the
  limit while reading; buffered RN fetch necessarily allocates the response
  first, so this does not bound native network buffering.
- Native multipart uploads have native and JavaScript deadlines and settle
  on disposal even if the XHR implementation fails to emit an abort event.
- Endpoint structure is validated before protocol I/O: non-HTTP schemes,
  malformed authorities, impossible ports and whitespace cannot dispatch.
  HTTPS is **not** enforced — see the revision to finding 3 below.
- Shared resource-ID handling and URL validation prevent empty, dot-segment,
  control-character, and unencodable IDs from dispatching requests.

Redirect status: **accepted residual risk, not fully remediated**. Fetch
requests retain best-effort `redirect: "error"` for runtimes that enforce it.
XHR and RN fetch can still follow redirects before the final-origin checks.
Servers and their proxies must serve final protocol URLs without redirects.
No optional Expo mode was added.

Validation includes the full suite and TypeScript, local HTTP regressions
for standard Fetch redirects and stalled/chunked bodies, buffered native
response doubles, and native XHR upload/SSE lifecycle tests. Native device
integration was not rerun. Backend security remains outside this review.

## Revision — finding 3 reconsidered, 2026-09-17

Finding 3 proposed requiring HTTPS with a narrow loopback exception, and
that was implemented and has now been reverted in part. Enforcement refused
plaintext HTTP to any non-loopback host, which breaks a legitimate and
common development workflow: a physical device reaching a stub server on
the developer's machine over the LAN, since a device cannot resolve the
host's loopback. The finding did not weigh that cost.

The endpoint is chosen by the adopter, not by an end user, and the overlay
is absolutely gated behind `__DEV__`. Refusing the request does not secure
the network; it moves the developer to a workaround the package cannot see.

**Current policy:** `safeEndpoint` validates structure only — scheme,
authority, port, no whitespace. `plaintextRemote` identifies HTTP to a
non-loopback host, and `resolveAnnoKitConfig` warns once, naming the
bearer token and screenshots explicitly. The overlay still activates.

**Residual risk, accepted:** on a plaintext remote endpoint the bearer
token, annotations and screenshots cross the network unencrypted, readable
and modifiable by anyone on that path. This is the adopter's decision,
made visible rather than prevented. Findings 1 (redirect) and 3 are now
both accepted residual risks; finding 2 (body lifecycle) and the
low-severity dot-segment item remain remediated.

## Revision — nearby text moves to the default, 2026-09-22

The "existing controls" list above originally claimed that the default
Output Detail level omits nearby text. That is no longer true, deliberately.

`nearbyText` now rides at **Standard**. `source` identifies where a component
is defined, but a reusable component receives its text from where it is
used, so the definition file cannot tell an agent which instance was meant —
the rendered text can, and it doubles as a search key that locates the call
site. For runtime text it is the only record of what was on screen. The
composer's quote picker, which let a user send a slice of the same text at
any level, was removed in the same change; the field it produced
(`selectedText`) is no longer sent by this client.

**Residual risk, accepted:** at the default level, text visible on the
touched element — which can include names, email addresses or account
details — leaves the device with an agent task. **Minimal** still strips it,
at the body and per element, and a test now asserts the per-element case so
a multi-select cannot reintroduce the leak at that level.

