import { describe, expect, test } from "bun:test"
import type { TicketHistoryEvent, TicketReply, TicketSummary } from "../../shared/tickets"
import {
  adjacentTicketId,
  handoffStateLabel,
  ticketActivityBlocks,
  ticketActivityGroupLabel,
  ticketActivityGroupRunning,
  ticketActivityRows,
  ticketOpenQuestion,
  formatTicketNumbers,
  groupTicketBoard,
  handoffTicketOf,
  olderTicketsNote,
  opensTicketInPane,
  parseTicketLink,
  readTicketLinkParam,
  repeatHandoffIds,
  reportTicketNumbers,
  ticketBoardColumns,
  ticketChipMarkKind,
  ticketDraftKey,
  ticketReplyCommand,
  ticketRepliesLabel,
  ticketLinkPath,
  ticketMarkKind,
  ticketShortState,
  ticketStepOrder,
  ticketWantsUser,
  withoutTicketLinkParam,
} from "./tickets"

function summary(number: number, state: TicketSummary["state"], extra: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: `tk_${String(number).padStart(6, "0")}`,
    delegatorChatId: "deleg",
    number,
    title: `Ticket ${number}`,
    state,
    statusLine: "",
    chats: [],
    createdAt: number,
    updatedAt: number * 10,
    unread: false,
    replyCount: 0,
    ...extra,
  }
}

describe("groupTicketBoard", () => {
  const board = [
    summary(1, "done"),
    summary(2, "in_progress"),
    summary(3, "done", { unread: true }),
    summary(4, "waiting_on_you"),
    summary(5, "in_progress"),
    summary(6, "done"),
  ]
  const sectionOf = (list: TicketSummary[], section: string) => groupTicketBoard(list).find((group) => group.section === section)

  test("goes Waiting on you, In progress, Ready for review, Done, each latest first", () => {
    const groups = groupTicketBoard(board)
    expect(groups.map((group) => group.section)).toEqual(["waiting_on_you", "in_progress", "review", "done"])
    expect(groups.map((group) => group.label)).toEqual(["Waiting on you", "In progress", "Ready for review", "Done"])
    expect(groups[1]!.tickets.map((ticket) => ticket.number)).toEqual([5, 2])
  })

  test("Ready for review is the unread Done tickets, and Done the read ones", () => {
    expect(sectionOf(board, "review")!.tickets.map((ticket) => ticket.number)).toEqual([3])
    expect(sectionOf(board, "done")!.tickets.map((ticket) => ticket.number)).toEqual([6, 1])
  })

  test("opening one in review reads it, and it moves to Done; marking it unread moves it back", () => {
    const read = board.map((ticket) => (ticket.number === 3 ? { ...ticket, unread: false } : ticket))
    expect(sectionOf(read, "review")).toBeUndefined()
    expect(sectionOf(read, "done")!.tickets.map((ticket) => ticket.number)).toEqual([6, 3, 1])
    const unread = read.map((ticket) => (ticket.number === 1 ? { ...ticket, unread: true } : ticket))
    expect(sectionOf(unread, "review")!.tickets.map((ticket) => ticket.number)).toEqual([1])
    expect(sectionOf(unread, "done")!.tickets.map((ticket) => ticket.number)).toEqual([6, 3])
  })

  test("Waiting on you is there only while it has tickets", () => {
    expect(groupTicketBoard(board.filter((ticket) => ticket.state !== "waiting_on_you")).map((group) => group.section))
      .toEqual(["in_progress", "review", "done"])
  })

  // Fourteen read Done tickets, 1 the oldest and 14 the latest.
  const manyDone = Array.from({ length: 14 }, (_, index) => summary(index + 1, "done"))

  test("Done shows its 10 latest and keeps the rest for Show more", () => {
    const done = sectionOf(manyDone, "done")!
    expect(done.tickets.map((ticket) => ticket.number)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5])
    expect(done.total).toBe(14)
    expect(done.hidden).toBe(4)
  })

  test("Show more shows every Done ticket", () => {
    const done = groupTicketBoard(manyDone, { showAllDone: true }).find((group) => group.section === "done")!
    expect(done.tickets).toHaveLength(14)
    expect(done.hidden).toBe(0)
  })

  test("an unread one is never held back in Done: it is in Ready for review", () => {
    const list = manyDone.map((ticket) => (ticket.number === 2 ? { ...ticket, unread: true } : ticket))
    expect(sectionOf(list, "review")!.tickets.map((ticket) => ticket.number)).toEqual([2])
    expect(sectionOf(list, "done")!.tickets).toHaveLength(10)
    expect(sectionOf(list, "done")!.hidden).toBe(3)
  })

  test("leaves out empty sections", () => {
    expect(groupTicketBoard([summary(1, "done"), summary(2, "in_progress")]).map((group) => group.section)).toEqual(["in_progress", "done"])
  })

  test("Done counts the read Done tickets the snapshot left out, and says so at its end", () => {
    const done = groupTicketBoard(manyDone, { showAllDone: true, readDoneTotal: 150 }).find((group) => group.section === "done")!
    expect(done.total).toBe(150)
    expect(done.tickets).toHaveLength(14)
    expect(done.unloaded).toBe(136)
    expect(olderTicketsNote(done.unloaded)).toBe("136 older tickets aren't shown")
    expect(olderTicketsNote(1)).toBe("1 older ticket isn't shown")
    // A total behind the loaded list (a push between the two) never goes below what is there.
    expect(sectionOf(manyDone, "done")!.unloaded).toBe(0)
    expect(groupTicketBoard(manyDone, { readDoneTotal: 3 }).find((group) => group.section === "done")!.total).toBe(14)
    expect(ticketBoardColumns(manyDone, { readDoneTotal: 150 }).find((column) => column.section === "done")).toMatchObject({ total: 150, unloaded: 136 })
  })

  test("the full board keeps In progress, Ready for review and Done, and has Waiting on you only while it has tickets", () => {
    expect(ticketBoardColumns([summary(1, "done")]).map((column) => [column.section, column.total]))
      .toEqual([["in_progress", 0], ["review", 0], ["done", 1]])
    expect(ticketBoardColumns(board).map((column) => column.section)).toEqual(["waiting_on_you", "in_progress", "review", "done"])
  })
})

