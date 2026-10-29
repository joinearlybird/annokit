/**
 * Composer: a BOTTOM SHEET summarizing the captured element
 * (name + source line), a multiline comment input, an optional screenshot toggle
 * (available only when react-native-view-shot resolved AND the tap-time
 * capture succeeded), an "Attach" affordance opening the attachment-source
 * pickers (src/attachments.ts — generic, host-extensible; picked items ride
 * along as `references[]`), and Submit/Cancel.
 *
 * Submit POSTs the protocol-v1 native annotation payload to
 *   POST {endpoint}/sessions/{sid}/annotations
 * then uploads the screenshot to
 *   POST {endpoint}/annotations/{aid}/screenshot   (multipart "file")
 * — note: the screenshot route is deliberately NOT session-prefixed
 * (annotation ids are globally unique per endpoint; see README.md).
 *
 * THE DESTINATION IS CHOSEN HERE, at the bottom of this sheet, and nowhere
 * else — by which of the TWO INLINE COMMITS you tap: "Comment" (team,
 * outlined) posts to `POST /comments`, "Create Agent Task" (agent, filled
 * primary) posts the annotation. No selector, no mode: the tap that chooses
 * is the tap that sends, which mirrors the web overlay exactly
 * (ui/src/components/annotation-overlay: one popup, `handleSubmit("comment")`
 * beside `handleSubmit("agent")`). Dismiss is the × beside the identity
 * line. The submit rules are pure and tested in src/destination.ts.
 *
 * ATTACHMENTS BELONG TO THE AGENT. Assets, host references and the
 * screenshot exist to aim an AGENT at context it cannot see; the comment
 * routes carry none of them, and a comment leaves the REFERENCES behind
 * (its screenshot travels with it — see the attach row)
 * (product owner: acceptable — the controls stay put rather than jumping
 * as you lean one way or the other).
 *
 * THE SCREENSHOT IS OPT-IN. It is CAPTURED eagerly — before the destination
 * is known, because it cannot be taken later — but it is not ATTACHED until
 * the switch is flipped. Those are two different booleans, and treating them
 * as one is what left the Team half showing an attachment row and a permanent
 * orange drop notice about a screenshot nobody had asked for
 * (SCREENSHOT_ATTACHED_BY_DEFAULT in src/composer-view.ts).
 *
 * SHEET, NOT CARD: it slides up over the lower ~half of the screen and its
 * backdrop is CLEAR, so the aim highlight and its name label (rendered by
 * the app underneath this transparent Modal) stay visible while the user
 * types. A centred card covered exactly the thing being described.
 *
 * ...WHICH ONLY WORKS FOR THE TOP OF THE SCREEN. A clear backdrop keeps a
 * highlight visible; it does not keep it OUT FROM UNDER the sheet. Annotate
 * the last row of a feed and the sheet opens exactly on top of the element
 * you are being asked to describe. So the APP moves instead (and with it
 * every layer anchored to it), upward, by exactly as much as that element
 * needs and no more — automatically, with no toggle and no mode: the
 * geometry can already see whether this sheet covers the element, and it
 * answers 0 whenever the answer is "leave the app alone". The geometry and
 * the clamps are src/push.ts; the transform is applied in src/index.tsx,
 * because what has to move is the app, and the app is not inside this
 * Modal. All this sheet does is report what it COVERS (below) and shrink
 * its own ceiling while a push is in force.
 *
 * THE SHEET REPORTS WHAT IT COVERS, not merely how tall it is: with the
 * keyboard up (the input autofocuses, so that is immediately) the
 * KeyboardAvoidingView lifts the sheet and the covered strip is sheet +
 * keyboard. Reporting only the sheet's own height told the aim label — and
 * would tell the push geometry — that a third of the screen was free when it
 * was under the keyboard.
 *
 * ONE SURFACE, ONE BOX. Each feature round added a container — an identity
 * card, an attachment tray, a boxed drop-notice, two full-width buttons with
 * explainers inside them — until the sheet was a stack of five nested cards
 * ("a bit too boxy and confusing", product owner, device testing). The
 * hierarchy is now spacing, weight and muted colour, and the ONLY visually
 * contained thing is the text input, because that is the only thing you type
 * into. The identity is one muted line, the destination is a two-segment
 * selector over a single primary button. The explaining sentences the two
 * old buttons carried are gone entirely (product owner, device testing) —
 * "Send to · Agent / Team" over "Ask the agent" says who acts without a line
 * of prose repeating it — so the one remaining muted line is a WARNING line,
 * present only when there is a warning (src/composer-view.ts, tested).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Animated,
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { TEXT_MAX } from "./limits";
import { themedStyles, useAnnoKitTheme } from "./theme-context";
import { composerInputMinHeight, sheetMaxHeight } from "./push";
import { useKeyboardHeight } from "./keyboard";
import { ACTION_GAP } from "./action-row";
import { AnnoKitAttachPanel } from "./attach-panel";
import { assetReference, assetsSource, buildReferences, uploadAsset } from "./attachments";
import { pastedImages, pasteWrapper, PASTED_MAX } from "./paste";
import type { PastedImage, PastePayload } from "./paste";
import type { AnnotationReference, AssetItem, AttachmentItem, AttachmentSource } from "./attachments";
import {
  CAPTURE_BUSY_BEAT_MS,
  captureIdentityLine,
  screenshotAttached,
  screenshotOffered,
  SCREENSHOT_ATTACHED_BY_DEFAULT,
} from "./composer-view";
import { canSubmitTo, submitBlockedReason } from "./destination";
import { AnnoKitNamePrompt } from "./name-prompt";
import { needsViewerName, viewerName } from "./viewer";
import type { SubmitDestination } from "./destination";
import type { AnnoKitConfig } from "./env";
import { AnnoKitIcon } from "./icon";
import { AgentPill } from "./agent-pill";
import { AnnoKitSettings } from "./settings";
import { taskRun } from "./agent-config";
import type { AgentConfig } from "./agent-config";
import { annoKitPreferences, subscribeToPreferences } from "./prefs";
import { submitAgentCapture, submitCommentCapture } from "./submit";
import { AnnoKitTransport } from "./transport";
import type { PendingCapture } from "./types";

/** Without host sources the panel offers the app's asset library alone. */
const DEFAULT_ATTACHMENT_SOURCES: AttachmentSource[] = [assetsSource];

