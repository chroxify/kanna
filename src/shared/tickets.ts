import type { DisplayAttachment } from "./display-tools"
import type { ChatAttachment } from "./types"
import type { VisualizationArtifact } from "./visualization"

/**
 * A delegator's ticket board: every piece of work it hands out, as tickets.
 *
 * Only a delegator (`ChatRecord.delegator`) has one. Its transcript is
 * unchanged; the board is a layer over it, kept in its own event file on the
 * server (`ticket-store.ts`). The one link between a chat and a ticket is a
 * hand-off: every `create_chat`, `send_message` and `fork_chat` a delegator
 * makes names a ticket. There is no manual linking.
 *
 * A ticket's column is never stored. It is derived here, from what is stored
 * and from how its chats stand right now, so the client and the server read
 * the same board from the same rules.
 */

/** The board's three columns. */
export type TicketState = "waiting_on_you" | "in_progress" | "done"

export const TICKET_STATES: readonly TicketState[] = ["waiting_on_you", "in_progress", "done"]

export type TicketAuthor = "user" | "delegator"

/**
 * A file on a reply, by reference: the same objects `show_visualization` and
 * `send_attachments` put in a transcript. A visualization's HTML stays in its
 * media file (`media/<chatId>/visualization-<uuid>.html`) and only its URL is
 * here, so the board never carries a document inline.
 */
export type TicketArtifact = VisualizationArtifact | DisplayAttachment

export interface TicketReply {
  id: string
  ticketId: string
  author: TicketAuthor
  /** Markdown. */
  text: string
  /** Media the delegator posted with `reply_to_ticket`, `show_visualization` or `send_attachments`. */
  artifacts?: TicketArtifact[]
  /** Files the user attached in the ticket's composer. */
  attachments?: ChatAttachment[]
  /** A delegator reply that needs an answer. The ticket waits on the user until they reply. */
  asksUser?: true
  createdAt: number
}

/**
 * The quiet lines in a ticket's activity, beside its replies. Every one of
 * them bumps `updatedAt`. Collapsing runs of them is the client's job.
 */
export type TicketHistoryEvent = TicketHistoryBase & (
  /** The delegator handed work on this ticket to a chat. */
  | { kind: "sent_to"; chatId: string }
  /** A chat reported its result. */
  | { kind: "chat_finished"; chatId: string }
  | { kind: "chat_failed"; chatId: string }
  /** A chat stopped to ask the user something, or for plan approval. */
  | { kind: "chat_asking"; chatId: string }
  | { kind: "closed"; by: TicketAuthor }
  /**
   * Back out of Done. `user_reply`: the user replied on it. `chat_started`:
   * the delegator handed more work on it (`chatId`). `manual`: someone
   * reopened it (`by`).
   */
  | { kind: "reopened"; cause: "user_reply" | "chat_started" | "manual"; chatId?: string; by?: TicketAuthor }
  | { kind: "renamed"; from: string }
)

interface TicketHistoryBase {
  id: string
  ticketId: string
  createdAt: number
}

export type TicketHistoryKind = TicketHistoryEvent["kind"]

/**
 * One piece of work handed to a chat for a ticket. Minted for every
 * `create_chat`, `send_message` and `fork_chat` a delegator makes.
 * `outstanding` holds until the chat's next final report (an interim one,
 * "not its last word", leaves it), or until the chat stops owing one: the
 * delegator stopped it, another chat adopted it, or it was deleted.
 */
export interface TicketHandoff {
  delegationId: string
  ticketId: string
  childChatId: string
  createdAt: number
  outstanding: boolean
  /**
   * The chat's turn its message went into (`turnCount` once that turn had
   * started). A report settles exactly the hand-offs of the turns it covers,
   * so one chat given several tickets in a row settles them one by one. Null
   * while the message waits in the chat's queue; absent on hand-offs from
   * before turns were recorded, which the chat's next final report settles.
   */
  turn?: number | null
  /** While `turn` is null: the queued message that carries it. */
  queuedMessageId?: string
}

/** The last explicit close or reopen. Absent when nobody has done either. */
export interface TicketClosure {
  status: "done" | "open"
  by: TicketAuthor
  at: number
}

/**
 * A ticket as stored, folded from its event file. What the board shows of it
 * is derived (`summarizeTicket`, `describeTicket`).
 */
