import { CHAT_TOOL_NAMES } from "../../shared/tools"
import { foldedRunLabel, foldRuns, type FoldCategory, type FoldedRun } from "./fold-runs"
import type { AgentProvider, ChatAttachment, ModelOptions } from "../../shared/types"
import {
  compareTicketsByActivity,
  TICKET_ID_PATTERN,
  TICKET_LINK_PARAM,
  ticketLinkPath,
  ticketActivity,
  type TicketChatLink,
  type TicketChatState,
  type TicketDetail,
  type TicketHistoryEvent,
  type TicketReply,
  type TicketSummary,
} from "../../shared/tickets"

/**
 * A delegator's ticket board on the client: the rules that are not drawing.
 * How the board is grouped, which one mark a ticket wears, how its activity
 * reads, which hand-offs in the delegator's transcript are a ticket's first,
 * and the link that opens one. React-free for tests. The board itself, and
 * every ticket's column, come from the server (`shared/tickets.ts`).
 */

/**
 * The board's sections, top to bottom in the pane and left to right
 * expanded. Waiting on you first: it wants the user now, and the compass
 * counts it. Then the work going on, then what is Done and not yet looked
 * at (Ready for review: Done since the ticket was last opened), then the
 * rest of Done. Opening a ticket in review reads it, and it moves to Done;
 * Mark as unread moves it back.
 */
export type TicketBoardSection = "waiting_on_you" | "in_progress" | "review" | "done"

export const TICKET_SECTION_LABELS: Record<TicketBoardSection, string> = {
  waiting_on_you: "Waiting on you",
  in_progress: "In progress",
  review: "Ready for review",
  done: "Done",
}

const SECTION_ORDER: readonly TicketBoardSection[] = ["waiting_on_you", "in_progress", "review", "done"]

export function ticketSection(ticket: Pick<TicketSummary, "state" | "unread">): TicketBoardSection {
  if (ticket.state === "done") return ticket.unread ? "review" : "done"
  return ticket.state
}

export interface TicketBoardGroup {
  section: TicketBoardSection
  label: string
  /** Every ticket in the section, for its count. */
  total: number
  /** The ones the compact list shows. */
  tickets: TicketSummary[]
  /** Done's older tickets, behind "Show N more". */
  hidden: number
  /**
   * Done's tickets older still, that the snapshot did not carry
   * (`SNAPSHOT_READ_DONE_LIMIT`): counted in `total`, never listed.
   */
  unloaded: number
}

/** Done's count: all of its tickets, the ones the snapshot left out included. */
function doneCounts(loaded: number, readDoneTotal: number | undefined) {
  const total = Math.max(loaded, readDoneTotal ?? loaded)
  return { total, unloaded: total - loaded }
}

function sectionTickets(tickets: readonly TicketSummary[], section: TicketBoardSection): TicketSummary[] {
  return tickets.filter((ticket) => ticketSection(ticket) === section).sort(compareTicketsByActivity)
}

/** How many of Done's latest the compact list shows before "Show N more". */
export const RECENT_DONE_SHOWN = 10

/**
 * The compact list's sections, empty ones left out, each latest activity
 * first. Done shows its 10 latest and keeps the rest for "Show N more": a
 * delegator's Done is most of its board within a day. Done is read tickets
 * only, the unread ones being in Ready for review, so nothing in it is news.
 */
export function groupTicketBoard(
  tickets: readonly TicketSummary[],
  { showAllDone = false, readDoneTotal }: { showAllDone?: boolean; readDoneTotal?: number } = {},
): TicketBoardGroup[] {
  return SECTION_ORDER.flatMap((section) => {
    const list = sectionTickets(tickets, section)
    const { total, unloaded } = section === "done" ? doneCounts(list.length, readDoneTotal) : { total: list.length, unloaded: 0 }
    if (total === 0) return []
    const shown = section === "done" && !showAllDone ? list.slice(0, RECENT_DONE_SHOWN) : list
    return [{ section, label: TICKET_SECTION_LABELS[section], total, tickets: shown, hidden: list.length - shown.length, unloaded }]
  })
}

