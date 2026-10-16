import type { ViewerItem } from "../stores/viewerStore"

/**
 * What is under what in the viewer's pane, and so where Back goes.
 *
 * The pane holds one thing at a time, but things are opened from other
 * things, and each remembers where it came from: a file opened over a chat
 * (`returnTo`), a chat stepped to from another (`back`), a chat picked from
 * a delegator's board or one of its tickets (`delegated`, `ticket`). Read together
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
  returnTo?: { item: ViewerItem }
}

export type ViewerLevelBelow =
  /** What Back shows. */
  | { item: ViewerItem }
  /** Nothing is under it: one more step shuts the pane. */
  | "closed"

function sameItem(left: ViewerItem, right: ViewerItem) {
  return left.kind === "delegated" && right.kind === "delegated" && left.chatId === right.chatId
}

/**
 * `pageChatId` is the chat the page is on. A ticket has its board under it
 * only on its delegator's own page, where the board is the page's: anywhere
 * else it was opened from a link, and goes back as anything else opened
 * there does.
 */
export function viewerLevelBelow(level: ViewerLevel, floor: ViewerItem | null, pageChatId: string | null = null): ViewerLevelBelow {
  const { item } = level
  // Something opened over a chat, the board or a ticket goes back to it.
  if (level.returnTo) return { item: level.returnTo.item }

  if (item.kind === "chat") {
    const origin = {
      ...(item.delegated ? { delegated: item.delegated } : {}),
      ...(item.ticket ? { ticket: item.ticket } : {}),
    }
    const previous = item.back?.[item.back.length - 1]
    if (previous) {
      const back = item.back!.slice(0, -1)
      return { item: { kind: "chat", chatId: previous, ...(back.length > 0 ? { back } : {}), ...origin } }
    }
    // The first chat of a trail goes back to what it was picked from.
    if (item.delegated && item.ticket) return { item: { kind: "ticket", chatId: item.delegated, ticketId: item.ticket } }
    if (item.delegated) return { item: { kind: "delegated", chatId: item.delegated } }
  }
  // On its delegator's page a ticket goes back to its board, whatever opened
  // it (the board, a card in the transcript, a link). On a phone too, where
  // the board is no floor and Back from it shuts the overlay.
  if (item.kind === "ticket") {
    const boardIsFloor = floor?.kind === "delegated" && floor.chatId === item.chatId
    if (boardIsFloor || pageChatId === item.chatId) return { item: { kind: "delegated", chatId: item.chatId } }
  }

  if (!floor || sameItem(item, floor)) return "closed"
  return { item: floor }
}

/** Whether Back has somewhere to go: a level under this one that is not the pane shut. */
export function hasViewerLevelBelow(level: ViewerLevel, floor: ViewerItem | null, pageChatId: string | null = null): boolean {
  return viewerLevelBelow(level, floor, pageChatId) !== "closed"
}
