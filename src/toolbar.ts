/**
 * The FAB's expandable toolbar — layout and action list (the rendering
 * lives in src/fab.tsx, the drag geometry in src/fab-drag.ts).
 *
 * WHY A TOOLBAR. The single button hid its actions behind gestures: tap
 * armed, and the pending queue was reachable ONLY by long-press, which is
 * to say by knowing. The web overlay solved the same problem with a shell
 * of labelled tabs (ui/src/components/platform-overlays.tsx in the web
 * template); a phone has no room for that shell, so the button expands into
 * a compact row of labelled icon buttons instead. The intent is the one
 * that matters: every action visible, nothing essential gesture-only.
 *
 * The actions are DATA (`toolbarActions`), not JSX — the web shell keeps
 * growing tabs (pages, comments, people, shortcuts) and this one will too;
 * adding an entry here should not mean touching the layout.
 *
 * Pure and react-native-free, so the rules that are easy to get wrong on a
 * phone — which way it opens at each screen edge, that it never opens off
 * the screen, that arming puts it away — are unit tested rather than
 * eyeballed.
 */

import { FAB_INSETS, FAB_SIZE } from "./fab-drag";
import type { FabInsets, FabPoint, FabScreen } from "./fab-drag";
import type { IconName } from "./icon-set";

/** One labelled icon button in the expanded toolbar. */
export interface ToolbarAction {
  key: ToolbarActionKey;
  /** Short label under the icon. One word — the column is ~62pt wide. */
  label: string;
  /** SEMANTIC, not a glyph: what gets drawn is src/icon.tsx's decision. */
  icon: IconName;
  /** Small numeral on the button (the pending count on Queue). */
  badge?: string;
  accessibilityLabel: string;
}

export type ToolbarActionKey = "annotate" | "queue" | "comments" | "settings" | "collapse";

export const TOOLBAR_ITEM_WIDTH = 62;
export const TOOLBAR_GAP = 2;
export const TOOLBAR_PADDING = 5;
/** Same height as the collapsed button, so expanding does not jump. */
export const TOOLBAR_HEIGHT = FAB_SIZE;

/**
 * The toolbar's contents, in order.
 *
 * The pending count lives HERE, on Queue, and nowhere else: a counter on
 * the toggle button said nothing about what tapping it did (product owner,
 * device testing), while on Queue it is a label for what you will find.
 * Absent at zero — an empty queue needs no numeral. Comments carries the
 * same kind of numeral for the same reason: the notes still OPEN, across
 * every screen, which is the number that means "unfinished conversation".
 *
 * The two lists are separate entries because they are separate jobs: Queue
 * is the send-to-the-agent workflow (tick, send, delete), Comments is
 * "what have we said about this app, and take me to it".
 */
export function toolbarActions(state: {
  armed: boolean;
  pendingCount: number;
  /** Open team notes across every screen. Omitted/0 = no numeral. */
  noteCount?: number;
}): ToolbarAction[] {
  const count = state.pendingCount > 0 ? (state.pendingCount > 9 ? "9+" : String(state.pendingCount)) : undefined;
  const notes = state.noteCount ?? 0;
  const noteBadge = notes > 0 ? (notes > 9 ? "9+" : String(notes)) : undefined;
  return [
    {
      key: "annotate",
      label: state.armed ? "Cancel" : "Annotate",
      icon: state.armed ? "close" : "annotate",
      // "Annotate" is the act of MARKING something, not a destination: the
      // choice between the agent and the team is made in the composer
      // (src/destination.ts), after the element is picked.
      accessibilityLabel: state.armed ? "Cancel annotate mode" : "Annotate an element",
    },
    {
      key: "queue",
      label: "Queue",
      icon: "queue",
      badge: count,
      // The panel behind this button is the send-to-the-agent workflow and
      // lists agent tasks only (src/queue.tsx), which is exactly what the
      // badge counts: work not yet handed over.
      accessibilityLabel:
        state.pendingCount > 0
          ? `Open the agent's queue (${state.pendingCount} waiting to be sent)`
          : "Open the agent's queue",
    },
    // No Agent item: the agent a task runs on is picked in the composer,
    // where the task is written (src/agent-pill.tsx), and the full list is
    // Settings → Agent.
    {
      key: "comments",
      label: "Comments",
      icon: "comment",
      badge: noteBadge,
      // Every screen's notes, not this one's: the list exists precisely to
      // reach the ones whose markers are somewhere else.
      accessibilityLabel:
        notes > 0
          ? `Open team notes from every screen (${notes} open)`
          : "Open team notes from every screen",
    },
    {
      key: "settings",
      label: "Settings",
      icon: "settings",
      // Appearance, the name on your notes, and what this overlay is wired
      // to. It sits here rather than behind a gesture for the reason the
      // toolbar exists at all: an action nobody can find is not an action.
      accessibilityLabel: "Open the overlay's settings",
    },
    {
      key: "collapse",
      label: "Close",
      icon: "chevron",
      accessibilityLabel: "Collapse the annotate toolbar",
    },
  ];
}