/**
 * Every ticket, in the order stepping goes through them from an open one
 * (the ↑ and ↓ in its header, k and j): the list's sections, top to
 * bottom, with all of Done the snapshot carries in it, folded or behind
 * "Show N more" or not, so a step reaches each loaded one. A ticket opened
 * by a link from further back is outside it: it has no neighbours. The delegator's other chats are not tickets, and are not in it.
 */
export function ticketStepOrder(tickets: readonly TicketSummary[]): string[] {
  return groupTicketBoard(tickets, { showAllDone: true }).flatMap((group) => group.tickets.map((ticket) => ticket.id))
}

/** The ticket a step from `ticketId` lands on, or null at that end, and for a ticket not in the order. */
export function adjacentTicketId(order: readonly string[], ticketId: string, direction: "next" | "previous"): string | null {
  const index = order.indexOf(ticketId)
  if (index < 0) return null
  return order[index + (direction === "next" ? 1 : -1)] ?? null
}

/**
 * The full board's columns: the same sections, all of each. In progress,
 * Ready for review and Done hold their places, empty or not, so the board
 * does not shift as tickets move. Waiting on you is a column only while it
 * has tickets: it is the exception, and an empty column for it would be a
 * quarter of the board standing for nothing.
 */
export function ticketBoardColumns(tickets: readonly TicketSummary[], { readDoneTotal }: { readDoneTotal?: number } = {}): TicketBoardGroup[] {
  return SECTION_ORDER.flatMap((section) => {
    const list = sectionTickets(tickets, section)
    if (section === "waiting_on_you" && list.length === 0) return []
    const { total, unloaded } = section === "done" ? doneCounts(list.length, readDoneTotal) : { total: list.length, unloaded: 0 }
    return [{ section, label: TICKET_SECTION_LABELS[section], total, tickets: list, hidden: 0, unloaded }]
  })
}

/** What ends a Done list the snapshot cut short: quiet, with nothing to press. */
export function olderTicketsNote(unloaded: number): string {
  return `${unloaded.toLocaleString()} older ${unloaded === 1 ? "ticket isn't" : "tickets aren't"} shown`
}

/**
 * The one mark a ticket wears, wherever it is drawn: the sidebar's own marks
 * for the same news. In progress spins, waiting on you is the blue ping, Done
 * and unread is the green one. Done and read has no status to show, so it
 * shows what it is, as a read chat shows its harness icon.
 */
export type TicketMarkKind = "working" | "waiting" | "unread" | "read"

export function ticketMarkKind(ticket: Pick<TicketSummary, "state" | "unread">): TicketMarkKind {
  if (ticket.state === "waiting_on_you") return "waiting"
  if (ticket.state === "in_progress") return "working"
  return ticket.unread ? "unread" : "read"
}

/** Whether the ticket wants the user: its title is bold, so unread is never told by colour alone. */
export function ticketWantsUser(ticket: Pick<TicketSummary, "state" | "unread">): boolean {
  return ticket.state === "waiting_on_you" || ticket.unread
}

/** A linked chat's mark on a chip: its status while it has one, else its harness logo. */
export type TicketChipMarkKind = "working" | "waiting" | "harness"

export function ticketChipMarkKind(state: TicketChatState, queued = false): TicketChipMarkKind {
  // Queued is not at work on this yet: still, as a chat with nothing running is.
  if (queued) return "harness"
  if (state === "working") return "working"
  if (state === "waiting_on_you") return "waiting"
  return "harness"
}

/**
 * How a ticket stands, in the few words after "Sent to X" on its card in the
 * delegator's transcript: "working", "2 chats working", "asking you",
 * "finished". About the ticket, not the one chat the card names: the card is
 * the ticket's, and the chat is only where this hand-off went.
 */