export interface TicketRecord {
  /** Short, so an agent can copy it: `tk_6f0c2a`. */
  id: string
  delegatorChatId: string
  /** 1, 2, 3… per delegator. */
  number: number
  title: string
  /** Markdown: what the work is and what done looks like. Never progress. */
  body: string
  bodyEditedAt?: number
  createdAt: number
  /** The latest thing in its activity: a reply or a history event. */
  updatedAt: number
  closed?: TicketClosure
  /** Set by a delegator reply with `asksUser`, cleared by the user's next reply. */
  asksUser: boolean
  /** Set by a user reply, cleared by the delegator's next reply on, or hand-off from, the ticket. */
  awaitingDelegator: boolean
  /** When the user last read it. Absent: never read, or marked unread. */
  readAt?: number
  replies: TicketReply[]
  history: TicketHistoryEvent[]
  handoffs: TicketHandoff[]
}

/**
 * How a chat on a ticket stands right now, as far as the board cares.
 * `waiting_on_you`: it asked a question or awaits plan approval (the
 * sidebar's `waiting_for_user`). `working`: running, queued, or waiting on
 * work it handed off (`isWorkingStatus`). The rest is how its last turn ended.
 */
export type TicketChatState = "working" | "waiting_on_you" | "finished" | "failed" | "stopped"

/** What the board needs to know of a chat, supplied by whoever derives it. */
export interface TicketChatInfo {
  chatId: string
  title: string
  state: TicketChatState
}

/** A chat on a ticket: one with at least one hand-off for it, past or outstanding. */
export interface TicketChatLink {
  chatId: string
  title: string
  state: TicketChatState
  /** A hand-off on this ticket still waits on this chat's final report. */
  outstanding: boolean
  /**
   * Every outstanding hand-off to it on this ticket still waits in the chat's
   * queue, behind work it is doing for something else: this ticket's work has
   * not started. `state` is still the chat's own (often `working`), so read
   * this first. Absent otherwise.
   */
  queued?: true
  /** The latest hand-off to it on this ticket. */
  lastSentAt: number
}

/** A row on the board. The delegator's chat snapshot carries all of them (`ChatSnapshot.tickets`). */
export interface TicketSummary {
  id: string
  delegatorChatId: string
  number: number
  title: string
  state: TicketState
  /** One line on how it stands: "Sub-Chat Preview Panel is working", "Queued in Web UI", "Asks you", "2 chats finished". */
  statusLine: string
  /** Every chat it was handed to, latest hand-off first. */
  chats: TicketChatLink[]
  createdAt: number
  updatedAt: number
  unread: boolean
  replyCount: number
}

/** One ticket whole, pushed on the `ticket` topic. */
export interface TicketDetail extends TicketSummary {
  body: string
  bodyEditedAt?: number
  closed?: TicketClosure
  asksUser: boolean
  awaitingDelegator: boolean
  readAt?: number
  /** Oldest first. */
  replies: TicketReply[]
  /** Oldest first. */
  history: TicketHistoryEvent[]
}

/** A reply or a history line, in the order the activity shows them. */
export type TicketActivityItem =
  | { type: "reply"; at: number; reply: TicketReply }
  | { type: "history"; at: number; event: TicketHistoryEvent }

/** `tk_` and six hex digits. */
export const TICKET_ID_PATTERN = /^tk_[0-9a-f]{6,}$/

// ── Derivation ────────────────────────────────────────────────────────────

type ChatLookup = ReadonlyMap<string, TicketChatInfo> | ((chatId: string) => TicketChatInfo | undefined)

function lookup(chats: ChatLookup, chatId: string): TicketChatInfo | undefined {
  return typeof chats === "function" ? chats(chatId) : chats.get(chatId)
}

/**
 * The ticket's chats, latest hand-off first. A chat the lookup does not know
 * (deleted) is left out, and a hand-off to it counts as settled.
 */
export function ticketChatLinks(ticket: TicketRecord, chats: ChatLookup): TicketChatLink[] {
  const byChat = new Map<string, TicketChatLink>()
  // Per chat: whether any outstanding hand-off to it has left the queue.
  const started = new Set<string>()
  for (const handoff of ticket.handoffs) {
    const info = lookup(chats, handoff.childChatId)
    if (!info) continue
    if (handoff.outstanding && !isQueuedHandoff(handoff)) started.add(handoff.childChatId)
    const link = byChat.get(handoff.childChatId)
    if (link) {
      link.outstanding ||= handoff.outstanding
      link.lastSentAt = Math.max(link.lastSentAt, handoff.createdAt)
    } else {
      byChat.set(handoff.childChatId, {
        chatId: info.chatId,
        title: info.title,
        state: info.state,
        outstanding: handoff.outstanding,
        lastSentAt: handoff.createdAt,
      })
    }
  }
  for (const link of byChat.values()) {
    if (link.outstanding && !started.has(link.chatId)) link.queued = true
  }
  return [...byChat.values()].sort((a, b) => b.lastSentAt - a.lastSentAt)
}

