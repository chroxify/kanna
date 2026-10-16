import { describe, expect, test } from "bun:test"
import {
  deriveTicketState,
  describeTicket,
  snapshotTickets,
  SNAPSHOT_READ_DONE_LIMIT,
  summarizeTicket,
  ticketActivity,
  ticketAttentionCount,
  ticketChatLinks,
  type TicketChatInfo,
  type TicketChatState,
  type TicketHandoff,
  type TicketRecord,
  type TicketSummary,
} from "./tickets"

function ticket(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    id: "tk_000001",
    delegatorChatId: "delegator",
    number: 1,
    title: "Escape hold",
    body: "",
    createdAt: 100,
    updatedAt: 100,
    asksUser: false,
    awaitingDelegator: false,
    replies: [],
    history: [],
    handoffs: [],
    ...overrides,
  }
}

function handoff(childChatId: string, outstanding: boolean, createdAt = 200, ticketId = "tk_000001"): TicketHandoff {
  return { delegationId: `dl_${childChatId}_${createdAt}`, ticketId, childChatId, createdAt, outstanding }
}

function chats(states: Record<string, TicketChatState>) {
  return new Map<string, TicketChatInfo>(Object.entries(states).map(([chatId, state]) => [chatId, { chatId, title: `Chat ${chatId}`, state }]))
}

function summarize(record: TicketRecord, states: Record<string, TicketChatState>) {
  return summarizeTicket(record, chats(states))
}

describe("a ticket's column", () => {
  test("a ticket with no hand-offs is in progress, not started", () => {
    expect(summarize(ticket(), {})).toMatchObject({ state: "in_progress", statusLine: "Not started", unread: false })
  })

  test("a working chat with an outstanding hand-off puts it in progress", () => {
    expect(summarize(ticket({ handoffs: [handoff("a", true)] }), { a: "working" }))
      .toMatchObject({ state: "in_progress", statusLine: "Chat a is working" })
    expect(summarize(ticket({ handoffs: [handoff("a", true), handoff("b", true, 210)] }), { a: "working", b: "working" }))
      .toMatchObject({ state: "in_progress", statusLine: "2 chats working" })
  })

  test("a chat waiting for the user puts it in Waiting on you, ahead of a working one", () => {
    expect(summarize(ticket({ handoffs: [handoff("a", true), handoff("b", true, 210)] }), { a: "working", b: "waiting_on_you" }))
      .toMatchObject({ state: "waiting_on_you", statusLine: "Waiting on you in Chat b" })
  })

  test("a delegator question puts it in Waiting on you until the user replies", () => {
    expect(summarize(ticket({ asksUser: true, handoffs: [handoff("a", false)] }), { a: "finished" }))
      .toMatchObject({ state: "waiting_on_you", statusLine: "Asks you" })
  })

  test("a user reply holds it in progress until the delegator answers", () => {
    expect(summarize(ticket({ awaitingDelegator: true, handoffs: [handoff("a", false)] }), { a: "finished" }))
      .toMatchObject({ state: "in_progress", statusLine: "Waiting on the delegator" })
  })

  test("a chat whose report is still on its way keeps it in progress", () => {
    expect(summarize(ticket({ handoffs: [handoff("a", true)] }), { a: "finished" }))
      .toMatchObject({ state: "in_progress", statusLine: "Chat a is reporting" })
  })

  test("with every hand-off settled it is Done", () => {
    expect(summarize(ticket({ handoffs: [handoff("a", false)] }), { a: "finished" }))
      .toMatchObject({ state: "done", statusLine: "Chat a finished" })
    expect(summarize(ticket({ handoffs: [handoff("a", false), handoff("b", false, 210)] }), { a: "finished", b: "failed" }))
      .toMatchObject({ state: "done", statusLine: "2 chats finished, 1 failed" })
    expect(summarize(ticket({ handoffs: [handoff("a", false)] }), { a: "stopped" }))
      .toMatchObject({ statusLine: "Chat a was stopped" })
  })

  test("a chat that is busy again on other work does not reopen a settled ticket", () => {
    expect(summarize(ticket({ handoffs: [handoff("a", false)] }), { a: "working" })).toMatchObject({ state: "done" })
  })

  test("a deleted chat counts as settled and drops off the ticket", () => {
    const summary = summarize(ticket({ handoffs: [handoff("gone", true)] }), {})
    expect(summary).toMatchObject({ state: "done", statusLine: "Finished", chats: [] })
  })

  // A chat given several tickets in a row is busy with the first while the
  // rest wait in its queue. Its own state says "working" for all of them.
  test("work still in a chat's queue is queued, not working", () => {
    const queued = { ...handoff("a", true), turn: null, queuedMessageId: "q1" }
    const summary = summarize(ticket({ handoffs: [queued] }), { a: "working" })
    expect(summary).toMatchObject({ state: "in_progress", statusLine: "Queued in Chat a", chats: [{ chatId: "a", state: "working", outstanding: true, queued: true }] })
    // Asking the user about the work ahead of it does not put this ticket in Waiting on you.
    expect(summarize(ticket({ handoffs: [queued] }), { a: "waiting_on_you" })).toMatchObject({ state: "in_progress", statusLine: "Queued in Chat a" })
    expect(summarize(ticket({ handoffs: [queued, { ...handoff("b", true, 210), turn: null, queuedMessageId: "q2" }] }), { a: "working", b: "working" }))
      .toMatchObject({ statusLine: "Queued in 2 chats" })
  })

  test("a chat at work on the ticket is not queued, though another of its messages for it waits", () => {
    const placed = { ...handoff("a", true), turn: 3 }
    const waiting = { ...handoff("a", true, 210), turn: null, queuedMessageId: "q1" }
    const [link] = ticketChatLinks(ticket({ handoffs: [placed, waiting] }), chats({ a: "working" }))
    expect(link!.queued).toBeUndefined()
    expect(summarize(ticket({ handoffs: [placed, waiting] }), { a: "working" })).toMatchObject({ statusLine: "Chat a is working" })
    // A send still under way (no queue id yet) is not queued either.
    expect(ticketChatLinks(ticket({ handoffs: [{ ...handoff("a", true), turn: null }] }), chats({ a: "working" }))[0]!.queued).toBeUndefined()
  })
})