export function ticketShortState(ticket: Pick<TicketSummary, "state" | "chats">): string {
  if (ticket.state === "waiting_on_you") return "asking you"
  if (ticket.state === "in_progress") {
    const live = ticket.chats.filter((chat) => chat.outstanding)
    // A queued chat is working on something else: this ticket's work has not started.
    const working = live.filter((chat) => !chat.queued && chat.state === "working").length
    if (working > 1) return `${working} chats working`
    if (working === 0 && live.some((chat) => chat.queued)) return "queued"
    return "working"
  }
  const failed = ticket.chats.some((chat) => chat.state === "failed")
  if (ticket.chats.length > 1) return `${ticket.chats.length} chats ${failed ? "done" : "finished"}`
  return failed ? "failed" : "finished"
}

// ── Activity ──────────────────────────────────────────────────────────────

/** What the activity calls the people in it. Kanna knows no name for the user, so they are "you". */
export interface TicketActivityNames {
  chat: (chatId: string) => string
  delegator: string
}

/**
 * A ticket's activity, as the pane draws it, in the transcript's own forms.
 * The user's replies are their bubbles and the delegator's are an agent's
 * text, as each would read in a chat.
 *
 * A hand-off is one row, where it was sent, standing for the chat it went to
 * and kept up to date there: working, then finished, failed or asking you.
 * Not a line for the send and another for the report, which said one thing
 * twice, a screen apart. A second hand-off to the same chat is a row of its
 * own, where it was sent.
 *
 * Everything else in the history (a close, a reopen, a rename) is a tool row
 * of its own. They come one at a time, so nothing is folded.
 *
 * The user's message opens a turn, as their prompt does in a chat, and the
 * rule with the time on it goes over it (`TimeBoundary`), the chat's way of
 * dating a prompt. Not over the first thing in the activity, as a chat's
 * first prompt has none either.
 */
export type TicketActivityBlock =
  | { type: "divider"; key: string; at: number }
  | { type: "user"; key: string; reply: TicketReply }
  | { type: "delegator"; key: string; reply: TicketReply }
  | {
    type: "handoff"
    key: string
    /** When it was sent: where the row sits. */
    at: number
    chatId: string
    /** How the work stands: from the chat's report once there is one, else the chat's own state now. */
    state: TicketChatState
    /** When the chat reported on it, finished or failed. */
    settledAt?: number
    /**
     * Still in the chat's queue, behind its other work (`TicketChatLink.queued`):
     * reads "Queued", whatever `state`, the chat's own, says.
     */
    queued?: true
  }
  | {
    type: "event"
    key: string
    at: number
    text: string
    kind: TicketHistoryEvent["kind"]
    /** The chat it names, which a click on it opens. */
    chatId?: string
  }

type HandoffBlock = Extract<TicketActivityBlock, { type: "handoff" }>

function eventText(event: TicketHistoryEvent, names: TicketActivityNames): string {
  const who = (by: "user" | "delegator" | undefined) => (by === "delegator" ? names.delegator : "you")
  switch (event.kind) {
    case "closed": return `Closed by ${who(event.by)}`
    case "reopened":
      if (event.cause === "user_reply") return "Reopened by your reply"
      if (event.cause === "chat_started") return event.chatId ? `Reopened: ${names.chat(event.chatId)} started` : "Reopened"
      return `Reopened by ${who(event.by)}`
    case "renamed": return `Renamed from ‘${event.from}’`
    // A report with no hand-off before it to land on (one sent before the
    // board kept them): said where it happened.
    case "chat_finished": return `${names.chat(event.chatId)} finished`
    case "chat_failed": return `${names.chat(event.chatId)} failed`
    case "chat_asking": return `${names.chat(event.chatId)} is asking you`
    case "sent_to": return `Sent to ${names.chat(event.chatId)}`
  }
}