interface Props {
  /**
   * Hidden while the provider takes the screenshot: the sheet is covering
   * the thing being captured, so it steps out of the shot rather than into
   * it. Text and switch state survive — this is visibility, not unmounting.
   */
  hidden?: boolean;
  /** Take the screenshot now (src/index.tsx captureScreenshotNow). */
  onRequestScreenshot?: () => Promise<string | null>;
  /** Delete it and clear it off the capture (src/index.tsx). */
  onClearScreenshot?: () => void;
  env: AnnoKitConfig;
  transport: AnnoKitTransport;
  capture: PendingCapture;
  /**
   * The EFFECTIVE session id — env's in our protocol, the server-assigned
   * one in agentation compat. Defaults to env's for hosts mounting the
   * composer directly.
   */
  sessionId?: string;
  /**
   * The attach panel's tabs. Defaults to the built-in assets source; hosts
   * extend or replace via `<AnnoKitProvider attachmentSources={…}>`.
   */
  attachmentSources?: AttachmentSource[];
  /**
   * False once a comments read has failed, so the sheet can grey out that
   * destination and say why instead of silently swallowing what was typed.
   */
  commentsAvailable?: boolean;
  /**
   * The server's agents (src/agent-config.ts), for the pill that picks the
   * agent and model this task runs on. Absent, or a server that does not
   * run tasks on their own agent (`perTask`): no pill.
   */
  agent?: AgentConfig | null;
  onSubmitted: (id: string, destination: SubmitDestination) => void;
  onCancel: () => void;
  /**
   * How much of the BOTTOM of the screen this sheet covers: its laid-out
   * height plus the keyboard underneath it. Not the same as the sheet's own
   * height, and the difference is most of a phone (see the header).
   */
  onCovered?: (height: number) => void;
  /**
   * True while the app underneath is actually being pushed up for this
   * sheet (src/index.tsx decides, from the geometry alone — there is no
   * mode and nothing to toggle). The sheet answers by taking a lower
   * ceiling: the room the push made must not be given straight back.
   */
  pushing?: boolean;
}