describe("closing and reopening", () => {
  const closed = { status: "done" as const, by: "user" as const, at: 300 }

  test("an explicit close makes it Done", () => {
    expect(summarize(ticket({ closed }), {})).toMatchObject({ state: "done", statusLine: "Closed" })
    // A report that has not arrived does not hold a closed ticket open.
    expect(summarize(ticket({ closed, handoffs: [handoff("a", true)] }), { a: "finished" })).toMatchObject({ state: "done" })
  })

  test("a working or waiting chat wins over a close", () => {
    expect(summarize(ticket({ closed, handoffs: [handoff("a", true)] }), { a: "working" })).toMatchObject({ state: "in_progress" })
    expect(summarize(ticket({ closed, handoffs: [handoff("a", true)] }), { a: "waiting_on_you" })).toMatchObject({ state: "waiting_on_you" })
  })

  test("a reopen holds it out of Done until work handed on after it settles", () => {
    const reopened = { status: "open" as const, by: "user" as const, at: 300 }
    expect(summarize(ticket({ closed: reopened, handoffs: [handoff("a", false, 200)] }), { a: "finished" }))
      .toMatchObject({ state: "in_progress", statusLine: "Reopened" })
    expect(summarize(ticket({ closed: reopened, handoffs: [handoff("a", false, 200), handoff("b", true, 400)] }), { a: "finished", b: "working" }))
      .toMatchObject({ state: "in_progress" })
    expect(summarize(ticket({ closed: reopened, handoffs: [handoff("a", false, 200), handoff("b", false, 400)] }), { a: "finished", b: "finished" }))
      .toMatchObject({ state: "done" })
  })
})

describe("a chat on two tickets", () => {
  test("it is active on both while both hand-offs are outstanding, and on neither once settled", () => {
    const first = ticket({ id: "tk_000001", handoffs: [handoff("shared", true, 200, "tk_000001")] })
    const second = ticket({ id: "tk_000002", number: 2, handoffs: [handoff("shared", true, 210, "tk_000002")] })
    expect(summarize(first, { shared: "working" }).state).toBe("in_progress")
    expect(summarize(second, { shared: "working" }).state).toBe("in_progress")

    first.handoffs[0]!.outstanding = false
    expect(summarize(first, { shared: "working" }).state).toBe("done")
    expect(summarize(second, { shared: "working" }).state).toBe("in_progress")
  })
})