describe("one mark per ticket", () => {
  const cases: Array<[TicketSummary["state"], boolean, ReturnType<typeof ticketMarkKind>]> = [
    ["in_progress", false, "working"],
    ["in_progress", true, "working"],
    ["waiting_on_you", false, "waiting"],
    ["done", true, "unread"],
    ["done", false, "read"],
  ]
  for (const [state, unread, mark] of cases) {
    test(`${state}${unread ? ", unread" : ""} wears ${mark}`, () => {
      expect(ticketMarkKind({ state, unread })).toBe(mark)
    })
  }

  test("a ticket wants the user when it waits on them or is unread, and then its title is bold", () => {
    expect(ticketWantsUser({ state: "waiting_on_you", unread: false })).toBe(true)
    expect(ticketWantsUser({ state: "done", unread: true })).toBe(true)
    expect(ticketWantsUser({ state: "done", unread: false })).toBe(false)
    expect(ticketWantsUser({ state: "in_progress", unread: false })).toBe(false)
  })

  test("a chip shows the chat's status, or its harness when it has none", () => {
    expect(ticketChipMarkKind("working")).toBe("working")
    expect(ticketChipMarkKind("waiting_on_you")).toBe("waiting")
    expect(ticketChipMarkKind("finished")).toBe("harness")
    expect(ticketChipMarkKind("stopped")).toBe("harness")
  })
})