export function AnnoKitComposer({
  env,
  transport,
  capture,
  sessionId,
  attachmentSources,
  commentsAvailable,
  agent = null,
  onSubmitted,
  onCancel,
  onCovered,
  pushing = false,
  hidden = false,
  onRequestScreenshot,
  onClearScreenshot,
}: Props) {
  const sources = attachmentSources ?? DEFAULT_ATTACHMENT_SOURCES;
  const effectiveSessionId = sessionId ?? env.sessionId;
  const { palette: p } = useAnnoKitTheme();
  const prefs = useSyncExternalStore(subscribeToPreferences, annoKitPreferences, annoKitPreferences);
  const styles = useStyles();
  const [comment, setComment] = useState("");
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  // WANTED, not available — and now also the trigger. Flipping this on is
  // what TAKES the shot (the provider hides this sheet for a beat and
  // captures the app under it), so "off" means no screenshot was ever
  // written to disk rather than one taken and withheld. Starts off; see
  // SCREENSHOT_ATTACHED_BY_DEFAULT in src/composer-view.ts.
  const [attachScreenshot, setAttachScreenshot] = useState(
    // Seeded from whether a shot ALREADY EXISTS, which under opt-in capture
    // can only be true because someone asked for one. (Seeding this way was
    // wrong under the old eager capture — a URI was always present, so the
    // switch would have started on for everyone; that is the bug
    // SCREENSHOT_ATTACHED_BY_DEFAULT was written against. Opt-in inverts
    // it: a URI is now evidence of intent.)
    //
    // It also makes the sheet self-healing. If this component ever loses
    // its local state while the capture survives — a remount, a fast
    // refresh in development — the switch and the thumbnail come back
    // agreeing with the file on disk instead of silently disagreeing with
    // it, which is exactly the shape of "the screenshot was taken but the
    // thumbnail never appeared".
    () => capture.screenshotUri != null || SCREENSHOT_ATTACHED_BY_DEFAULT,
  );
  // In flight between the switch going on and the shot arriving.
  const [capturing, setCapturing] = useState(false);
  const busyBeat = useRef<ReturnType<typeof setTimeout> | null>(null);
  const body = useRef<ScrollView | null>(null);
  useEffect(
    () => () => {
      if (busyBeat.current) clearTimeout(busyBeat.current);
    },
    [],
  );
  // The thumbnail expanded to full size. A tile 64pt wide can only say
  // "a screen was captured"; whether it captured the RIGHT screen — and
  // whether anything private wandered into it — needs looking at properly,
  // and that matters more now that the shot is taken on request.
  const [previewOpen, setPreviewOpen] = useState(false);
  // The switch went on and the capture came back empty — said once, in
  // place, rather than failing silently and attaching nothing.
  const [captureFailed, setCaptureFailed] = useState(false);

  /**
   * The switch. On: take the shot if we do not already have one. Off: keep
   * whatever was taken (the user may flip back on) — the exits release it.
   */
  const onToggleScreenshot = useCallback(
    (next: boolean) => {
      setAttachScreenshot(next);
      setCaptureFailed(false);
      if (!next) {
        // OFF DELETES IT. Keeping the file "in case" would make off mean
        // "taken but withheld", which is the thing opt-in capture exists to
        // avoid — and it would mean turning it back on silently attached a
        // picture of a screen that may have changed since.
        onClearScreenshot?.();
        return;
      }
      if (capture.screenshotUri || !onRequestScreenshot) return;
      // The sheet can hide itself; the keyboard cannot. Dismiss it first or
      // it stands in the shot after the sheet has gone, which is the same
      // "our UI, not the app" problem one layer down. The typed text lives
      // in state and is untouched by losing focus.
      Keyboard.dismiss();
      setCapturing(true);
      // A beat BEFORE the sheet goes. Nothing can be drawn during the
      // capture itself — it would be in the capture — so the only place
      // feedback fits is here, in the moment between the tap and the sheet
      // stepping out. Long enough to read "Taking the screenshot…", short
      // enough that the whole thing still feels like one gesture.
      busyBeat.current = setTimeout(() => {
        void onRequestScreenshot()
          .then((uri: string | null) => {
            if (!uri) {
              setCaptureFailed(true);
              setAttachScreenshot(false);
            }
          })
          .finally(() => setCapturing(false));
      }, CAPTURE_BUSY_BEAT_MS);
    },
    [capture.screenshotUri, onRequestScreenshot, onClearScreenshot],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<AttachmentItem[]>([]);
  /**
   * IMAGES PASTED INTO THE INPUT (src/paste.ts), uploaded when the task or
   * note is SENT — not on paste, so a composer dismissed with one in it
   * leaves nothing behind in the app's assets. Once uploaded, the asset is
   * kept here, so a retry after a failed send does not upload it twice.
   */
  const [pasted, setPasted] = useState<(PastedImage & { asset?: AssetItem })[]>([]);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const onPaste = useCallback((payload: PastePayload) => {
    if (payload.type !== "images") return;
    setPasteError(null);
    setPasted((prev) => [...prev, ...pastedImages(payload, new Date(), prev.length)]);
  }, []);
  /**
   * REVEAL WHAT WAS JUST ADDED.
   *
   * The attachments list sits at the bottom of a scroll body that is only
   * about 100pt once the keyboard has pushed the sheet to its compact
   * ceiling. Adding a chip there is otherwise invisible — the thing exists,
   * is laid out, and is below the fold, which is indistinguishable from
   * nothing having happened. (That is precisely how the screenshot
   * thumbnail read as broken.) Scrolling on arrival makes adding something
   * and seeing it the same event.
   */
  const attachmentCount = picked.length + pasted.length + (capture.screenshotUri ? 1 : 0);
  useEffect(() => {
    if (attachmentCount === 0) return;
    // After layout, or the body does not know it has grown yet.
    const id = setTimeout(() => body.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [attachmentCount]);

  const [submitting, setSubmitting] = useState(false);
  // Open only when a team note is about to be posted by someone the overlay
  // cannot name (src/viewer.ts). It replaces the submit tap once, and the
  // post resumes the moment a name is confirmed.
  const [askName, setAskName] = useState(false);
  // NOT DISMISSIBLE WHILE SENDING. Closing mid-send released the screenshot
  // the upload was still reading, and the send's late success then closed
  // whatever composer was open by then — someone else's capture, words and
  // screenshot. The transport's timeouts bound the wait.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const dismiss = () => {
    if (!submitting) onCancel();
  };
  // Android back answers the innermost thing: the name question first,
  // so leaving it does not throw the draft away with it.
  const requestClose = () => {
    if (askName) setAskName(false);
    else dismiss();
  };
  const { height: windowHeight } = useWindowDimensions();
  // A pushing sheet gets a lower ceiling: the point of moving the app up is
  // to see more of it, and a sheet that grows into the space undoes that.
  const maxHeight = sheetMaxHeight(windowHeight, pushing);
  /**
   * WHAT WE COVER = sheet + keyboard. The sheet measures itself; the
   * keyboard has to be asked. `willShow` on iOS so the report lands with the
   * sheet's own lift rather than a beat after it; `didShow` elsewhere,
   * because that is the only one Android sends. Fails soft to 0 (a platform
   * with no keyboard events simply reports the sheet, as before).
   */
  const [sheetHeight, setSheetHeight] = useState(0);
  const keyboardHeight = useKeyboardHeight();
  useEffect(() => {
    if (sheetHeight > 0) onCovered?.(sheetHeight + keyboardHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetHeight, keyboardHeight]);
  // Slide up from below the fold. Transform-only, so it runs on the native
  // driver and never blocks the JS thread that is also serving the input.
  // The travel is the CAP, not the measured height: the sheet is
  // content-sized and has not laid out yet on the first frame.
  const slide = useRef(new Animated.Value(maxHeight)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [slide]);

  const toggleItem = (item: AttachmentItem) =>
    setPicked((prev) =>
      prev.some((i) => i.id === item.id) ? prev.filter((i) => i.id !== item.id) : [...prev, item],
    );

  const hasScreenshot = screenshotAttached(attachScreenshot, capture);
  const submitState = {
    text: comment,
    attachmentCount: picked.length + pasted.length,
    hasScreenshot,
    commentsAvailable,
    submitting,
  };
  const identity = captureIdentityLine(capture);
  // Both commits stand down while the shot is being taken. Submitting
  // mid-capture would either race the URI onto the body or send without
  // the screenshot the user just asked for — and the sheet is invisible at
  // that moment anyway, so the press could only be an accident.
  const canComment = canSubmitTo("comment", submitState) && !capturing;
  const canAgent = canSubmitTo("agent", submitState) && !capturing;

  const submit = async (destination: SubmitDestination, nameHint?: string | null) => {
    if (!canSubmitTo(destination, submitState)) return;
    // A team note is signed; an agent task is not, so only this half asks.
    if (destination === "comment" && !nameHint && needsViewerName()) {
      setAskName(true);
      return;
    }
    setSubmitting(true);
    // Pasted images first: they become assets, and their references ride
    // on what is created. One that does not upload stops the send, with
    // the sheet as it was — sending without it would quietly drop the
    // picture the request is about.
    const pastedRefs: AnnotationReference[] = [];
    for (let i = 0; i < pasted.length; i++) {
      const image = pasted[i]!;
      let asset = image.asset;
      if (!asset) {
        const up = await uploadAsset(transport, image);
        if (!mounted.current) return;
        if (!up.ok) {
          setSubmitting(false);
          setPasteError(
            up.reason === "unsupported"
              ? "This server doesn't take pasted images. Remove the image to send without it."
              : "The pasted image didn't upload. Try sending again.",
          );
          return;
        }
        asset = up.asset;
        setPasted((prev) => prev.map((p, j) => (j === i ? { ...p, asset } : p)));
      }
      pastedRefs.push(assetReference(asset));
    }
    // ONE submit path for the sheet and for headless hosts (src/submit.ts) —
    // wire shape, response-id re-keying, anchors and the screenshot upload
    // all live there and cannot drift between the two.
    const ctx = { transport, sessionId: effectiveSessionId, capture };
    if (destination === "comment") {
      const createdId = await submitCommentCapture(ctx, comment, nameHint ?? viewerName(), {
        // The picture rides with a note now, the same as with a task.
        // Picked references still do not: a reference is context for
        // something that will act on it.
        attachScreenshot: hasScreenshot,
        // Pasted images do go with a note: they are pictures for whoever
        // reads it, as much as the screenshot is.
        references: pastedRefs,
      });
      if (!mounted.current) return; // the provider tore the sheet down
      setSubmitting(false);
      // Failed: keep the sheet — and the typing — exactly where it was.
      if (createdId) onSubmitted(createdId, "comment");
      return;
    }
    const finalId = await submitAgentCapture(ctx, comment, {
      references: [...pastedRefs, ...buildReferences(picked)],
      attachScreenshot: hasScreenshot,
      outputDetail: prefs.outputDetail,
      agent: taskRun(agent),
    });
    if (!mounted.current) return;
    if (!finalId) {
      setSubmitting(false);
      return; // transport already logged; keep the composer open
    }
    onSubmitted(finalId, "agent");
  };

  return (
    /*
      HOW THE SHEET LEAVES THE SHOT.

      Not `visible={false}`: a Modal is a separate native window, and
      dismissing one does not complete within the couple of frames the
      capture waits — device testing caught the composer, mid-fade and
      still reading "Taking the screenshot…", inside the screenshot it was
      taking. Opacity is a single render commit on a window that never goes
      away, so it is both faster and deterministic, and the sheet comes back
      with the typed text, the picked attachments and the switch untouched
      because nothing unmounted.

      AND IT KEEPS ABSORBING TOUCHES while it is invisible — deliberately.
      The capture is a few hundred milliseconds during which the app is what
      is on screen, and taps falling through would let someone scroll the
      list or press a button INSIDE the shot they are taking. An invisible
      full-screen layer that answers nothing is the only way to freeze the
      screen without drawing something that would then be in the picture.
    */
    <Modal transparent animationType="none" visible onRequestClose={requestClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.backdrop, hidden && styles.hiddenForCapture]}
      >
        <Animated.View
          style={[styles.sheet, { maxHeight, transform: [{ translateY: slide }] }]}
          testID="annokit-composer"
          // Report the height we actually laid out at; combined with the
          // keyboard above, that is the strip of screen we cover — which is
          // what lifts the element's name label clear of us, and what the
          // push geometry measures the element against.
          onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
        >
          <View style={styles.grabber} />
          {/*
            ONE SURFACE, TRANSITIONED. The "who signs this?" question does
            not stack a second sheet or squeeze in beside the commits — this
            sheet's content SWAPS to the question and the sheet re-sizes to
            fit it (content-sized, like every state of this sheet), and Not
            now swaps everything back exactly as typed.
          */}
          {askName ? (
            <AnnoKitNamePrompt
              accent={p.team}
              // The sheet already pads its own edges.
              inset={false}
              ctaRow
              onConfirm={(name) => {
                setAskName(false);
                void submit("comment", name);
              }}
              onCancel={() => setAskName(false)}
            />
          ) : (
            <>
          {/*
            Context, not the headline. One muted line: what you tapped and
            where it lives — with the dismiss × on its right, in the corner
            where every sheet keeps it. (This row replaced a full-width
            Cancel in the action row: the commit buttons now spend that room.)
          */}
          <View style={styles.headerRow}>
            <Text
              style={styles.identity}
              numberOfLines={1}
              testID="annokit-composer-identity"
            >
              {identity}
            </Text>
            <Pressable
              onPress={dismiss}
              disabled={submitting}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              accessibilityState={{ disabled: submitting }}
              style={styles.closeBtn}
              testID="annokit-cancel"
            >
              <AnnoKitIcon name="close" size={16} color={p.textMuted} />
            </Pressable>
          </View>
          <ScrollView
            ref={body}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            // Hidden when nothing is being pushed, where the sheet is tall
            // enough that nothing is cut off. While pushing, the lower ceiling means
            // the body genuinely overflows on a phone — device testing: the
            // input's bottom edge is clipped — and an indicator is the
            // difference between "this scrolls" and "this is broken".
            showsVerticalScrollIndicator={pushing}
          >
            <PasteBox onPaste={onPaste}>
              <TextInput
                testID="annokit-comment-input"
                maxLength={TEXT_MAX}
                // The floor moves with the ceiling: a compact sheet starts the
                // field at one line so the row under it is drawn whole rather
                // than sliced (src/push.ts).
                style={[styles.input, { minHeight: composerInputMinHeight(pushing) }]}
                placeholder={pasteWrapper() ? "Describe the change, or paste an image…" : "Describe the change…"}
                placeholderTextColor={p.textMuted}
                multiline
                autoFocus
                value={comment}
                onChangeText={setComment}
              />
            </PasteBox>
            {/*
              A light row, not a tray. Two icons, and the things they
              produce wrap underneath as flat chips — nothing here gets a
              border of its own, because none of it is a separate zone of
              the sheet.

              WHAT TRAVELS WHERE: the screenshot goes with either
              destination, a task or a note. Picked references go with a
              task only — a reference is context for something that will
              ACT on it, where a picture is context for a person, which is
              what a note is. Neither is hidden per-destination: that died
              with the destination selector, and the sheet does not know
              which button you are about to press.

              The row only exists when it has something to hold — compat
              mode empties both halves at once.
            */}
            {/*
              ONE ICON ROW. Both controls do the same kind of thing — put
              something on this annotation — so they read as one row of
              actions rather than a link on the left and a settings switch
              on the right.

              The camera replaced a switch deliberately. A switch describes
              a STATE and has to be read to know what it is; a camera
              describes an ACT, and what it produced is the chip below.
              With the chip carrying the state (and its own ✕ to remove),
              nothing has to be inferred from the position of a slider.
            */}
            {(sources.length > 0 || screenshotOffered(capture) || agent?.perTask) && (
              <View style={styles.iconRow} testID="annokit-attach-row">
                {sources.length > 0 ? (
                  <Pressable
                    onPress={() => setPickerOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Attach context for the agent"
                    hitSlop={8}
                    style={styles.iconButton}
                    testID="annokit-attach-open"
                  >
                    <AnnoKitIcon name="plus" size={17} color={p.textMuted} />
                  </Pressable>
                ) : null}
                {screenshotOffered(capture) && (
                  <>
                    <Pressable
                      onPress={() => onToggleScreenshot(!attachScreenshot)}
                      disabled={capturing}
                      hitSlop={8}
                      style={[styles.iconButton, hasScreenshot && styles.iconButtonActive]}
                      testID="annokit-screenshot-capture"
                      accessibilityRole="button"
                      // The label carries what the tap DOES, which changes
                      // with what is already attached.
                      accessibilityLabel={
                        hasScreenshot
                          ? "Remove the screenshot of this screen"
                          : "Take a screenshot of this screen"
                      }
                      accessibilityState={{ selected: hasScreenshot, busy: capturing }}
                      // The one thing about this control a user may not
                      // expect, said where it cannot be missed by anyone
                      // who cannot see the picture it produces. The same
                      // fact is in docs/security-and-privacy.md under
                      // "What a screenshot contains".
                      accessibilityHint="Captures the whole screen, not just the selected element. Rides with an agent task or a team note"
                    >
                      <AnnoKitIcon
                        name="camera"
                        size={17}
                        color={hasScreenshot ? p.agentText : p.textMuted}
                      />
                    </Pressable>
                  </>
                )}
                {/*
                  The agent this task goes to, at the row's far end: chosen
                  per task, so it sits with the things put on the task
                  (src/agent-pill.tsx).
                */}
                {agent?.perTask ? (
                  <View style={styles.pillSlot}>
                    <AgentPill config={agent} transport={transport} onOpenSettings={() => setAgentSettingsOpen(true)} />
                  </View>
                ) : null}
              </View>
            )}
            {capturing && (
              <View style={styles.capturingRow} testID="annokit-screenshot-capturing">
                <ActivityIndicator size="small" color={p.textMuted} />
                <Text style={styles.rowLabel}>Taking the screenshot…</Text>
              </View>
            )}
            {captureFailed && (
              <Text style={styles.rowLabel} testID="annokit-screenshot-failed">
                Could not take a screenshot on this device.
              </Text>
            )}
            {/*
              The switch alone says "a screenshot will ride along" without
              showing WHICH one. The thumbnail is that proof: what the agent
              will actually see (the app, aim outlines, no composer chrome).
              Rendered only while attached, so switching it off visibly
              removes the thing being removed.
            */}
            {/*
              WHAT WILL RIDE ALONG, as one list. The screenshot is an
              attachment like any other, so it reads as the first chip
              rather than as a separate surface — with a thumbnail, because
              it is the one attachment whose identity is a picture.
              Tapping it opens it full size; the switch above is what
              removes it, since the switch is what created it.

              This list is inside the sheet's scroll body, which is about
              100pt once the keyboard has pushed the sheet to its compact
              ceiling (src/push.ts). Anything added here can therefore land
              below the fold — real, laid out, and invisible, which reads
              exactly like nothing happened. The effect above scrolls the
              body to it on arrival, so adding a thing always shows you the
              thing.
            */}
            {(hasScreenshot && capture.screenshotUri) || picked.length > 0 || pasted.length > 0 ? (
              <View style={styles.chipWrap}>
                {hasScreenshot && capture.screenshotUri ? (
                  <Pressable
                    onPress={() => setPreviewOpen(true)}
                    testID="annokit-screenshot-preview-open"
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Screenshot that will be attached — open it full size"
                    style={styles.chip}
                  >
                    <Image
                      testID="annokit-screenshot-preview"
                      source={{ uri: capture.screenshotUri }}
                      style={styles.screenshotChipThumb}
                      resizeMode="cover"
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                    <Text style={styles.chipText} numberOfLines={1}>
                      Screenshot
                    </Text>
                    <AnnoKitIcon name="expand" size={11} color={p.textMuted} />
                  </Pressable>
                ) : null}
                {hasScreenshot && capture.screenshotUri ? (
                  // Its own ✕, so REMOVE means the same thing on every pill
                  // in this row. The pill body opens the picture — the one
                  // attachment with something to look at — and this takes it
                  // off, which also switches the toggle back off and deletes
                  // the file, because those are the same act.
                  <Pressable
                    onPress={() => onToggleScreenshot(false)}
                    hitSlop={8}
                    style={styles.screenshotChipRemove}
                    testID="annokit-screenshot-remove"
                    accessibilityRole="button"
                    accessibilityLabel="Remove the screenshot"
                  >
                    <AnnoKitIcon name="close" size={12} color={p.textMuted} />
                  </Pressable>
                ) : null}
                {pasted.map((image, i) => (
                  <Pressable
                    key={image.uri}
                    onPress={() => {
                      setPasteError(null);
                      setPasted((prev) => prev.filter((_, j) => j !== i));
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove pasted image ${i + 1}`}
                    style={styles.chip}
                    testID={`annokit-pasted-${i}`}
                  >
                    <Image
                      source={{ uri: image.uri }}
                      style={styles.screenshotChipThumb}
                      resizeMode="cover"
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                    <Text style={styles.chipText} numberOfLines={1}>
                      {pasted.length > 1 ? `Pasted image ${i + 1}` : "Pasted image"}
                    </Text>
                    <AnnoKitIcon name="close" size={12} color={p.textMuted} />
                  </Pressable>
                ))}
                {picked.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => toggleItem(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove attachment ${item.title}`}
                    style={styles.chip}
                    testID={`annokit-chip-${item.id}`}
                  >
                    <Text style={styles.chipText} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <AnnoKitIcon name="close" size={12} color={p.textMuted} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {pasted.length >= PASTED_MAX && !pasteError ? (
              <Text style={styles.helper}>That's the most images one task can carry.</Text>
            ) : null}
            {pasteError ? (
              <Text style={[styles.helper, styles.helperWarn]} testID="annokit-paste-error">
                {pasteError}
              </Text>
            ) : null}
          </ScrollView>
          {/*
            The choice, made last and made once — now TWO INLINE COMMITS
            instead of a selector over one button: the tap that chooses the
            destination is the tap that sends. Comment sits left, outlined in
            the team's colour; Create Agent Task is the filled primary,
            because the agent is the overlay's reason to exist. Dismiss lives
            in the sheet's top corner, so this row is commits only.
          */}
          <View style={styles.destinations} testID="annokit-destinations">
            {commentsAvailable === false && (
              <Text style={[styles.helper, styles.helperWarn]} testID="annokit-blocked-comment">
                {submitBlockedReason("comment", submitState)}
              </Text>
            )}
            {/*
              The name question is a SHEET OVER THIS SHEET (rendered below,
              beside the attach panel): same height, same silhouette, so it
              reads as the next card of the same flow covering the last one
              — not a morph of it. The commits underneath stay as they are;
              the cover owns the screen until answered or dismissed.
            */}
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => void submit("comment")}
                disabled={!canComment}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canComment }}
                accessibilityLabel="Comment — teammates see this, the agent will not act on it"
                style={[styles.commentBtn, !canComment && styles.submitDisabled]}
                testID="annokit-submit-comment"
              >
                {/*
                  Ellipsize rather than clip. Device testing at XXXL text:
                  with nothing allowed to give, the row overflowed and words
                  were cut mid-letter, which reads as a bug rather than as a
                  large text size.
                */}
                <Text style={styles.commentText} numberOfLines={1}>
                  Comment
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void submit("agent")}
                disabled={!canAgent}
                hitSlop={6}
                accessibilityRole="button"
                // `busy` while the POST is in flight: the label changes to
                // "Saving…" visually, and this is that fact for a screen
                // reader — including that pressing again will do nothing.
                accessibilityState={{ disabled: !canAgent, busy: submitting }}
                accessibilityLabel="Create agent task — the agent will make this change"
                style={[
                  styles.submitBtn,
                  { backgroundColor: p.agent },
                  !canAgent && styles.submitDisabled,
                ]}
                testID="annokit-submit-agent"
              >
                <Text style={styles.submitText} numberOfLines={1}>
                  {submitting ? "Saving…" : "Create Agent Task"}
                </Text>
              </Pressable>
            </View>
          </View>
            </>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
      {/*
        SETTINGS → AGENT, from the pill menu's gear — opened HERE, over this
        sheet, like the attach panel: iOS will not present the provider's
        own Settings sheet over this one, and closing the composer to make
        room would throw away what was typed.
      */}
      {agentSettingsOpen && agent && (
        <AnnoKitSettings
          endpoint={env.endpoint}
          transport={transport}
          initialPage="agent"
          initialAgent={agent}
          onClose={() => setAgentSettingsOpen(false)}
        />
      )}
      {pickerOpen && (
        <AnnoKitAttachPanel
          transport={transport}
          sources={sources}
          selected={picked}
          onToggle={toggleItem}
          onClose={() => setPickerOpen(false)}
          // Cover, don't loom: the picker takes exactly the composer's
          // height so it stacks on the sheet it came from.
          height={sheetHeight > 0 ? sheetHeight : undefined}
        />
      )}
      {/*
        THE SCREENSHOT, FULL SIZE. A 64pt tile can say "a screen was
        captured"; it cannot answer "is this the right screen, and did
        anything private wander into it" — which is the question the shot
        being opt-in invites you to ask. Contained rather than cropped, so
        what you check is the whole frame the agent receives.
      */}
      {previewOpen && capture.screenshotUri ? (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={() => setPreviewOpen(false)}
          testID="annokit-screenshot-viewer"
        >
          <View style={styles.viewerBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setPreviewOpen(false)}
              // Tap-anywhere to close; the labelled button below is the
              // one a screen reader should find.
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Image
              testID="annokit-screenshot-viewer-image"
              accessibilityLabel="The screenshot that will be attached, full size"
              source={{ uri: capture.screenshotUri }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
            <Pressable
              onPress={() => setPreviewOpen(false)}
              hitSlop={12}
              style={styles.viewerClose}
              testID="annokit-screenshot-viewer-close"
              accessibilityRole="button"
              accessibilityLabel="Close the screenshot"
            >
              <AnnoKitIcon name="close" size={18} color={p.chromeInk} />
            </Pressable>
          </View>
        </Modal>
      ) : null}
    </Modal>
  );
}

const useStyles = themedStyles((p) => ({
  backdrop: {
    flex: 1,
    // CLEAR on purpose: a scrim would dim the very element the sheet exists
    // to keep visible. The sheet's own surface is the only opaque part.
    backgroundColor: "transparent",
    justifyContent: "flex-end",
  },
  sheet: {
    width: "100%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: p.sheet,
    borderTopWidth: 1,
    borderColor: p.border,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    shadowColor: p.shadow,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: p.borderStrong,
    marginBottom: 10,
  },
  body: {
    // Content-sized: grow to fit, shrink (and scroll) only once the sheet
    // has hit its cap.
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  identity: {
    flex: 1,
    color: p.textMuted,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  closeBtn: {
    padding: 2,
  },
  input: {
    marginTop: 10,
    // The floor is applied at the call site — it depends on whether the
    // sheet is at its compact ceiling (src/push.ts composerInputMinHeight).
    maxHeight: 160,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: p.inputBorder,
    backgroundColor: p.raised,
    color: p.textStrong,
    padding: 10,
    fontSize: 14,
    textAlignVertical: "top",
  },
  row: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowLabel: {
    color: p.textMuted,
    fontSize: 13,
  },
  // A slim portrait tile, not a gallery: big enough to recognize the
  // screen, small enough that the comment field stays the sheet's centre.
  // The ✕ sits beside the screenshot pill rather than inside it: the pill
  // body is already a button (it opens the picture), and nesting a second
  // one inside it makes which target you hit a matter of pixels.
  screenshotChipRemove: {
    alignSelf: "center",
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginLeft: -2,
  },
  // One row of actions, left-aligned and evenly spaced: two things that
  // both add something to this annotation, sitting together.
  iconRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  // 44pt of target under a 17pt glyph — the icons are small on purpose, the
  // things you hit are not.
  pillSlot: {
    flex: 1,
    alignItems: "flex-end",
  },
  iconButton: {
    width: 40,
    height: 36,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  // A screenshot is attached: the camera wears the agent's colour, the same
  // way an attached thing does everywhere else in this sheet.
  iconButtonActive: {
    backgroundColor: p.chip,
  },
  screenshotChipThumb: {
    width: 18,
    height: 26,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: p.border,
    backgroundColor: p.card,
  },
  capturingRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  // Invisible, but still mounted and still laid out — see the Modal above.
  hiddenForCapture: {
    opacity: 0,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: p.scrim,
    alignItems: "center",
    justifyContent: "center",
  },
  // Contained inside a generous inset: the whole frame, never cropped, and
  // never edge-to-edge where the close control would fight the notch.
  viewerImage: {
    width: "88%",
    height: "80%",
  },
  viewerClose: {
    position: "absolute",
    top: 56,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: p.chrome,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: p.border,
  },
  chipWrap: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 190,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: p.chip,
  },
  chipText: {
    color: p.textBody,
    fontSize: 12,
    flexShrink: 1,
  },
  chipRemove: {
    color: p.textMuted,
    fontSize: 13,
    lineHeight: 15,
    fontWeight: "700",
  },
  destinations: {
    marginTop: 14,
    gap: 8,
  },
  helper: {
    color: p.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  /** Orange: everything the helper line still says is a warning. */
  helperWarn: {
    color: p.teamText,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: ACTION_GAP,
  },
  // COMPACT ON PURPOSE, below the shared action metrics: these two commits
  // sit under the whole sheet and were reading as its heaviest element
  // (product owner). The VISUAL height drops; the touch target does not —
  // both Pressables carry hitSlop to keep ~44pt effective.
  // Comment: outlined in the team's colour — a real commit, deliberately
  // quieter than the filled agent primary beside it.
  commentBtn: {
    flex: 1,
    minHeight: 34,
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 9,
    alignItems: "center",
    borderWidth: 1,
    borderColor: p.teamEdge,
  },
  commentText: {
    color: p.teamText,
    fontSize: 13,
    fontWeight: "700",
  },
  submitBtn: {
    // The agent's half gets the wider share: it is the primary and its
    // label is the longer one.
    flex: 1.4,
    minHeight: 34,
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 9,
    alignItems: "center",
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitText: {
    color: p.onAccent,
    fontSize: 13,
    fontWeight: "700",
  },
}));

/**
 * The paste wrapper around the input when expo-paste-input is in this
 * build (src/paste.ts), and nothing at all when it is not.
 */
function PasteBox({ onPaste, children }: { onPaste: (payload: PastePayload) => void; children: React.ReactNode }) {
  const Wrapper = pasteWrapper();
  return Wrapper ? <Wrapper onPaste={onPaste}>{children}</Wrapper> : <>{children}</>;
}