describe("read state", () => {
  test("a Done ticket is unread until read, and again when news lands after", () => {
    const settled = { handoffs: [handoff("a", false)] }
    expect(summarize(ticket({ ...settled, updatedAt: 500 }), { a: "finished" }).unread).toBe(true)
    expect(summarize(ticket({ ...settled, updatedAt: 500, readAt: 500 }), { a: "finished" }).unread).toBe(false)
    expect(summarize(ticket({ ...settled, updatedAt: 600, readAt: 500 }), { a: "finished" }).unread).toBe(true)
  })

  test("only a Done ticket is unread", () => {
    expect(summarize(ticket({ handoffs: [handoff("a", true)], updatedAt: 500 }), { a: "working" }).unread).toBe(false)
  })

  test("the attention count is tickets waiting on the user plus unread Done ones", () => {
    const board = [
      summarize(ticket({ asksUser: true }), {}),
      summarize(ticket({ handoffs: [handoff("a", false)], updatedAt: 500 }), { a: "finished" }),
      summarize(ticket({ handoffs: [handoff("a", false)], updatedAt: 500, readAt: 600 }), { a: "finished" }),
      summarize(ticket({ handoffs: [handoff("a", true)] }), { a: "working" }),
    ]
    expect(ticketAttentionCount(board)).toBe(2)
  })
})

describe("the ticket whole", () => {
  test("links list each chat once, latest hand-off first, outstanding if any hand-off is", () => {
    const record = ticket({ handoffs: [handoff("a", false, 200), handoff("b", true, 300), handoff("a", true, 400)] })
    expect(ticketChatLinks(record, chats({ a: "working", b: "working" })).map((link) => [link.chatId, link.outstanding, link.lastSentAt]))
      .toEqual([["a", true, 400], ["b", true, 300]])
    expect(deriveTicketState(record, ticketChatLinks(record, chats({ a: "finished", b: "finished" })))).toBe("in_progress")
  })

  test("activity interleaves replies and history by time", () => {
    const detail = describeTicket(ticket({
      replies: [{ id: "rp_1", ticketId: "tk_000001", author: "user", text: "and iOS?", createdAt: 300 }],
      history: [
        { id: "th_1", ticketId: "tk_000001", createdAt: 200, kind: "sent_to", chatId: "a" },
        { id: "th_2", ticketId: "tk_000001", createdAt: 300, kind: "chat_finished", chatId: "a" },
      ],
    }), chats({ a: "finished" }))
    expect(ticketActivity(detail).map((item) => item.type === "reply" ? item.reply.id : item.event.id)).toEqual(["th_1", "th_2", "rp_1"])
  })
})

describe("the snapshot's tickets", () => {
  function done(number: number, unread = false): TicketSummary {
    return { ...summarize(ticket({ id: `tk_${number}`, number, updatedAt: number, handoffs: [handoff("a", false)] }), { a: "finished" }), unread }
  }

  test("keeps every open and unread Done ticket, and only the latest read Done ones", () => {
    const open = summarize(ticket({ id: "tk_open", number: 0, asksUser: true }), {})
    const list = [open, done(1), done(2, true), done(3), done(4), done(5)]
    const { tickets, readDoneTotal } = snapshotTickets(list, 2)
    expect(tickets.map((entry) => entry.id)).toEqual(["tk_open", "tk_2", "tk_4", "tk_5"])
    expect(readDoneTotal).toBe(4)
  })

  test("is capped at 100 read Done tickets", () => {
    expect(SNAPSHOT_READ_DONE_LIMIT).toBe(100)
    const { tickets, readDoneTotal } = snapshotTickets(Array.from({ length: 120 }, (_, index) => done(index + 1)))
    expect(tickets).toHaveLength(100)
    expect(tickets.some((entry) => entry.id === "tk_20")).toBe(false)
    expect(readDoneTotal).toBe(120)
  })
})