describe("ticketShortState", () => {
  const link = (chatId: string, state: "working" | "finished" | "failed", outstanding = state === "working") => ({ chatId, title: chatId, state, outstanding, lastSentAt: 0 })
  test("says how the ticket stands", () => {
    expect(ticketShortState({ state: "in_progress", chats: [link("a", "working")] })).toBe("working")
    expect(ticketShortState({ state: "in_progress", chats: [link("a", "working"), link("b", "working")] })).toBe("2 chats working")
    expect(ticketShortState({ state: "waiting_on_you", chats: [link("a", "finished")] })).toBe("asking you")
    expect(ticketShortState({ state: "done", chats: [link("a", "finished")] })).toBe("finished")
    expect(ticketShortState({ state: "done", chats: [link("a", "finished"), link("b", "finished")] })).toBe("2 chats finished")
  })

  test("a ticket whose chats all hold it in their queues is queued, not working", () => {
    const queued = { ...link("a", "working"), queued: true as const }
    expect(ticketShortState({ state: "in_progress", chats: [queued] })).toBe("queued")
    // One chat at work on it is enough to call it working.
    expect(ticketShortState({ state: "in_progress", chats: [queued, link("b", "working")] })).toBe("working")
    expect(ticketChipMarkKind("working", true)).toBe("harness")
    expect(ticketChipMarkKind("working")).toBe("working")
  })
})

describe("hand-offs in a delegator's transcript", () => {
  const call = (id: string, result: unknown, extra: Record<string, unknown> = {}) => ({
    id,
    kind: "tool",
    toolKind: "chat",
    toolName: "create_chat",
    input: { payload: {} },
    rawResult: result,
    ...extra,
  })

  test("reads the ticket a hand-off was for", () => {
    expect(handoffTicketOf(call("a", { chatId: "c1", ticket: { id: "tk_00000d", number: 13 } }))).toEqual({ ticketId: "tk_00000d", number: 13 })
    expect(handoffTicketOf(call("a", JSON.stringify({ ticket: { id: "tk_00000d", number: 13 } })))).toEqual({ ticketId: "tk_00000d", number: 13 })
    expect(handoffTicketOf(call("a", undefined, { input: { payload: { ticketId: "tk_00000d" } } }))).toEqual({ ticketId: "tk_00000d", number: null })
  })

  test("says when the hand-off reopened a Done ticket", () => {
    expect(handoffTicketOf(call("a", { chatId: "c1", ticket: { id: "tk_00000d", number: 3, reopened: true, note: "Reopened #3, which was Done." } })))
      .toEqual({ ticketId: "tk_00000d", number: 3, reopened: true })
  })

  test("a returned call is read from its result alone", () => {
    expect(handoffTicketOf(call("a", { chatId: "c1" }, { resultEntryId: "r", input: { payload: { ticketId: "tk_00000d" } } }))).toBeNull()
  })

  test("an ordinary chat's hand-off, a failed one and other tools have none", () => {
    expect(handoffTicketOf(call("a", { chatId: "c1" }))).toBeNull()
    expect(handoffTicketOf(call("a", { ticket: { id: "tk_00000d", number: 13 } }, { isError: true }))).toBeNull()
    expect(handoffTicketOf(call("a", { ticket: { id: "tk_00000d", number: 13 } }, { toolKind: "bash", toolName: "Bash" }))).toBeNull()
  })

  test("only a ticket's first hand-off is its card", () => {
    const messages = [
      call("a", { ticket: { id: "tk_00000d", number: 13 } }),
      call("b", { ticket: { id: "tk_00000e", number: 14 } }),
      { id: "text", kind: "assistant_text" },
      call("c", { ticket: { id: "tk_00000d", number: 13 } }),
      call("d", { ticket: { id: "tk_00000d", number: 13 } }),
      call("e", { chatId: "plain" }),
    ]
    expect([...repeatHandoffIds(messages)]).toEqual(["c", "d"])
  })
})

