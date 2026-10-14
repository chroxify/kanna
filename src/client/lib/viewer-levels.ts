import type { ViewerItem } from "../stores/viewerStore"

/**
 * What is under what in the viewer's pane, and so where Back goes.
 *
 * The pane holds one thing at a time, but things are opened from other
 * things, and each remembers where it came from: a file opened over a chat
 * (`returnTo`), a chat stepped to from another (`back`), a chat picked from
 * the graph (`graph`) or from a delegator's list (`delegated`). Read together
 * those are a stack, and this is its one reading.
 *
 * Under all of it, on a delegator's page, is the pane's floor: the list of
 * the chats under the delegator. Whatever is opened there, from the list or
 * from the transcript, has the list under it, and Back returns to it. Under
 * the list is the pane shut, as it is under everything on an ordinary chat:
 * the floor is the last thing in the pane, not something that holds it open.
 *
 * Kept free of the store, for tests.
 */

/** As much of a chat's viewer as says what is under it. */
export interface ViewerLevel {
  item: ViewerItem
  widthPx?: number
  returnTo?: { item: ViewerItem; widthPx?: number }
}

export type ViewerLevelBelow =
  /** What Back shows, and the pane width to show it at, when one is remembered. */
  | { item: ViewerItem; widthPx?: number }
  /** Nothing is under it: one more step shuts the pane. */
  | "closed"

function sameItem(left: ViewerItem, right: ViewerItem) {
  return left.kind === "delegated" && right.kind === "delegated" && left.chatId === right.chatId
}

export function viewerLevelBelow(level: ViewerLevel, floor: ViewerItem | null): ViewerLevelBelow {
  const { item } = level
  // Something opened over a chat, the graph or the list goes back to it, at
  // the width it had.
  if (level.returnTo) return { ...level.returnTo }

  // An open pane keeps its width whatever it shows, so it carries over.
  const kept = level.widthPx !== undefined ? { widthPx: level.widthPx } : {}
  if (item.kind === "chat") {
    const origin = {
      ...(item.graph ? { graph: item.graph } : {}),
      ...(item.delegated ? { delegated: item.delegated } : {}),
    }
    const previous = item.back?.[item.back.length - 1]
    if (previous) {
      const back = item.back!.slice(0, -1)
      return { item: { kind: "chat", chatId: previous, ...(back.length > 0 ? { back } : {}), ...origin }, ...kept }
    }
    // The first chat of a trail goes back to what it was picked from: the
    // graph, which was itself opened over the list if there is one.
    if (item.graph) return { item: { kind: "graph", chatId: item.graph }, ...kept }
    if (item.delegated) return { item: { kind: "delegated", chatId: item.delegated }, ...kept }
  }

  if (!floor || sameItem(item, floor)) return "closed"
  return { item: floor, ...kept }
}

/** Whether Back has somewhere to go: a level under this one that is not the pane shut. */
export function hasViewerLevelBelow(level: ViewerLevel, floor: ViewerItem | null): boolean {
  return viewerLevelBelow(level, floor) !== "closed"
}
