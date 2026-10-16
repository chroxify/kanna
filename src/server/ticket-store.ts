import { appendFile, mkdir, readdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  TicketClosure,
  TicketHandoff,
  TicketHistoryEvent,
  TicketRecord,
  TicketReply,
} from "../shared/tickets"

/**
 * Where a delegator's tickets live: one append-only event file per delegator,
 * `tickets/<delegatorChatId>.jsonl`, folded into memory on boot.
 *
 * Kept apart from the EventStore's logs because nothing else reads it, and a
 * board only ever grows by small events (a reply, a history line, a hand-off).
 * Like the EventStore's logs it is compacted: once a file passes
 * `COMPACTION_THRESHOLD_BYTES` it is rewritten as one `board_snapshot` line,
 * and appends carry on after it. A crash mid-rewrite leaves the old file, as
 * the snapshot goes to a temp file that is renamed over.
 *
 * This file stores and folds. The rules (what a reply clears, when a ticket
 * reopens) are the orchestrator's, in `ticket-board.ts`.
 */

const TICKET_LOG_VERSION = 1
const COMPACTION_THRESHOLD_BYTES = 512 * 1024
const LOG_PREFIX = "[kanna/tickets]"

export type TicketStoreEvent = { v: typeof TICKET_LOG_VERSION; at: number } & (
  | { type: "ticket_created"; ticket: Pick<TicketRecord, "id" | "number" | "title" | "body"> }
  | { type: "ticket_edited"; ticketId: string; title?: string; body?: string }
  | { type: "reply_added"; reply: TicketReply }
  | { type: "history_added"; event: TicketHistoryEvent }
  | { type: "handoff_added"; handoff: TicketHandoff }
  /** A hand-off's message went into the chat's queue, or into a turn of it. */
  | { type: "handoff_delivered"; ticketId: string; delegationId: string; turn?: number; queuedMessageId?: string }
  /**
   * A hand-off whose message was taken out of the chat's queue before any
   * turn took it: the work was never sent. The hand-off goes, and so does the
   * "sent to" line it added, so the ticket shows no row for work no chat had.
   */
  | { type: "handoff_withdrawn"; ticketId: string; delegationId: string }
  /**
   * The chat's outstanding hand-offs are settled: all of them, those on
   * `ticketIds`, or exactly `delegationIds`.
   */
  | { type: "handoffs_settled"; childChatId: string; ticketIds?: string[]; delegationIds?: string[] }
  /** `closed: null` drops the closure. */
  | { type: "flags_set"; ticketId: string; asksUser?: boolean; awaitingDelegator?: boolean; closed?: TicketClosure | null }
  | { type: "read_set"; ticketId: string; readAt: number | null }
  | { type: "board_snapshot"; tickets: TicketRecord[] }
)

/** One event, as callers hand it in: the store stamps the version. */
export type TicketStoreEventInput = TicketStoreEvent extends infer E ? E extends TicketStoreEvent ? Omit<E, "v"> : never : never

interface Board {
  tickets: Map<string, TicketRecord>
  /** Bytes in the file since its last compaction, to know when to compact again. */
  bytes: number
}

function cloneTicket(ticket: TicketRecord): TicketRecord {
  return {
    ...ticket,
    replies: [...ticket.replies],
    history: [...ticket.history],
    handoffs: ticket.handoffs.map((handoff) => ({ ...handoff })),
  }
}