export function ticketActivityBlocks(
  ticket: Pick<TicketDetail, "replies" | "history" | "chats">,
  names: TicketActivityNames,
): TicketActivityBlock[] {
  const blocks: TicketActivityBlock[] = []
  // Each chat's hand-offs still waiting on its report. A final report clears
  // every one of them (the server's rule), so it settles them all.
  const open = new Map<string, HandoffBlock[]>()
  const asked = new Set<HandoffBlock>()

  for (const item of ticketActivity(ticket)) {
    if (item.type === "reply") {
      const mine = item.reply.author === "user"
      if (mine && blocks.length > 0) blocks.push({ type: "divider", key: `${item.reply.id}:divider`, at: item.at })
      blocks.push({ type: mine ? "user" : "delegator", key: item.reply.id, reply: item.reply })
      continue
    }
    const event = item.event
    if (event.kind === "sent_to") {
      // A second message to a chat still on the first, with nothing between
      // them (a steer, or a follow-up straight after), is the same piece of
      // work, which one report will settle: the first row stands for both.
      // With a reply or an event between, each keeps its own row and point.
      const last = blocks.at(-1)
      if (last?.type === "handoff" && last.chatId === event.chatId && open.get(event.chatId)?.includes(last)) {
        asked.delete(last)
        continue
      }
      const block: HandoffBlock = { type: "handoff", key: event.id, at: event.createdAt, chatId: event.chatId, state: "working" }
      blocks.push(block)
      open.set(event.chatId, [...(open.get(event.chatId) ?? []), block])
      continue
    }
    if (event.kind === "chat_finished" || event.kind === "chat_failed" || event.kind === "chat_asking") {
      const waiting = open.get(event.chatId) ?? []
      if (waiting.length > 0) {
        if (event.kind === "chat_asking") {
          for (const block of waiting) asked.add(block)
        } else {
          for (const block of waiting) {
            block.state = event.kind === "chat_finished" ? "finished" : "failed"
            block.settledAt = event.createdAt
            asked.delete(block)
          }
          open.delete(event.chatId)
        }
        continue
      }
    }
    const chatId = "chatId" in event && typeof event.chatId === "string" ? event.chatId : undefined
    blocks.push({ type: "event", key: event.id, at: event.createdAt, text: eventText(event, names), kind: event.kind, ...(chatId ? { chatId } : {}) })
  }

  // What has not reported reads as its chat does now: still working, asking,
  // or stopped without a word.
  const live = new Map(ticket.chats.map((link) => [link.chatId, link]))
  for (const waiting of open.values()) {
    for (const block of waiting) {
      const link = live.get(block.chatId)
      block.state = link?.state ?? (asked.has(block) ? "waiting_on_you" : "working")
      if (link?.queued) block.queued = true
    }
  }
  return blocks
}

/**
 * The activity's rows as the transcript folds its tool calls (`foldRuns`):
 * hand-offs and events are the tool rows, and two or more in a row are one
 * folded group; replies, like an agent's text, end a run. Same-chat
 * hand-offs are already one block (`ticketActivityBlocks`), so a group never
 * holds two rows for one piece of work.
 */
export function ticketActivityRows(blocks: readonly TicketActivityBlock[]): FoldedRun<TicketActivityBlock>[] {
  return foldRuns(blocks, (block) => block.type === "handoff" || block.type === "event")
}

const HANDOFF_CATEGORY: FoldCategory = { key: "handoff", singular: "hand-off", plural: "hand-offs" }
const EVENT_CATEGORIES: Record<TicketHistoryEvent["kind"], FoldCategory> = {
  sent_to: HANDOFF_CATEGORY,
  closed: { key: "closed", singular: "close", plural: "closes" },
  reopened: { key: "reopened", singular: "reopen", plural: "reopens" },
  renamed: { key: "renamed", singular: "rename", plural: "renames" },
  chat_finished: { key: "report", singular: "report", plural: "reports" },
  chat_failed: { key: "report", singular: "report", plural: "reports" },
  chat_asking: { key: "report", singular: "report", plural: "reports" },
}