describe("report lines name their tickets", () => {
  const numbers = new Map([["tk_00000d", 13], ["tk_00000e", 14], ["tk_00000f", 15]])
  const numberOf = (id: string) => numbers.get(id)

  test("numbers each sub-chat's tickets from the board", () => {
    const refs = reportTicketNumbers({ c1: ["tk_00000d"], c2: ["tk_00000f", "tk_00000e", "tk_00000f"] }, numberOf)
    expect(refs.get("c1")).toEqual([13])
    expect(refs.get("c2")).toEqual([14, 15])
  })

  test("a ticket the board does not have, and a report with none, name nothing", () => {
    expect(reportTicketNumbers({ c1: ["tk_0000ff"] }, numberOf).size).toBe(0)
    expect(reportTicketNumbers(undefined, numberOf).size).toBe(0)
  })

  test("formats the numbers", () => {
    expect(formatTicketNumbers([13])).toBe("#13")
    expect(formatTicketNumbers([13, 14])).toBe("#13, #14")
  })
})

describe("ticket links", () => {
  test("round-trips a ticket through its link", () => {
    const path = ticketLinkPath("chat-1", "tk_6f0c2a")
    expect(path).toBe("/chat/chat-1?ticket=tk_6f0c2a")
    expect(readTicketLinkParam(path.slice(path.indexOf("?")))).toBe("tk_6f0c2a")
  })

  test("ignores anything that is not a ticket id", () => {
    expect(readTicketLinkParam("?ticket=../../etc")).toBeNull()
    expect(readTicketLinkParam("?ticket=")).toBeNull()
    expect(readTicketLinkParam("")).toBeNull()
  })

  test("drops the ticket from the query and keeps the rest", () => {
    expect(withoutTicketLinkParam("?ticket=tk_6f0c2a")).toBe("")
    expect(withoutTicketLinkParam("?a=1&ticket=tk_6f0c2a")).toBe("?a=1")
  })
})

describe("replying on a ticket", () => {
  test("each ticket keeps its own draft, apart from its delegator's", () => {
    const key = ticketDraftKey("chat-1", "tk_00000d")
    expect(key).not.toBe("chat-1")
    expect(key).not.toBe(ticketDraftKey("chat-1", "tk_00000e"))
    expect(key).not.toBe(ticketDraftKey("chat-2", "tk_00000d"))
  })

  test("the composer's uploads go to ticket.reply as they are", () => {
    const attachment = {
      id: "up_1",
      kind: "image" as const,
      displayName: "shot.png",
      absolutePath: "/p/.kanna/uploads/shot.png",
      relativePath: "./.kanna/uploads/shot.png",
      contentUrl: "/api/projects/p1/uploads/shot.png/content",
      mimeType: "image/png",
      size: 12,
    }
    expect(ticketReplyCommand("chat-1", "tk_00000d", "  look  ", [attachment]))
      .toEqual({ type: "ticket.reply", chatId: "chat-1", ticketId: "tk_00000d", text: "look", attachments: [attachment] })
  })

  test("a reply with no files sends none", () => {
    expect(ticketReplyCommand("chat-1", "tk_00000d", "hi")).toEqual({ type: "ticket.reply", chatId: "chat-1", ticketId: "tk_00000d", text: "hi" })
  })
})

describe("stepping between tickets", () => {
  const board = [
    summary(1, "done"),
    summary(2, "in_progress"),
    summary(3, "done", { unread: true }),
    summary(4, "waiting_on_you"),
    summary(5, "in_progress"),
    summary(6, "done"),
  ]
  const order = ticketStepOrder(board)
  const id = (number: number) => summary(number, "done").id

  test("goes through the list's sections in order, all of Done included", () => {
    // Waiting on you, In progress latest first, Ready for review, then all of Done latest first.
    expect(order).toEqual([4, 5, 2, 3, 6, 1].map(id))
  })

  test("steps across a group's edge", () => {
    expect(adjacentTicketId(order, id(4), "next")).toBe(id(5))
    expect(adjacentTicketId(order, id(2), "next")).toBe(id(3))
    expect(adjacentTicketId(order, id(6), "previous")).toBe(id(3))
  })

  test("stops at the ends, and knows nothing of a ticket not on the board", () => {
    expect(adjacentTicketId(order, id(4), "previous")).toBeNull()
    expect(adjacentTicketId(order, id(1), "next")).toBeNull()
    expect(adjacentTicketId(order, "tk_ffffff", "next")).toBeNull()
  })
})