/** Folds one event into a board. Unknown tickets are skipped, not fatal: an event can outlive what it pointed at. */
export function applyTicketEvent(tickets: Map<string, TicketRecord>, delegatorChatId: string, event: TicketStoreEvent) {
  switch (event.type) {
    case "board_snapshot": {
      tickets.clear()
      for (const ticket of event.tickets) tickets.set(ticket.id, cloneTicket(ticket))
      return
    }
    case "ticket_created": {
      tickets.set(event.ticket.id, {
        ...event.ticket,
        delegatorChatId,
        createdAt: event.at,
        updatedAt: event.at,
        asksUser: false,
        awaitingDelegator: false,
        replies: [],
        history: [],
        handoffs: [],
      })
      return
    }
    case "handoffs_settled": {
      const only = event.ticketIds ? new Set(event.ticketIds) : null
      const exactly = event.delegationIds ? new Set(event.delegationIds) : null
      for (const ticket of tickets.values()) {
        if (only && !only.has(ticket.id)) continue
        for (const handoff of ticket.handoffs) {
          if (handoff.childChatId !== event.childChatId) continue
          if (exactly && !exactly.has(handoff.delegationId)) continue
          handoff.outstanding = false
        }
      }
      return
    }
  }
  const ticketId = event.type === "reply_added"
    ? event.reply.ticketId
    : event.type === "history_added"
      ? event.event.ticketId
      : event.type === "handoff_delivered" || event.type === "handoff_withdrawn"
        ? event.ticketId
      : event.type === "handoff_added"
        ? event.handoff.ticketId
        : event.ticketId
  const ticket = tickets.get(ticketId)
  if (!ticket) return
  switch (event.type) {
    case "ticket_edited":
      if (event.title !== undefined) ticket.title = event.title
      if (event.body !== undefined) {
        ticket.body = event.body
        ticket.bodyEditedAt = event.at
      }
      return
    case "reply_added":
      ticket.replies.push(event.reply)
      ticket.updatedAt = Math.max(ticket.updatedAt, event.reply.createdAt)
      return
    case "history_added":
      ticket.history.push(event.event)
      ticket.updatedAt = Math.max(ticket.updatedAt, event.event.createdAt)
      return
    case "handoff_added":
      ticket.handoffs.push({ ...event.handoff })
      return
    case "handoff_delivered": {
      const handoff = ticket.handoffs.find((candidate) => candidate.delegationId === event.delegationId)
      if (!handoff) return
      if (event.turn !== undefined) handoff.turn = event.turn
      if (event.queuedMessageId !== undefined) handoff.queuedMessageId = event.queuedMessageId
      return
    }
    case "handoff_withdrawn": {
      const index = ticket.handoffs.findIndex((candidate) => candidate.delegationId === event.delegationId)
      if (index === -1) return
      const [handoff] = ticket.handoffs.splice(index, 1)
      // The line is written in the same batch as the hand-off, with its time.
      const line = ticket.history.findIndex((entry) => (
        entry.kind === "sent_to" && entry.chatId === handoff!.childChatId && entry.createdAt === handoff!.createdAt
      ))
      if (line !== -1) ticket.history.splice(line, 1)
      return
    }
    case "flags_set":
      if (event.asksUser !== undefined) ticket.asksUser = event.asksUser
      if (event.awaitingDelegator !== undefined) ticket.awaitingDelegator = event.awaitingDelegator
      if (event.closed === null) delete ticket.closed
      else if (event.closed) ticket.closed = { ...event.closed }
      return
    case "read_set":
      if (event.readAt === null) delete ticket.readAt
      else ticket.readAt = event.readAt
      return
  }
}

export class TicketStore {
  readonly dir: string
  private readonly boards = new Map<string, Board>()
  private writeChain = Promise.resolve()
  /** Bumped on every change, for memo keys and push decisions. */
  version = 0

  constructor(dataDir: string, private readonly compactionThresholdBytes = COMPACTION_THRESHOLD_BYTES) {
    this.dir = path.join(dataDir, "tickets")
  }

  async initialize() {
    await mkdir(this.dir, { recursive: true })
    const names = (await readdir(this.dir)).filter((name) => name.endsWith(".jsonl"))
    for (const name of names) {
      const delegatorChatId = name.slice(0, -".jsonl".length)
      await this.loadBoard(delegatorChatId)
    }
  }

  private filePath(delegatorChatId: string) {
    return path.join(this.dir, `${delegatorChatId}.jsonl`)
  }