/** A folded group's line, as a tool group's: "1 close, 1 reopen, 2 hand-offs". */
export function ticketActivityGroupLabel(blocks: readonly TicketActivityBlock[]): string {
  return foldedRunLabel(blocks, (block) => (block.type === "event" ? EVENT_CATEGORIES[block.kind] : HANDOFF_CATEGORY))
}

/** Whether a group is still at work, as a tool group with a call in flight is: a chat in it is working. */
export function ticketActivityGroupRunning(blocks: readonly TicketActivityBlock[]): boolean {
  return blocks.some((block) => block.type === "handoff" && block.state === "working" && !block.queued)
}

/**
 * What a ticket waiting on the user waits for, for the line under its title:
 * the delegator's open question (its reply with `asksUser`, the latest), or
 * the chat that is asking. Null when it waits on nothing. A queued chat's
 * state is about its other work, so it is not the one asking.
 */
export type TicketOpenQuestion =
  | { kind: "reply"; replyId: string; text: string }
  | { kind: "chat"; chatId: string; text: string }

export function ticketOpenQuestion(
  ticket: Pick<TicketDetail, "state" | "asksUser" | "replies" | "chats">,
  chatTitle: (chatId: string) => string,
): TicketOpenQuestion | null {
  if (ticket.state !== "waiting_on_you") return null
  if (ticket.asksUser) {
    const reply = [...ticket.replies].reverse().find((candidate) => candidate.author === "delegator" && candidate.asksUser)
    if (reply) return { kind: "reply", replyId: reply.id, text: firstLine(reply.text) ?? "The delegator asks you something" }
  }
  const asking = ticket.chats.find((link) => link.outstanding && !link.queued && link.state === "waiting_on_you")
  return asking ? { kind: "chat", chatId: asking.chatId, text: `${chatTitle(asking.chatId)} is asking you` } : null
}

