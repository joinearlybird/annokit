# How it works

The design choices behind the overlay, and what each surface looks like.

## Design choices

- **One mark, two destinations — chosen at the end.** You never pick a mode
  before aiming. Mark something, write the sentence, then tap the commit
  that names the destination: **Comment** (outlined, the team's orange) or
  **Create Agent Task** (filled, the agent's blue). The tap that chooses is
  the tap that sends — no selector, nothing behind a menu. This is the same
  model as the web overlay, which has always had one popup and one composed
  decision rather than two arming modes.
- **Words that name the audience, not the data type.** "Annotation" and
  "comment" are synonyms to anyone who has not read this file, so the UI
  never uses them: it says **agent task** and **team note** everywhere — in
  the composer, the list, the markers and the detail panes. (The wire
  format is unchanged: `annotation` and `comment` are still what the server
  stores.)
- **Aim highlighting.** Armed, the element under your finger is outlined
  and named as you touch it, and you can drag to survey before you commit.
  A finger has no hover, so the gesture provides one.
- **Select, then compose.** Releasing leaves a persistent highlight and an
  "Annotate" button; tapping another element moves the selection. Nothing
  is captured until you confirm.
- **A composer that does not hide its subject.** The composer is a bottom
  sheet, so the highlighted element and its name stay visible above it
  while you type.
- **Real component identity.** The name is the nearest user component
  (`PrimaryButton`, not `View`), symbolicated to its definition site.
- **A picture goes to either; references go to the agent.** The screenshot
  rides along with an agent task or a team note — "look at this" is most of
  what a note is for. Picked `references` ride with a task only: a
  reference is context for something that will ACT on it. The controls stay
  put either way — they never jump in and out as you lean toward one commit
  or the other.
- **A queue that is one job.** The panel behind **Queue** is the
  send-to-the-agent workflow: agent tasks, a checkbox each, and one button
  that names what it will hand over. No badges, because every row is the
  same kind of thing. Its **Done** tab lists the tasks the agent has
  finished, newest first, each named by the title its agent gave it and with how its last run went ("Codex ·
  gpt-5.6-terra · high — Done · 2 files · 1m 40s"); open one to see every
  run above its thread.
- **Every team note, from every screen.** **Comments** opens the notes list —
  grouped by route with the screen you are on first, settled ones dimmed —
  and tapping one TAKES YOU TO IT: same screen, it opens; another screen, the
  overlay navigates there (expo-router, optional) and then opens it, with the
  marker pulsing on arrival.
- **Markers you can open.** Every mark leaves a dot where it was made — a
  blue numbered circle for an agent task, an orange quote square for a
  team note (both colours are yours to change — see [Settings](./settings.md)). Tap one to read it, reply, resolve or delete. Armed, the dots
  go inert so aiming still reaches the app.
- **One detail pane.** Both kinds open the same sheet — a grabber, then a
  stacked header, differing only in the kind named at the top and the
  actions that apply. The eyebrow line is a coloured dot and the kind in
  uppercase (**AGENT TASK** / **TEAM NOTE**, with the note's lifecycle as a
  quiet pill beside it), the element name sits big on its own line under it,
  and one context row closes the header: the source as a monospace chip —
  `_layout.tsx:7` — with the screen name beside it, dropped entirely when
  the server recorded neither. A team note adds **Create agent task**,
  which turns a discussion into work.
- **A task is an artifact, so it looks like one.** Wherever a task is read —
  the note's **Tasks** tab, the task's own pane — it is a card: what was
  asked, and under it, quieter and behind a rule, the discussion it came out
  of.
- **A button that gets out of the way — and shows its hand.** Drag it
  anywhere; it snaps to the nearer side and stays there for the session.
  Tapping it expands a small toolbar (**Annotate**, **Queue** with the
  pending count, **Comments** with the open-note count, **Settings**,
  **Close**) that
  opens inward from whichever edge it is parked on, so no action is hidden
  behind a gesture. Arming collapses it back to the single button.
  Long-press remains a shortcut to the queue.

- **It decides its own appearance.** There is no parent frame to tell it
  what to wear — the web overlay is handed a theme by the builder page
  hosting its iframe, and a React Native app has nothing of the sort — so
  the overlay themes itself: **System / Light / Dark**, every surface, in
  the settings panel. See [Settings](./settings.md).

## What it looks like

Captured from `examples/expo` on the iOS Simulator (Expo SDK 58 / RN 0.88 /
Fabric), against the example stub server with Claude Code as the agent.

| | |
|---|---|
| <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/toolbar.png" width="240" alt="The toolbar expanded at the bottom of the screen: Annotate, Queue with 2, Comments with 2, Settings and Close, over a screen with two blue task markers and an orange note marker"> | **Toolbar.** Tapping the floating button expands it into labelled actions — **Annotate**, **Queue** (the count still waiting for the agent), **Comments** (the open team notes), **Settings** and **Close**. One capture action, because marking something and deciding who reads it are different decisions; two lists, because sending work to the agent and reading what the team said are different jobs. It opens inward from whichever edge the button is parked on, and drags as one piece. |
| <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/aim-selected.png" width="240" alt="The Welcome to Expo title outlined and labelled ThemedText · themed-text.tsx:11, with an Annotate chip below it and the Element chip at the top of the screen"> | **Aim.** **Annotate** arms the overlay (or shake the device); the button turns blue and becomes the cancel. Touching an element outlines it and names it (`ThemedText · themed-text.tsx:11`) — drag to survey neighbours, release to select. One colour, one word: the destination is not chosen yet. The **Element / Area** chip near the top switches between aiming at an element and drawing a rectangle; it can be dragged anywhere when it covers something you want to aim at, and stays where you leave it. In Area mode the rectangle is drawn on a layer over the app, so dragging it out never scrolls the screen underneath. |
| <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/composer-destinations.png" width="240" alt="The composer sheet naming ThemedText · themed-text.tsx:11, the request Make this say Ship it, attach and screenshot controls, an Opus 5.5 agent pill, and Comment and Create Agent Task buttons"> | **Composer — where the choice happens.** A bottom sheet sized to its content (capped at 40% of the screen), so the selection stays visible while you type. One muted line names what you captured, with the dismiss **×** on its right; the text box is the only bordered thing in the sheet. At the bottom, two inline commits — **Comment** (outlined, the team's orange) and **Create Agent Task** (filled, the agent's blue) — so the tap that chooses the destination is the tap that sends; there is no selector, no mode, and the full who-acts sentences survive in the accessibility labels. Attach a screenshot or context from the attach panel's sources (the built-in asset library, plus whatever the host registers via `attachmentSources`) — the screenshot travels with either destination; picked references go with an agent task only. At the right of that row, the **agent pill** says which agent and model the task will run on — a green dot and the model's name, or a red dot and *No agent* — and opens a short menu: each signed-in agent's main models, the ones not signed in with a red dot, an effort slider at the bottom, and a gear to Settings → Agent, which has every model. |
| <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/markers.png" width="240" alt="Blue numbered agent-task markers on the title and the Get started label, and an orange team-note marker on the hints card"> | **Two marks.** A blue circle with a number is an **agent task**. An orange rounded square is a **team note**. Different hue *and* different silhouette, so they are told apart at a glance and without relying on colour; a settled note keeps its mark at 45% opacity, and a note that has produced agent tasks carries a small blue pip on its corner — one marker per anchored thing, never a second dot at the same coordinates. Tap one — when not armed — to open it; the touch target is a comfortable 44pt around the small dot, and overlapping markers give the tap to the newest one whose dot you actually hit. |
| <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/queue.png" width="240" alt="The queue with Queue 2 and Done tabs: two tasks, each with a checkbox and a delete cross, and a Send all button"> | **The queue is a workflow.** **Queue** (or a long-press on the collapsed button) opens the agent's pending tasks, and nothing else — the heading says what the panel does, and the ticks are exactly what **Send** hands over: every task starts ticked, untick one to hold it back, and the button reads **Send all** or **Send selected**. Every row is the same kind of thing, so no row wears a badge; `×` to delete, tap to open the task, and the close button at the top commits nothing. A task the agent is already working on is marked **Working…** and has no checkbox, and while one is, the collapsed pencil button pulses in the agent's colour. A row the agent had already finished and your reply put back carries a blue **Reopened** chip — it is pending like the rest, which is exactly what got it back here, so the chip is the only thing that can tell it apart from work you have simply not sent yet. Team notes are not part of this workflow and live behind **Comments**. |
| <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/notes.png" width="240" alt="Team notes grouped by screen: Home (this screen) with Sam's note and 3 replies, then /explore with one note, each marked Open"> | **Team notes, wherever they were left.** **Comments** lists every note in the app, grouped by route with the screen you are standing on first and the routeless ones last. Each row is the opening line, who wrote it, the element, the reply count and — for an open or resolved note — its status word; resolved and converted notes stay at 45% — the list is what was *said*, decisions included. A note handed to the agent shows no status word at all: the dimming and its **Tasks** tab say it, and the screen reader still hears it. Tapping a row takes you to the note: on this screen it just opens, on another it navigates there first and then opens, with the marker pulsing twice so you can see which dot you arrived at. Without expo-router the jump is not offered and the note simply opens. |
| <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/task-detail.png" width="240" alt="An agent task's detail: the request Make this say Ship it under a Reopened chip, the run line Claude Code, Done, 1 file, 33s, the agent's reply naming the line it changed in src/app/index.tsx, a follow-up asking for an exclamation mark, and a Send refinement to agent button"> | **Agent task detail.** The same sheet both kinds use, under a grabber. The header stacks: a blue **AGENT TASK** eyebrow, the element name big on its own line, then the source as a monospace chip — `src/components/themed-text.tsx:11` — with the screen beside it. (A task on the root route says **Home**, not a bare slash.) The task itself is a **card**: the request in full, and under it, quieter and behind a rule, the discussion it was made from. A thread that has not started yet is a seam — **No replies yet** between two rules — and once it has, it reads as a chat: your replies right in blue, the agent's left in neutral under its own mark, so it is never mistaken for a teammate. It opens on the newest message rather than the oldest, and follows your own replies down — except when you have scrolled up into the history, where an arriving reply must not yank you back, so a small **N new replies** pill appears above the box instead and jumps you down when tapped. **The pane stays live while it is open**: it re-reads the task on the same lazy cadence the team notes use, so the agent's answer arrives while you are looking at it rather than the next time you open the pane. Two commits under the thread, deliberately separate: the reply pill's own circle-arrow **send** posts what you typed, and the full-width **Send to agent** hands the task over — a refinement is written a sentence at a time, and each one should not start a turn. A task the agent had resolved and your reply reopened says so at the top of its card, and the button reads **Send refinement to agent**. |
| <img src="https://raw.githubusercontent.com/joinearlybird/annokit/main/docs/media/note-detail.png" width="240" alt="A team note's detail, expanded: a four-message discussion between You and Dana, an Agent task chip on Dana's last message, a Tasks (1) tab, and Resolve and Create agent task buttons"> | **Team note detail.** Same pane, orange eyebrow, **Open**/**Resolved** as a pill beside it, with two tabs: **Conversation** and **Tasks (N)**. The conversation is a **flat comment list**, not a chat: every message left-aligned under its author line — avatar, name **· time** — because a discussion pinned to an element reads as comments on it, not as a messaging app. A message that has produced a task wears an **Agent task** chip pinned to the far right of its author line, and the chip opens the task. **Create agent task** is the filled blue button in the action row beside the outlined **Resolve**/**Reopen**, and starts a flow rather than a mode: the rows become checkboxes (tap anywhere on the row; long-pressing a message is a shortcut into the same flow with that message already ticked), the bottom bar becomes a box for what you actually want done, and the confirm names how many messages it will quote. What you type leads the task; the quoted messages follow it as context. The note is never consumed by any of it. Authors are server-resolved (avatar when the server has one), consecutive messages from one person collapse into a single turn, and a long discussion opens where it actually is: at the bottom. |

### Pushing the app up — the sheet stops covering what it is about

Both sheets that sit over the app — the **composer** and the **detail panes**
(agent task, team note) — move the app instead of covering it, and there is
nothing to switch on. When a sheet opens over an element it would hide, the
app content and every layer anchored to it (the aim highlight, its label, the
markers) translate **up** by exactly as much as that element needs to clear
the sheet plus the keyboard, and no more; the sheet also takes a lower
ceiling, so the room that was made is not immediately eaten again. When the
element is already clear — everything in the top half of the screen — nothing
moves and the sheet keeps its usual height.

The clamps are the point: it never lifts the element past the top keep-out,
never moves more than three quarters of the window, and moves **nothing at
all** when any input is unknown — the failure mode is always "the app sits
still", never a translation computed from a guess (`src/push.ts`, tested).
On dismissal the transform snaps back to zero rather than animating, so
nothing is ever measured against a moving tree.

**Composer vs detail panes.** The composer measures the element live. A
detail pane has only the frame the server stored at capture time
(`boundingBox`), which nothing re-measures — so what the push guarantees to
bring into view is the overlay's own record of the element, i.e. its
**marker**, which is drawn from the same stored coordinates and rides the
same transform. If the screen has scrolled or re-laid-out since, marker and
element have already visibly parted company and the push moves the marker,
not a position it invented. Where even that is not true, the app simply does
not move:

| Case | Detail pane |
|---|---|
| Stored frame on the current route | Pushes it clear of the sheet |
| Item captured on **another route** | No push — the element is not on this screen |
| No stored frame, a zero-area one, or one that cannot belong to this window (a rotation, a larger device on the same session) | No push |