describe("ticketActivityBlocks", () => {
  let id = 0
  const at = (minute: number) => minute * 60_000
  const event = (minute: number, body: Record<string, unknown>) => ({ id: `e${++id}`, ticketId: "tk_000001", createdAt: at(minute), ...body }) as TicketHistoryEvent
  const reply = (minute: number, author: "user" | "delegator", text: string): TicketReply => ({ id: `r${++id}`, ticketId: "tk_000001", author, text, createdAt: at(minute) })
  const names = { chat: (chatId: string) => chatId.toUpperCase(), delegator: "Delegator" }
  const link = (chatId: string, state: "working" | "waiting_on_you" | "finished" | "failed" | "stopped") => ({ chatId, title: chatId, state, outstanding: state === "working", lastSentAt: 0 })
  const blocks = (history: TicketHistoryEvent[], replies: TicketReply[] = [], chats: ReturnType<typeof link>[] = []) => ticketActivityBlocks({ history, replies, chats }, names)
  const handoffs = (list: ReturnType<typeof blocks>) => list.flatMap((block) => (block.type === "handoff" ? [block] : []))

  test("a hand-off and its report are one row, where it was sent, settled in place", () => {
    const list = blocks([event(10, { kind: "sent_to", chatId: "a" }), event(52, { kind: "chat_finished", chatId: "a" })])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ type: "handoff", chatId: "a", at: at(10), state: "finished", settledAt: at(52) })
  })

  test("a hand-off with no report yet reads as its chat does now", () => {
    expect(handoffs(blocks([event(1, { kind: "sent_to", chatId: "a" })], [], [link("a", "working")]))[0]!.state).toBe("working")
    expect(handoffs(blocks([event(1, { kind: "sent_to", chatId: "a" }), event(2, { kind: "chat_asking", chatId: "a" })], [], [link("a", "waiting_on_you")]))[0]!.state).toBe("waiting_on_you")
    // Asked, then answered and working again: it says so.
    expect(handoffs(blocks([event(1, { kind: "sent_to", chatId: "a" }), event(2, { kind: "chat_asking", chatId: "a" })], [], [link("a", "working")]))[0]!.state).toBe("working")
  })

  test("a failure settles it as failed", () => {
    expect(handoffs(blocks([event(1, { kind: "sent_to", chatId: "a" }), event(3, { kind: "chat_failed", chatId: "a" })]))[0]).toMatchObject({ state: "failed", settledAt: at(3) })
  })

  test("a second hand-off to the same chat is its own row, at its own point, and one report settles both", () => {
    const list = blocks(
      [event(1, { kind: "sent_to", chatId: "a" }), event(5, { kind: "sent_to", chatId: "a" }), event(9, { kind: "chat_finished", chatId: "a" })],
      [reply(3, "user", "and the ring")],
    )
    expect(list.map((block) => block.type)).toEqual(["handoff", "divider", "user", "handoff"])
    expect(handoffs(list).map((block) => [block.at, block.state, block.settledAt])).toEqual([[at(1), "finished", at(9)], [at(5), "finished", at(9)]])
  })

  test("a second message to a chat still working, with nothing between, is the same row", () => {
    const steered = [event(1, { kind: "closed", by: "delegator" }), event(2, { kind: "sent_to", chatId: "a" }), event(4, { kind: "sent_to", chatId: "a" })]
    const working = blocks(steered, [], [link("a", "working")])
    expect(working.map((block) => block.type)).toEqual(["event", "handoff"])
    expect(handoffs(working)).toMatchObject([{ at: at(2), state: "working" }])
    // Its one report settles it, once.
    const settled = handoffs(blocks([...steered, event(9, { kind: "chat_finished", chatId: "a" })], [], [link("a", "finished")]))
    expect(settled.map((block) => [block.at, block.state, block.settledAt])).toEqual([[at(2), "finished", at(9)]])
    // Asking in between is not drawn, so it does not split them.
    expect(handoffs(blocks([event(1, { kind: "sent_to", chatId: "a" }), event(2, { kind: "chat_asking", chatId: "a" }), event(3, { kind: "sent_to", chatId: "a" })]))).toHaveLength(1)
  })

  test("two outstanding hand-offs to one chat with an event between keep their rows", () => {
    const list = blocks([event(1, { kind: "sent_to", chatId: "a" }), event(2, { kind: "renamed", from: "Old" }), event(3, { kind: "sent_to", chatId: "a" })], [], [link("a", "working")])
    expect(list.map((block) => block.type)).toEqual(["handoff", "event", "handoff"])
  })

  test("hand-offs to two chats in a row are two rows", () => {
    expect(handoffs(blocks([event(1, { kind: "sent_to", chatId: "a" }), event(2, { kind: "sent_to", chatId: "b" })]))).toHaveLength(2)
  })

  test("a report after a hand-off settled lands on the next one only", () => {
    const list = handoffs(blocks([
      event(1, { kind: "sent_to", chatId: "a" }), event(2, { kind: "chat_finished", chatId: "a" }),
      event(5, { kind: "sent_to", chatId: "a" }), event(9, { kind: "chat_failed", chatId: "a" }),
    ]))
    expect(list.map((block) => [block.state, block.settledAt])).toEqual([["finished", at(2)], ["failed", at(9)]])
  })

  test("closes, reopens and renames are single rows, and none says Done", () => {
    const list = blocks([
      event(1, { kind: "sent_to", chatId: "a" }),
      event(2, { kind: "chat_finished", chatId: "a" }),
      event(3, { kind: "closed", by: "user" }),
      event(4, { kind: "reopened", cause: "chat_started", chatId: "b" }),
      event(5, { kind: "renamed", from: "Old" }),
    ])
    const events = list.flatMap((block) => (block.type === "event" ? [block] : []))
    expect(events.map((block) => block.text)).toEqual(["Closed by you", "Reopened: B started", "Renamed from ‘Old’"])
    // The delegator's own closes and reopens name it: the chat's title, which may be anything ("Superwall").
    const byWhom = blocks([event(1, { kind: "closed", by: "delegator" }), event(2, { kind: "reopened", cause: "manual", by: "delegator" }), event(3, { kind: "reopened", cause: "manual", by: "user" })])
    expect(byWhom.map((block) => (block.type === "event" ? block.text : ""))).toEqual(["Closed by Delegator", "Reopened by Delegator", "Reopened by you"])
    expect(events[1]!.chatId).toBe("b")
    expect(JSON.stringify(list)).not.toContain("Done")
  })

  test("a report with no hand-off before it is said where it happened, and names its chat", () => {
    const list = blocks([event(1, { kind: "chat_finished", chatId: "a" })])
    expect(list[0]).toMatchObject({ type: "event", text: "A finished", chatId: "a" })
  })

  test("replies are the user's bubble or the delegator's text", () => {
    expect(blocks([], [reply(1, "user", "hi"), reply(2, "delegator", "hello")]).map((block) => block.type)).toEqual(["user", "delegator"])
  })

  test("each message of the user's after the first thing opens a turn, under the rule with its time", () => {
    const list = blocks([event(1, { kind: "sent_to", chatId: "a" })], [reply(2, "user", "faster"), reply(3, "delegator", "On it."), reply(4, "user", "thanks")])
    expect(list.map((block) => block.type)).toEqual(["handoff", "divider", "user", "delegator", "divider", "user"])
    expect(list[1]).toMatchObject({ type: "divider", at: at(2) })
  })

  test("the activity's first message has no rule over it, as a chat's first prompt has none", () => {
    expect(blocks([], [reply(1, "user", "hi")]).map((block) => block.type)).toEqual(["user"])
    // Nor does the delegator's text: a rule dates the user's prompts only.
    expect(blocks([], [reply(1, "delegator", "hello"), reply(2, "delegator", "again")]).map((block) => block.type)).toEqual(["delegator", "delegator"])
  })

  test("a hand-off still in its chat's queue reads Queued, and does not count as running", () => {
    const queued = { ...link("a", "working"), queued: true as const }
    const list = handoffs(blocks([event(1, { kind: "sent_to", chatId: "a" })], [], [queued]))
    expect(list).toMatchObject([{ state: "working", queued: true }])
    const run = blocks([event(1, { kind: "renamed", from: "Old" }), event(2, { kind: "sent_to", chatId: "a" })], [], [queued])
    expect(ticketActivityGroupRunning(run)).toBe(false)
    // Once its turn starts the link is no longer queued, and the row is Working.
    expect(handoffs(blocks([event(1, { kind: "sent_to", chatId: "a" })], [], [link("a", "working")]))[0]!.queued).toBeUndefined()
  })

  describe("folded as the transcript folds tool calls", () => {
    const rows = (list: ReturnType<typeof blocks>) => ticketActivityRows(list).map((row) => (row.type === "group" ? row.items.map((block) => block.type) : row.item.type))

    test("two or more hand-offs and events in a row are one group, labelled by kind", () => {
      const list = blocks([event(1, { kind: "closed", by: "user" }), event(2, { kind: "reopened", cause: "manual", by: "user" }), event(3, { kind: "sent_to", chatId: "a" })], [], [link("a", "working")])
      const [group] = ticketActivityRows(list)
      expect(group).toMatchObject({ type: "group", startIndex: 0 })
      if (group?.type !== "group") throw new Error("not a group")
      expect(ticketActivityGroupLabel(group.items)).toBe("1 close, 1 reopen, 1 hand-off")
    })

    test("a lone one stays a row", () => {
      expect(rows(blocks([event(1, { kind: "sent_to", chatId: "a" })]))).toEqual(["handoff"])
    })

    test("a reply ends a run, as an agent's text ends a run of tool calls", () => {
      const list = blocks(
        [event(1, { kind: "sent_to", chatId: "a" }), event(2, { kind: "chat_finished", chatId: "a" }), event(5, { kind: "closed", by: "user" }), event(6, { kind: "renamed", from: "Old" })],
        [reply(3, "delegator", "Done.")],
      )
      expect(rows(list)).toEqual(["handoff", "delegator", ["event", "event"]])
    })

    test("a group with a chat at work is running, as one with a call in flight is; settled, it is not", () => {
      const run = [event(1, { kind: "reopened", cause: "chat_started", chatId: "a" }), event(2, { kind: "sent_to", chatId: "a" })]
      expect(ticketActivityGroupRunning(blocks(run, [], [link("a", "working")]))).toBe(true)
      expect(ticketActivityGroupRunning(blocks([...run, event(4, { kind: "chat_finished", chatId: "a" })], [], [link("a", "finished")]))).toBe(false)
    })

    test("same-chat hand-offs merge first, so a group never holds two rows for one piece of work", () => {
      // The ticket in Jake's screenshot: closed, reopened, then two messages to one chat before its report.
      const list = blocks([
        event(1, { kind: "closed", by: "delegator" }), event(2, { kind: "reopened", cause: "manual", by: "delegator" }),
        event(3, { kind: "sent_to", chatId: "a" }), event(5, { kind: "sent_to", chatId: "a" }), event(9, { kind: "chat_finished", chatId: "a" }),
      ])
      expect(rows(list)).toEqual([["event", "event", "handoff"]])
    })
  })

  test("states read as words", () => {
    expect(["working", "waiting_on_you", "finished", "failed", "stopped"].map((state) => handoffStateLabel(state as never)))
      .toEqual(["Working", "Asking you", "Finished", "Failed", "Stopped"])
  })
})