/** A markdown text's first line of words, without its block marks (a heading's #, a list's -, a quote's >). */
function firstLine(text: string): string | null {
  for (const line of text.split("\n")) {
    const words = line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)*/, "").replace(/[*_`]/g, "").trim()
    if (words) return words
  }
  return null
}

/**
 * The rule between a ticket's body and its activity: how many replies there
 * are, the user's and the delegator's. Not the hand-offs and other events,
 * which are not anything anyone said.
 */
export function ticketRepliesLabel(count: number): string {
  if (count === 0) return "No replies yet"
  return `${count} ${count === 1 ? "reply" : "replies"}`
}

/** What a hand-off's row says of it: "Working", "Finished", "Asking you". */
export function handoffStateLabel(state: TicketChatState): string {
  switch (state) {
    case "working": return "Working"
    case "waiting_on_you": return "Asking you"
    case "finished": return "Finished"
    case "failed": return "Failed"
    case "stopped": return "Stopped"
  }
}

// ── The delegator's transcript ────────────────────────────────────────────

/** A hand-off's ticket, as its tool call carries it. */
export interface HandoffTicketRef {
  ticketId: string
  /** From the call itself, for a ticket the board no longer has. */
  number: number | null
  /** The hand-off took the ticket back out of Done (the result's `ticket.reopened`). */
  reopened?: true
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** A result as an object: one already, or an older record's JSON in a text block. */
function resultObject(result: unknown): Record<string, unknown> | null {
  const direct = record(result)
  if (direct) return direct
  const first = Array.isArray(result) ? record(result[0])?.text : result
  if (typeof first !== "string" || !first.trim()) return null
  try {
    return record(JSON.parse(first))
  } catch {
    return null
  }
}

function ticketIdOf(value: unknown): string | null {
  return typeof value === "string" && TICKET_ID_PATTERN.test(value) ? value : null
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}

/** As much of a transcript row as says whether it is a hand-off. */
export interface HandoffCandidate {
  id: string
  kind: string
  toolKind?: string
  toolName?: string
  isError?: boolean
  input?: { payload?: Record<string, unknown> }
  rawResult?: unknown
  /** Set once the call has returned. */
  resultEntryId?: string
}

/**
 * The ticket a delegator's `create_chat`, `send_message` or `fork_chat` was
 * for, or null for any other row, a failed call, and a hand-off from an
 * ordinary chat. A returned call says it in its result (`ticket: { id,
 * number }`), and one without that field was not for a ticket. A call still
 * in flight is read from what it asked for (`ticketId` in its input), so its
 * card is the ticket's from the start.
 */
export function handoffTicketOf(message: HandoffCandidate): HandoffTicketRef | null {
  if (message.kind !== "tool" || message.isError) return null
  const named = message.toolKind === "chat" || (message.toolKind === "unknown_tool" && CHAT_TOOL_NAMES.includes(message.toolName ?? ""))
  if (!named) return null
  if (!message.resultEntryId && message.rawResult === undefined) {
    const asked = ticketIdOf(message.input?.payload?.ticketId)
    return asked ? { ticketId: asked, number: null } : null
  }
  const ticket = record(resultObject(message.rawResult)?.ticket)
  const ticketId = ticketIdOf(ticket?.id)
  if (!ticketId) return null
  return { ticketId, number: numberOf(ticket?.number), ...(ticket?.reopened === true ? { reopened: true as const } : {}) }
}

/**
 * The hand-offs that are not their ticket's first in what the transcript
 * holds: each draws as a slim "Also sent to" line, since the ticket's card
 * is already further up. Over the loaded window, so the earliest loaded
 * hand-off of a ticket is its card even when an older one is not loaded.
 */
export function repeatHandoffIds(messages: readonly HandoffCandidate[]): Set<string> {
  const seen = new Set<string>()
  const repeats = new Set<string>()
  for (const message of messages) {
    const ref = handoffTicketOf(message)
    if (!ref) continue
    if (seen.has(ref.ticketId)) repeats.add(message.id)
    else seen.add(ref.ticketId)
  }
  return repeats
}

/**
 * The ticket numbers each sub-chat's part of a report is for: the report
 * source's `tickets` (the hand-offs it still owed a report on, by chat),
 * numbered from the board. A ticket the board does not have is left out, as
 * is a chat with none: a report to an ordinary chat, or on work handed out
 * before the board.
 */
export function reportTicketNumbers(
  tickets: Readonly<Record<string, readonly string[]>> | undefined,
  numberOf: (ticketId: string) => number | undefined,
): Map<string, number[]> {
  const numbers = new Map<string, number[]>()
  for (const [chatId, ids] of Object.entries(tickets ?? {})) {
    const found = [...new Set(ids)].flatMap((id) => {
      const number = numberOf(id)
      return number === undefined ? [] : [number]
    })
    if (found.length > 0) numbers.set(chatId, found.sort((a, b) => a - b))
  }
  return numbers
}

/** Ticket numbers as a report line or a quote names them: "#13", "#13, #14". */
export function formatTicketNumbers(numbers: readonly number[]): string {
  return numbers.map((number) => `#${number}`).join(", ")
}

// ── Replying ──────────────────────────────────────────────────────────────

/**
 * Where a ticket's composer keeps its draft (`chatInputStore`): its own key,
 * apart from the delegator chat's draft and from every other ticket's. Not
 * a chat id, so nothing that reads drafts as chats can take it for one.
 */
export function ticketDraftKey(delegatorChatId: string, ticketId: string): string {
  return `ticket:${delegatorChatId}:${ticketId}`
}

/** The composer's settings for the turn a reply starts, as `chat.send` carries them. */
export interface TicketReplyRun {
  provider?: AgentProvider
  model?: string
  modelOptions?: ModelOptions
  planMode?: boolean
  autoPlan?: boolean
}

/**
 * The command a reply sends: what was typed, trimmed, the composer's
 * uploads as they came back from the upload route (the shape a chat's
 * message carries them in), and its settings. None of either is left out
 * rather than sent empty.
 */
export function ticketReplyCommand(
  delegatorChatId: string,
  ticketId: string,
  text: string,
  attachments: readonly ChatAttachment[] = [],
  run: TicketReplyRun = {},
) {
  const settings = Object.fromEntries(Object.entries(run).filter(([, value]) => value !== undefined)) as TicketReplyRun
  return {
    type: "ticket.reply" as const,
    chatId: delegatorChatId,
    ticketId,
    text: text.trim(),
    ...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
    ...settings,
  }
}

// ── Links ─────────────────────────────────────────────────────────────────

export { TICKET_LINK_PARAM, ticketLinkPath }

/**
 * Whether a click on a ticket's link opens it in the page's pane: a plain
 * click, on a page with a pane that shows chats. A modified or middle click,
 * or a page with no pane, follows the address instead.
 */
export function opensTicketInPane(
  event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  canPreview: boolean,
): boolean {
  return canPreview && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * A click on a ticket's link: in the pane when `opensTicketInPane` says so,
 * and the address's otherwise. `open` is what puts a ticket in the pane.
 */
export function handleTicketLinkClick(
  event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean; preventDefault: () => void },
  ticket: { chatId: string; ticketId: string },
  { canPreview, open }: { canPreview: boolean; open: (ticket: { chatId: string; ticketId: string }) => void },
) {
  if (event.defaultPrevented || !opensTicketInPane(event, canPreview)) return
  event.preventDefault()
  open(ticket)
}

/**
 * The ticket a link in a message names, `/chat/<delegatorChatId>?ticket=<ticketId>`
 * (`ticketLinkPath`), from the path a chat link parses to (`parseChatLink`).
 * Null for a link to a chat alone, and for anything that is not a ticket id.
 */
export function parseTicketLink(path: string): { chatId: string; ticketId: string } | null {
  const match = /^\/chat\/([a-zA-Z0-9_-]+)\/?(\?[^#]*)?/.exec(path)
  if (!match?.[2]) return null
  const ticketId = readTicketLinkParam(match[2])
  return ticketId ? { chatId: match[1]!, ticketId } : null
}

/** The ticket a page's query asks to open, or null. Anything that is not a ticket id is ignored. */
export function readTicketLinkParam(search: string): string | null {
  const value = new URLSearchParams(search).get(TICKET_LINK_PARAM)
  return value && TICKET_ID_PATTERN.test(value) ? value : null
}

/** The same query without the ticket in it: the link is spent once the ticket is open. */
export function withoutTicketLinkParam(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(TICKET_LINK_PARAM)
  const rest = params.toString()
  return rest ? `?${rest}` : ""
}

// ── Time ──────────────────────────────────────────────────────────────────

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

/**
 * A ticket's time on a row, a card or a line: the clock today, the weekday
 * this week, the date before that. Short enough to sit in tabular figures at
 * the end of a row.
 */
export function formatTicketTime(at: number, nowMs: number): string {
  const date = new Date(at)
  const now = new Date(nowMs)
  if (sameDay(date, now)) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  if (nowMs - at < 6 * 24 * 60 * 60 * 1000 && at < nowMs) return date.toLocaleDateString(undefined, { weekday: "short" })
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) })
}

/** The full date and time, for the tooltip on a relative one. */
export function formatTicketFullTime(at: number): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

/** The linked chat a hand-off went to, for its card: by id, else the latest. */
export function handoffChat(ticket: Pick<TicketSummary, "chats">, chatId: string | null): TicketChatLink | null {
  return (chatId ? ticket.chats.find((chat) => chat.chatId === chatId) : null) ?? ticket.chats[0] ?? null
}