  private async loadBoard(delegatorChatId: string) {
    const file = Bun.file(this.filePath(delegatorChatId))
    const text = await file.text()
    const board: Board = { tickets: new Map(), bytes: file.size }
    const lines = text.split("\n")
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as TicketStoreEvent
        if (event.v !== TICKET_LOG_VERSION) continue
        applyTicketEvent(board.tickets, delegatorChatId, event)
      } catch {
        // A line cut off by a crash. Anything else bad is skipped too: a board
        // that loses one event is better than one that does not load.
        if (index < lines.length - 2) console.warn(`${LOG_PREFIX} skipped a bad line in ${delegatorChatId}.jsonl`)
      }
    }
    this.boards.set(delegatorChatId, board)
    if (board.bytes >= this.compactionThresholdBytes) await this.enqueueWrite(() => this.compactBoard(delegatorChatId))
  }

  private enqueueWrite(run: () => Promise<void>) {
    const next = this.writeChain.then(run)
    this.writeChain = next.catch((error) => {
      console.warn(`${LOG_PREFIX} write failed:`, error)
    })
    return next
  }

  private board(delegatorChatId: string): Board {
    let board = this.boards.get(delegatorChatId)
    if (!board) {
      board = { tickets: new Map(), bytes: 0 }
      this.boards.set(delegatorChatId, board)
    }
    return board
  }

  /**
   * Applies the events in memory at once, then appends them in one write.
   * Applied first so a read straight after sees them, as the EventStore does.
   */
  append(delegatorChatId: string, events: TicketStoreEventInput[]): Promise<void> {
    if (events.length === 0) return Promise.resolve()
    const board = this.board(delegatorChatId)
    const stamped = events.map((event) => ({ v: TICKET_LOG_VERSION, ...event }) as TicketStoreEvent)
    for (const event of stamped) applyTicketEvent(board.tickets, delegatorChatId, event)
    this.version += 1
    const text = stamped.map((event) => `${JSON.stringify(event)}\n`).join("")
    return this.enqueueWrite(async () => {
      await mkdir(this.dir, { recursive: true })
      await appendFile(this.filePath(delegatorChatId), text, "utf8")
      board.bytes += Buffer.byteLength(text)
      if (board.bytes >= this.compactionThresholdBytes) await this.compactBoard(delegatorChatId)
    })
  }

  /** Rewrites the file as one snapshot of the board as it is in memory. Runs on the write chain. */
  private async compactBoard(delegatorChatId: string) {
    const board = this.boards.get(delegatorChatId)
    if (!board) return
    const snapshot: TicketStoreEvent = {
      v: TICKET_LOG_VERSION,
      at: Date.now(),
      type: "board_snapshot",
      tickets: [...board.tickets.values()].map(cloneTicket),
    }
    const text = `${JSON.stringify(snapshot)}\n`
    const target = this.filePath(delegatorChatId)
    const temp = `${target}.tmp`
    await writeFile(temp, text, "utf8")
    await rename(temp, target)
    board.bytes = Buffer.byteLength(text)
  }

  /** For tests: compacts now, whatever the size. */
  compact(delegatorChatId: string) {
    return this.enqueueWrite(() => this.compactBoard(delegatorChatId))
  }

  /** Resolves when every write queued so far is on disk. */
  flush() {
    return this.writeChain
  }

  list(delegatorChatId: string): TicketRecord[] {
    return [...(this.boards.get(delegatorChatId)?.tickets.values() ?? [])]
  }

  get(delegatorChatId: string, ticketId: string): TicketRecord | undefined {
    return this.boards.get(delegatorChatId)?.tickets.get(ticketId)
  }

  nextNumber(delegatorChatId: string) {
    let highest = 0
    for (const ticket of this.boards.get(delegatorChatId)?.tickets.values() ?? []) highest = Math.max(highest, ticket.number)
    return highest + 1
  }

  /** Delegators with a board, for sweeps that look across all of them. */
  delegatorChatIds(): string[] {
    return [...this.boards.keys()]
  }
}
