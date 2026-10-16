import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { TicketStore } from "./ticket-store"

let dataDir: string
beforeEach(async () => { dataDir = await mkdtemp(path.join(tmpdir(), "kanna-tickets-")) })
afterEach(async () => { await rm(dataDir, { recursive: true, force: true }) })

async function reopen(threshold?: number) {
  const store = new TicketStore(dataDir, threshold)
  await store.initialize()
  return store
}

/** A ticket with a hand-off, a reply, a history line, flags and a read mark. */
async function fill(store: TicketStore) {
  await store.append("delegator", [{ type: "ticket_created", at: 100, ticket: { id: "tk_aaaaaa", number: 1, title: "Escape hold", body: "500ms" } }])
  await store.append("delegator", [
    { type: "handoff_added", at: 200, handoff: { delegationId: "dl_1", ticketId: "tk_aaaaaa", childChatId: "child", createdAt: 200, outstanding: true } },
    { type: "history_added", at: 200, event: { id: "th_1", ticketId: "tk_aaaaaa", createdAt: 200, kind: "sent_to", chatId: "child" } },
  ])
  await store.append("delegator", [
    { type: "reply_added", at: 300, reply: { id: "rp_1", ticketId: "tk_aaaaaa", author: "delegator", text: "Which platform?", asksUser: true, createdAt: 300 } },
    { type: "flags_set", at: 300, ticketId: "tk_aaaaaa", asksUser: true, closed: { status: "done", by: "user", at: 300 } },
    { type: "read_set", at: 310, ticketId: "tk_aaaaaa", readAt: 310 },
    { type: "ticket_edited", at: 320, ticketId: "tk_aaaaaa", title: "Escape hold: 500ms", body: "Half a second." },
  ])
  await store.flush()
}

describe("TicketStore", () => {
  test("folds events into tickets and reads them back after a restart", async () => {
    const store = await reopen()
    await fill(store)
    const live = store.get("delegator", "tk_aaaaaa")!
    expect(live).toMatchObject({
      number: 1,
      title: "Escape hold: 500ms",
      body: "Half a second.",
      bodyEditedAt: 320,
      createdAt: 100,
      updatedAt: 300,
      asksUser: true,
      readAt: 310,
      closed: { status: "done", by: "user", at: 300 },
    })
    expect(live.handoffs).toEqual([{ delegationId: "dl_1", ticketId: "tk_aaaaaa", childChatId: "child", createdAt: 200, outstanding: true }])
    expect(store.nextNumber("delegator")).toBe(2)
    expect(store.list("other")).toEqual([])

    const reloaded = await reopen()
    expect(reloaded.get("delegator", "tk_aaaaaa")).toEqual(live)
  })

  test("settling, a dropped close and a dropped read mark survive a restart", async () => {
    const store = await reopen()
    await fill(store)
    await store.append("delegator", [
      { type: "handoffs_settled", at: 400, childChatId: "child" },
      { type: "flags_set", at: 400, ticketId: "tk_aaaaaa", closed: null },
      { type: "read_set", at: 400, ticketId: "tk_aaaaaa", readAt: null },
    ])
    await store.flush()
    const reloaded = (await reopen()).get("delegator", "tk_aaaaaa")!
    expect(reloaded.handoffs[0]!.outstanding).toBe(false)
    expect(reloaded).not.toHaveProperty("closed")
    expect(reloaded).not.toHaveProperty("readAt")
  })

  test("a withdrawn hand-off goes with its sent-to line, and stays gone after a restart", async () => {
    const store = await reopen()
    await fill(store)
    await store.append("delegator", [
      { type: "handoff_added", at: 400, handoff: { delegationId: "dl_2", ticketId: "tk_aaaaaa", childChatId: "child", createdAt: 400, outstanding: true, turn: null } },
      { type: "history_added", at: 400, event: { id: "th_2", ticketId: "tk_aaaaaa", createdAt: 400, kind: "sent_to", chatId: "child" } },
    ])
    await store.append("delegator", [{ type: "handoff_withdrawn", at: 450, ticketId: "tk_aaaaaa", delegationId: "dl_2" }])
    await store.flush()
    for (const read of [store, await reopen()]) {
      const ticket = read.get("delegator", "tk_aaaaaa")!
      // The earlier hand-off to the same chat, and its line, are untouched.
      expect(ticket.handoffs.map((handoff) => handoff.delegationId)).toEqual(["dl_1"])
      expect(ticket.history.map((event) => event.id)).toEqual(["th_1"])
    }
  })

  test("settling can be kept to some tickets", async () => {
    const store = await reopen()
    await fill(store)
    await store.append("delegator", [
      { type: "ticket_created", at: 500, ticket: { id: "tk_bbbbbb", number: 2, title: "Second", body: "" } },
      { type: "handoff_added", at: 500, handoff: { delegationId: "dl_2", ticketId: "tk_bbbbbb", childChatId: "child", createdAt: 500, outstanding: true } },
      { type: "handoffs_settled", at: 600, childChatId: "child", ticketIds: ["tk_bbbbbb"] },
    ])
    expect(store.get("delegator", "tk_aaaaaa")!.handoffs[0]!.outstanding).toBe(true)
    expect(store.get("delegator", "tk_bbbbbb")!.handoffs[0]!.outstanding).toBe(false)
  })

  test("compaction rewrites the file as one snapshot, and appends carry on after it", async () => {
    const store = await reopen(1)
    await fill(store)
    const file = path.join(dataDir, "tickets", "delegator.jsonl")
    const lines = (await readFile(file, "utf8")).trim().split("\n")
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: "board_snapshot", tickets: [{ id: "tk_aaaaaa" }] })
    const before = store.get("delegator", "tk_aaaaaa")

    const reloaded = await reopen()
    expect(reloaded.get("delegator", "tk_aaaaaa")).toEqual(before)
    await reloaded.append("delegator", [{ type: "read_set", at: 700, ticketId: "tk_aaaaaa", readAt: 700 }])
    await reloaded.flush()
    expect((await reopen()).get("delegator", "tk_aaaaaa")?.readAt).toBe(700)
  })

  test("a file over the threshold is compacted when it loads", async () => {
    await fill(await reopen())
    const file = path.join(dataDir, "tickets", "delegator.jsonl")
    expect((await readFile(file, "utf8")).trim().split("\n").length).toBeGreaterThan(1)
    const store = await reopen(1)
    await store.flush()
    expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(1)
    expect(store.get("delegator", "tk_aaaaaa")?.title).toBe("Escape hold: 500ms")
  })

  test("a line cut off by a crash is skipped", async () => {
    await fill(await reopen())
    await appendFile(path.join(dataDir, "tickets", "delegator.jsonl"), '{"v":1,"type":"reply_added","at":9')
    expect((await reopen()).get("delegator", "tk_aaaaaa")?.replies).toHaveLength(1)
  })

  test("each delegator has its own file", async () => {
    const store = await reopen()
    await store.append("one", [{ type: "ticket_created", at: 1, ticket: { id: "tk_111111", number: 1, title: "One", body: "" } }])
    await store.append("two", [{ type: "ticket_created", at: 1, ticket: { id: "tk_222222", number: 1, title: "Two", body: "" } }])
    await store.flush()
    const reloaded = await reopen()
    expect(reloaded.delegatorChatIds().sort()).toEqual(["one", "two"])
    expect(reloaded.list("one").map((ticket) => ticket.title)).toEqual(["One"])
    expect(reloaded.get("two", "tk_222222")?.delegatorChatId).toBe("two")
  })
})