/** A hand-off whose message waits in its chat's queue: in no turn yet. */
export function isQueuedHandoff(handoff: Pick<TicketHandoff, "outstanding" | "turn" | "queuedMessageId">): boolean {
  return handoff.outstanding && handoff.turn === null && handoff.queuedMessageId !== undefined
}

/**
 * The column, by these rules, first match wins:
 *
 * 1. Waiting on you: a chat with an outstanding hand-off is waiting for the
 *    user, or the delegator asked the user (`asksUser`).
 * 2. In progress: a chat with an outstanding hand-off is working, the work
 *    waits in a chat's queue (`queued`), or the user replied and the
 *    delegator has not (`awaitingDelegator`).
 * 3. Done: explicitly closed. A working or waiting chat beats a close (1, 2).
 * 4. In progress: no hand-offs yet, a hand-off still outstanding (its chat
 *    is idle and the report is on its way), or reopened by hand with no
 *    hand-off since.
 * 5. Done.
 *
 * A chat working for two tickets is active on both while both hand-offs are
 * outstanding: only outstanding hand-offs make a chat count here. One whose
 * hand-off for this ticket is still queued is not at work on it, so its own
 * state (asking about other work, say) does not count, only that it is queued.
 */
export function deriveTicketState(ticket: TicketRecord, links: readonly TicketChatLink[]): TicketState {
  const live = links.filter((link) => link.outstanding)
  const started = live.filter((link) => !link.queued)
  if (ticket.asksUser || started.some((link) => link.state === "waiting_on_you")) return "waiting_on_you"
  if (ticket.awaitingDelegator || started.some((link) => link.state === "working") || live.some((link) => link.queued)) return "in_progress"
  if (ticket.closed?.status === "done") return "done"
  if (ticket.handoffs.length === 0 || live.length > 0) return "in_progress"
  const reopened = ticket.closed?.status === "open" ? ticket.closed.at : null
  if (reopened !== null && !ticket.handoffs.some((handoff) => handoff.createdAt >= reopened)) return "in_progress"
  return "done"
}

/**
 * Unread is a Done ticket with activity the user has not read. Becoming Done
 * always comes with a line in the activity (a chat's report, a close, the
 * delegator's reply), so "became Done, or got news while Done, after
 * `readAt`" is `updatedAt` past `readAt`.
 */
export function isTicketUnread(ticket: Pick<TicketRecord, "updatedAt" | "readAt">, state: TicketState): boolean {
  return state === "done" && (ticket.readAt === undefined || ticket.readAt < ticket.updatedAt)
}

function chatCount(count: number) {
  return `${count} chat${count === 1 ? "" : "s"}`
}

/** The board's one line for a ticket. */
export function ticketStatusLine(ticket: TicketRecord, state: TicketState, links: readonly TicketChatLink[]): string {
  const live = links.filter((link) => link.outstanding)
  const started = live.filter((link) => !link.queued)
  if (state === "waiting_on_you") {
    const asking = started.filter((link) => link.state === "waiting_on_you")
    if (asking.length === 1) return `Waiting on you in ${asking[0]!.title}`
    if (asking.length > 1) return `${chatCount(asking.length)} waiting on you`
    return "Asks you"
  }
  if (state === "in_progress") {
    const working = started.filter((link) => link.state === "working")
    if (working.length === 1) return `${working[0]!.title} is working`
    if (working.length > 1) return `${working.length} chats working`
    const queued = live.filter((link) => link.queued)
    if (queued.length === 1) return `Queued in ${queued[0]!.title}`
    if (queued.length > 1) return `Queued in ${chatCount(queued.length)}`
    if (ticket.awaitingDelegator) return "Waiting on the delegator"
    if (live.length === 1) return `${live[0]!.title} is reporting`
    if (live.length > 1) return `${live.length} chats reporting`
    if (ticket.handoffs.length === 0) return "Not started"
    return "Reopened"
  }
  if (links.length === 0) return ticket.closed?.status === "done" ? "Closed" : "Finished"
  const failed = links.filter((link) => link.state === "failed")
  if (links.length === 1) {
    const only = links[0]!
    return `${only.title} ${only.state === "failed" ? "failed" : only.state === "stopped" ? "was stopped" : "finished"}`
  }
  if (failed.length > 0) return `${chatCount(links.length)} finished, ${failed.length} failed`
  return `${chatCount(links.length)} finished`
}

