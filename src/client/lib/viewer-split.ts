/**
 * How the chat page's split, the chat column beside the viewer's pane,
 * follows the viewer.
 *
 * The split is the chat's width, so moving it is layout: every step re-wraps
 * the transcript and re-measures the frames and tables in it. That is worth
 * showing when the chat is making room for a pane beside it. Under a pane
 * that covers the chat it is work nobody sees, and it leaves the transcript
 * somewhere other than where it was. So:
 *
 *   - Expanded, the split is left alone. A viewer opened straight to
 *     expanded never narrows the chat, and one expanded from its pane keeps
 *     the chat as narrow as it was, so collapsing finds it ready.
 *   - Out of expanded, the split is set in one step, to the pane's width or
 *     to nothing, while the viewer still covers the chat. One reflow, behind
 *     the card, instead of one per frame beside it.
 *   - Between closed and docked it slides, as it always has.
 *   - Docked and staying docked, it holds. The pane takes a width when it
 *     opens, from what it opens on, and keeps it for as long as it is open
 *     (or until it is dragged): a file opened over a chat, a chat picked
 *     from a list, a review after a preview all arrive in the pane as it
 *     stands. A surface that is the same before and after has no business
 *     moving, and each move re-wrapped the chat beside it for nothing.
 *
 * The same reasoning decides when the viewer's card plays its entrance
 * (`viewerCardEnters`): when the pane opens, and never when what is in an
 * open pane changes.
 */
export type ViewerPaneState = "closed" | "docked" | "expanded"

export function viewerPaneState(open: boolean, expanded: boolean): ViewerPaneState {
  if (!open) return "closed"
  return expanded ? "expanded" : "docked"
}

export interface ViewerSplitMove {
  /** Where the split goes: nowhere, shut, or to the docked width of what is open. */
  to: "hold" | "closed" | "docked"
  /** Slide there, rather than take it in one step. */
  animate: boolean
}

/**
 * `samePane` is false when what is being laid out is not the pane that was
 * there a moment ago: the page is on another chat, or the split is new
 * (another project, a phone turned desktop). Such a pane takes its own
 * layout, in one step. So does any move under reduced motion.
 */
export function resolveViewerSplitMove(
  previous: ViewerPaneState,
  next: ViewerPaneState,
  pane: { samePane: boolean; reducedMotion: boolean },
): ViewerSplitMove {
  if (next === "expanded") return { to: "hold", animate: false }
  if (previous === "docked" && next === "docked" && pane.samePane) return { to: "hold", animate: false }
  const continuous = pane.samePane && !pane.reducedMotion
  return { to: next, animate: continuous && previous !== "expanded" && (previous === "docked" || next === "docked") }
}

/**
 * Whether the viewer's card plays its entrance: only when the pane goes from
 * shut to open. A card mounted into a pane that was already open, because
 * what the pane shows changed (a chat picked from a list, a file over a
 * chat, Back), is the same surface in the same place, and stays still: only
 * its title and its body are new. Expanding and collapsing are not openings
 * either; the card slides between the two on its own.
 */
export function viewerCardEnters(previous: ViewerPaneState, next: ViewerPaneState): boolean {
  return previous === "closed" && next !== "closed"
}