describe("ticketRepliesLabel", () => {
  test("counts replies, and says when there are none", () => {
    expect(ticketRepliesLabel(0)).toBe("No replies yet")
    expect(ticketRepliesLabel(1)).toBe("1 reply")
    expect(ticketRepliesLabel(3)).toBe("3 replies")
  })
})

describe("a ticket's link in a message", () => {
  test("names its delegator and ticket", () => {
    expect(parseTicketLink("/chat/chat-1?ticket=tk_6f0c2a")).toEqual({ chatId: "chat-1", ticketId: "tk_6f0c2a" })
    expect(parseTicketLink("/chat/chat-1/?a=1&ticket=tk_6f0c2a#end")).toEqual({ chatId: "chat-1", ticketId: "tk_6f0c2a" })
  })

  test("a chat's own link, and anything not a ticket id, is no ticket", () => {
    expect(parseTicketLink("/chat/chat-1")).toBeNull()
    expect(parseTicketLink("/chat/chat-1?ticket=nope")).toBeNull()
    expect(parseTicketLink("/settings?ticket=tk_6f0c2a")).toBeNull()
  })

  test("a plain click opens it in the pane; a modified or middle click, or a page with no pane, follows the address", () => {
    const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }
    expect(opensTicketInPane(click, true)).toBe(true)
    expect(opensTicketInPane({ ...click, metaKey: true }, true)).toBe(false)
    expect(opensTicketInPane({ ...click, ctrlKey: true }, true)).toBe(false)
    expect(opensTicketInPane({ ...click, button: 1 }, true)).toBe(false)
    expect(opensTicketInPane(click, false)).toBe(false)
  })
})

