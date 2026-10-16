import { useLayoutEffect } from "react"
import { create } from "zustand"
import type { TicketSummary } from "../../shared/tickets"
import type { ChatSnapshot } from "../../shared/types"

/**
 * Each delegator's ticket board, as its chat snapshot last carried it.
 *
 * The board is drawn in the viewer's pane and the delegator's tickets in its
 * transcript, and only the chat page holds the snapshot they come from. So
 * the page puts the board here (`publishTicketBoard`) and both read it from
 * here, rather than the snapshot being threaded down to the viewer.
 */
export interface TicketBoard {
  tickets: TicketSummary[]
  untrackedChatIds: string[]
  attention: number
  /**
   * How many read Done tickets there are in all. `tickets` holds only the
   * latest of them (`SNAPSHOT_READ_DONE_LIMIT`). Absent from a server that
   * sends them all, and then it is however many `tickets` has.
   */
  readDoneTotal?: number
}

interface TicketBoardState {
  boards: Record<string, TicketBoard>
}

const NO_CHATS: string[] = []

export const useTicketBoardStore = create<TicketBoardState>()(() => ({ boards: {} }))

/**
 * What a chat snapshot says of its board, or null for a chat that has none:
 * an ordinary chat, or a delegator on a server from before tickets.
 */
export function ticketBoardOf(snapshot: Pick<ChatSnapshot, "tickets" | "untrackedChatIds" | "ticketAttention" | "readDoneTotal"> | null): TicketBoard | null {
  if (!snapshot?.tickets) return null
  return {
    tickets: snapshot.tickets,
    untrackedChatIds: snapshot.untrackedChatIds ?? NO_CHATS,
    attention: snapshot.ticketAttention ?? 0,
    ...(snapshot.readDoneTotal !== undefined ? { readDoneTotal: snapshot.readDoneTotal } : {}),
  }
}

/** Kept by identity: the snapshot fold keeps the board's arrays while they are unchanged. */
export function publishTicketBoard(chatId: string, board: TicketBoard | null) {
  const current = useTicketBoardStore.getState().boards[chatId]
  if (!board) {
    if (!current) return
    const { [chatId]: _, ...rest } = useTicketBoardStore.getState().boards
    useTicketBoardStore.setState({ boards: rest })
    return
  }
  if (current && current.tickets === board.tickets && current.untrackedChatIds === board.untrackedChatIds && current.attention === board.attention && current.readDoneTotal === board.readDoneTotal) return
  useTicketBoardStore.setState((state) => ({ boards: { ...state.boards, [chatId]: board } }))
}

/** A delegator's board, or null until its snapshot has brought one. */
export function useTicketBoard(chatId: string | null | undefined): TicketBoard | null {
  return useTicketBoardStore((state) => (chatId ? state.boards[chatId] ?? null : null))
}

/** One ticket's summary off its delegator's board. */
export function useTicketSummary(chatId: string | null | undefined, ticketId: string | null | undefined): TicketSummary | null {
  return useTicketBoardStore((state) => {
    if (!chatId || !ticketId) return null
    return state.boards[chatId]?.tickets.find((ticket) => ticket.id === ticketId) ?? null
  })
}

/**
 * Puts a chat snapshot's board in the store, for a page or previewer that
 * holds one. Before paint, so a board opened with the page has its rows.
 */
export function usePublishTicketBoard(snapshot: ChatSnapshot | null) {
  const chatId = snapshot?.runtime.chatId
  const tickets = snapshot?.tickets
  const untrackedChatIds = snapshot?.untrackedChatIds
  const attention = snapshot?.ticketAttention
  const readDoneTotal = snapshot?.readDoneTotal
  useLayoutEffect(() => {
    if (!chatId) return
    publishTicketBoard(chatId, ticketBoardOf({ tickets, untrackedChatIds, ticketAttention: attention, readDoneTotal }))
  }, [attention, chatId, readDoneTotal, tickets, untrackedChatIds])
}