export function summarizeTicket(ticket: TicketRecord, chats: ChatLookup): TicketSummary {
  const links = ticketChatLinks(ticket, chats)
  const state = deriveTicketState(ticket, links)
  return {
    id: ticket.id,
    delegatorChatId: ticket.delegatorChatId,
    number: ticket.number,
    title: ticket.title,
    state,
    statusLine: ticketStatusLine(ticket, state, links),
    chats: links,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    unread: isTicketUnread(ticket, state),
    replyCount: ticket.replies.length,
  }
}

export function describeTicket(ticket: TicketRecord, chats: ChatLookup): TicketDetail {
  return {
    ...summarizeTicket(ticket, chats),
    body: ticket.body,
    ...(ticket.bodyEditedAt !== undefined ? { bodyEditedAt: ticket.bodyEditedAt } : {}),
    ...(ticket.closed ? { closed: ticket.closed } : {}),
    asksUser: ticket.asksUser,
    awaitingDelegator: ticket.awaitingDelegator,
    ...(ticket.readAt !== undefined ? { readAt: ticket.readAt } : {}),
    replies: ticket.replies,
    history: ticket.history,
  }
}

/** The compass button's count: tickets waiting on the user, and Done tickets not yet read. */
export function ticketAttentionCount(tickets: readonly Pick<TicketSummary, "state" | "unread">[]): number {
  return tickets.filter((ticket) => ticket.state === "waiting_on_you" || ticket.unread).length
}

/** Replies and history lines, oldest first. A reply sorts after a line made in the same millisecond. */
export function ticketActivity(ticket: Pick<TicketDetail, "replies" | "history">): TicketActivityItem[] {
  const items: TicketActivityItem[] = [
    ...ticket.history.map((event) => ({ type: "history" as const, at: event.createdAt, event })),
    ...ticket.replies.map((reply) => ({ type: "reply" as const, at: reply.createdAt, reply })),
  ]
  return items.sort((a, b) => a.at - b.at || (a.type === b.type ? 0 : a.type === "history" ? -1 : 1))
}

/**
 * How many read Done tickets a delegator's chat snapshot carries: the latest
 * by activity. The board is sent whole on every change, and Done is most of
 * it before long, so past this the oldest stay in the store and are left out
 * of the snapshot. A link still opens one (the `ticket` topic reads the
 * store), and the ticket tools still reach them all.
 */
export const SNAPSHOT_READ_DONE_LIMIT = 100

/**
 * The board as the snapshot carries it: every ticket that is not Done, every
 * unread Done one (nothing waiting to be read is dropped), and the latest
 * `limit` read Done ones. `readDoneTotal` is how many read Done tickets
 * there are in all, for the list's count.
 */
export function snapshotTickets(
  tickets: readonly TicketSummary[],
  limit = SNAPSHOT_READ_DONE_LIMIT,
): { tickets: TicketSummary[]; readDoneTotal: number } {
  const readDone = tickets.filter((ticket) => ticket.state === "done" && !ticket.unread)
  const kept = new Set([...readDone].sort(compareTicketsByActivity).slice(0, limit).map((ticket) => ticket.id))
  return {
    tickets: tickets.filter((ticket) => ticket.state !== "done" || ticket.unread || kept.has(ticket.id)),
    readDoneTotal: readDone.length,
  }
}

/** Board order within a column: latest activity first. */
export function compareTicketsByActivity(a: Pick<TicketSummary, "updatedAt" | "number">, b: Pick<TicketSummary, "updatedAt" | "number">) {
  return b.updatedAt - a.updatedAt || b.number - a.number
}

// ── Links ─────────────────────────────────────────────────────────────────

/** The query parameter that opens a ticket over its delegator's chat. */
export const TICKET_LINK_PARAM = "ticket"

/**
 * A ticket's address, and the one form of a link to it: its delegator's
 * chat with the ticket open in the pane, `/chat/<delegatorChatId>?ticket=<ticketId>`.
 * It names the delegator, so any page opens it with nothing to look up, and
 * as a page's address it opens the delegator with the ticket over it. The
 * tools hand it to agents ready-made (`link`), so its length costs nothing.
 */
export function ticketLinkPath(delegatorChatId: string, ticketId: string): string {
  return `/chat/${encodeURIComponent(delegatorChatId)}?${TICKET_LINK_PARAM}=${encodeURIComponent(ticketId)}`
}