describe("the open question", () => {
  const reply = (id: string, author: "user" | "delegator", text: string, asksUser = false): TicketReply => ({ id, ticketId: "tk_000001", author, text, createdAt: 1, ...(asksUser ? { asksUser: true as const } : {}) })
  const chat = (chatId: string, state: "working" | "waiting_on_you", extra: { queued?: true } = {}) => ({ chatId, title: chatId, state, outstanding: true, lastSentAt: 0, ...extra })
  const title = (chatId: string) => `Chat ${chatId}`

  test("is the delegator's latest asking reply, by its first line of words", () => {
    const question = ticketOpenQuestion({
      state: "waiting_on_you",
      asksUser: true,
      chats: [],
      replies: [reply("r1", "delegator", "Old?", true), reply("r2", "delegator", "## Which wording?\n\nOne: Closed by you.", true), reply("r3", "delegator", "An update.")],
    }, title)
    expect(question).toEqual({ kind: "reply", replyId: "r2", text: "Which wording?" })
  })

  test("is the chat that is asking, when the delegator asks nothing; a queued chat is not asking about this ticket", () => {
    expect(ticketOpenQuestion({ state: "waiting_on_you", asksUser: false, replies: [], chats: [chat("a", "working"), chat("b", "waiting_on_you")] }, title))
      .toEqual({ kind: "chat", chatId: "b", text: "Chat b is asking you" })
    expect(ticketOpenQuestion({ state: "waiting_on_you", asksUser: false, replies: [], chats: [chat("b", "waiting_on_you", { queued: true })] }, title)).toBeNull()
  })

  test("is nothing on a ticket that waits on no one", () => {
    expect(ticketOpenQuestion({ state: "in_progress", asksUser: false, replies: [reply("r1", "delegator", "Which?", true)], chats: [] }, title)).toBeNull()
  })
})