/** The narrowest an item may get before the labels stop fitting. */
export const TOOLBAR_ITEM_MIN_WIDTH = 52;

/**
 * Each item's width for `count` actions on a screen this wide: the full
 * TOOLBAR_ITEM_WIDTH when they fit, narrower when they would not — six
 * items at full width are wider than an iPhone SE — and never below
 * TOOLBAR_ITEM_MIN_WIDTH.
 */
export function toolbarItemWidth(
  count: number,
  screenWidth: number,
  insets: { left: number; right: number } = FAB_INSETS,
): number {
  if (count <= 0) return TOOLBAR_ITEM_WIDTH;
  const room = screenWidth - insets.left - insets.right - TOOLBAR_PADDING * 2 - (count - 1) * TOOLBAR_GAP;
  return Math.max(TOOLBAR_ITEM_MIN_WIDTH, Math.min(TOOLBAR_ITEM_WIDTH, Math.floor(room / count)));
}

/** Width of a toolbar holding `count` actions. */
export function toolbarWidth(count: number, itemWidth: number = TOOLBAR_ITEM_WIDTH): number {
  if (count <= 0) return 0;
  return TOOLBAR_PADDING * 2 + count * itemWidth + (count - 1) * TOOLBAR_GAP;
}

/** Which way the toolbar grows from the collapsed button. */
export type ToolbarDirection = "left" | "right";

export interface ToolbarPlacement {
  direction: ToolbarDirection;
  width: number;
  /**
   * Horizontal shift to apply to the button's own position when expanded.
   * Zero opening right; negative opening left (the toolbar's right edge
   * stays where the button was, so the dock edge does not move under the
   * user's thumb).
   */
  offsetX: number;
}

/**
 * Where the expanded toolbar sits, given where the button is parked.
 *
 * It opens INWARD — docked left it grows right, docked right it grows left
 * — because the other way round is off the screen. The offset is then
 * clamped so a toolbar that is wider than the space on its side still lands
 * fully on screen (and a toolbar wider than the whole screen pins to the
 * left margin rather than centring its overflow, matching src/aim.ts).
 */
export function toolbarPlacement(
  point: FabPoint,
  screen: FabScreen,
  actionCount: number,
  size: number = FAB_SIZE,
  insets: FabInsets = FAB_INSETS,
  itemWidth: number = TOOLBAR_ITEM_WIDTH,
): ToolbarPlacement {
  const width = toolbarWidth(actionCount, itemWidth);
  // Dock side by the button's centre, the same test snapFabToEdge uses.
  const dockedLeft = point.x + size / 2 < screen.width / 2;
  const direction: ToolbarDirection = dockedLeft ? "right" : "left";
  const rawOffset = direction === "right" ? 0 : -(width - size);

  const minLeft = insets.left;
  const maxLeft = screen.width - insets.right - width;
  const desired = point.x + rawOffset;
  const clampedLeft = maxLeft < minLeft ? minLeft : clamp(desired, minLeft, maxLeft);
  return { direction, width, offsetX: clampedLeft - point.x };
}

/**
 * Arming means the user is about to aim at the app, so the toolbar gets out
 * of the way and leaves the single button (which is now the cancel). It is
 * a rule rather than an inline `if` because it is the one that keeps the
 * chrome from covering the thing being annotated.
 */
export function shouldCollapseToolbar(armed: boolean, expanded: boolean): boolean {
  return expanded && armed;
}

/**
 * What a tap on the COLLAPSED button does. Armed it is the cancel (the
 * toolbar is collapsed precisely because we are armed, and a user who wants
 * out should not have to expand a toolbar to get there); otherwise it opens
 * the toolbar.
 */
export function collapsedTapAction(armed: boolean): "disarm" | "expand" {
  return armed ? "disarm" : "expand";
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
