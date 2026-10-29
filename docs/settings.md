# Settings

The toolbar's **Settings** button opens a panel of session preferences.
**Nothing here is persisted** — the package takes no storage dependency for
a dev overlay — so a reload returns to whatever the host app passed as
props. Everything is a plain HTTP-free local choice; none of it is sent
anywhere.

**Theme — System / Light / Dark.** *System* follows the phone
(`useColorScheme`), and an OS with no opinion resolves to dark. Every
surface honours it: sheets, panels, chat bubbles, markers, the toolbar, the
aim chrome and the confirm bar. The two destination colours are retuned per
theme rather than reused — a blue bright enough to read on near-black is a
smudge on white — so blue and orange stay legible in both. Text that
belongs to the team (the Comment button, a note's status, "From a team
note") is drawn in the ordinary text colour rather than orange, which read
as brown on white; the orange stays on the markers, outlines and icons.

**Marker colours.** One curated swatch row per kind: **Agent tasks**
(default blue) and **Team notes** (default orange), seven hues each, every
one defined for both themes. The single rule: the two kinds may not be the
SAME colour — that collapses the distinction the colour exists to draw — so
a hue already taken by the other kind is shown disabled. Near neighbours
are your business.

**Text colour — Neutral, Slate, Stone, Navy, Forest, Plum, High contrast.**
The colour of the overlay's type, from its headings down to its faintest
summaries, picked from a swatch row like the marker colours. The options
are inks, not the bright marker hues: two tinted greys, three deep colours
that read as near-black (near-white in dark) with a cast, and *High
contrast*, which moves the entire ramp toward black (white, in dark). Each
is a whole ramp defined for both themes, and every step of every ramp
clears 4.5:1 against the surfaces it sits on, so none of them can make text
unreadable. The chosen name is drawn in its own colour above the row.
Surfaces, lines and the marker colours stay as they are.

**Agent** — which agent runs your tasks, on which model and at what effort,
when the server offers it (the optional [`/agent` routes](./protocol.md#agent-optional)).
This is the full view of the composer's agent pill, whose menu offers each
signed-in agent's default and first few models, lists agents that are
installed but not signed in with a red dot, keeps an effort slider fixed at
its bottom, and has a gear that opens this page. This page shows where
the agent stands, every agent the server knows (ones not installed or not
signed in are shown, disabled) and every model the chosen agent's own CLI
reports, once each, the one it uses by default tagged **Default**; tapping
an agent scrolls to its models. The
effort slider is pinned to the bottom of the sheet, with the chosen model's
own levels (Claude Code, Codex).
The refresh icon in the header asks the server to look for newly installed
agents. The choice rides on each task you create, for this session; with
nothing chosen, tasks run on the server's current agent. A task already
running keeps the agent it started with.

**Output detail** — how much context leaves your app with an agent task.

| Level | What the annotation body carries |
|---|---|
| **Minimal** | `id`, `comment`, `kind`, `platform`, `element`, `routeName`, `x`/`y`, `boundingBox`, `scroll`, `references` |
| **Standard** (default) | …plus `source` (file + line), `testID` and `nearbyText` |
| **Full** | …plus `componentStack`, `computedStyles` and `accessibility` |

The first row is never a choice: an annotation nobody can locate is not a
lighter annotation.

**Why the on-screen text is in the default.** `source` points at where a
component is *defined*, but a reusable component gets its words from where
it is *used*: `PrimaryButton.tsx` holds `{label}`, while "Save changes" sits
at the call site. The rendered text is what tells the agent *which* button
you meant, and grepping for it lands on the one line to edit — for runtime
text such as a name or a price, it is the only record of what was on screen.
It is still on-screen content, so **Minimal** strips it: choose that level
when what your screen shows should stay on the device. At the trimmed levels `componentStack` is sent empty
(the protocol requires the field) and the omitted optionals are absent.

**This session.** *Clear queue after sending* drops handed-over tasks from
the queue instead of leaving them in it. *Hide the overlay* removes it
entirely — FAB, markers and all — **until you restart the app**, which the
row says out loud because there is deliberately no gesture back in. A
floating button costs more on a phone than it does on a desktop.

**You.** The name your team notes are signed with. Editable only when it is
a name THIS device chose (or when nothing has claimed you yet): an identity
from the host `author` prop, from the server, or from the preview
environment is shown read-only with one line saying where it came from —
letting you type over it would be a lie, since the next message would come
back in the real name anyway. See [Who you are](./protocol.md#who-you-are).

**Diagnostics** (read-only). The package version, the *negotiated*
`protocolVersion` (or "not negotiated" before the handshake answers), the
endpoint **host** — never the token, never the path or query a capability
URL may hide in — and whether each device-feature peer resolved
(`react-native-svg`, `react-native-view-shot`, `expo-sensors`, `expo-paste-input`).
