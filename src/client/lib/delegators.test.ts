import { describe, expect, test } from "bun:test"
import type { SidebarChatRow } from "../../shared/types"
import { delegatedAttentionCount, delegatedThreads, delegatorDisplayTitle, projectDelegators, resolveDelegateTarget } from "./delegators"
import type { SidebarThread } from "./thread-sections"

function thread(chatId: string, row: Partial<SidebarChatRow> = {}, extra: Partial<SidebarThread> = {}): SidebarThread {
  return {
    chatId,
    title: chatId,
    projectId: "p1",
    projectTitle: "kanna",
    projectLabel: { text: "kanna" } as SidebarThread["projectLabel"],
    archived: false,
    lastActivityAt: 0,
    row: { chatId, title: chatId, status: "idle", unread: false, _creationTime: 0, ...row } as SidebarChatRow,
    ...extra,
  }
}

const delegator = (chatId: string, lastActivityAt: number, extra: Partial<SidebarThread> = {}) => (
  thread(chatId, { delegator: true }, { lastActivityAt, ...extra })
)

describe("projectDelegators", () => {
  test("the project's delegators, most recently active first", () => {
    const threads = [delegator("old", 1), thread("plain"), delegator("new", 5), delegator("elsewhere", 9, { projectId: "p2" })]
    expect(projectDelegators(threads, "p1").map((item) => item.chatId)).toEqual(["new", "old"])
  })

  test("archived delegators are not offered, and no project has none", () => {
    expect(projectDelegators([delegator("put-away", 3, { archived: true })], "p1")).toEqual([])
    expect(projectDelegators([delegator("a", 1)], null)).toEqual([])
  })
})

describe("resolveDelegateTarget", () => {
  const delegators = [delegator("recent", 9), delegator("older", 2)]

  test("off when the project has no delegator", () => {
    expect(resolveDelegateTarget([], undefined)).toBeNull()
    expect(resolveDelegateTarget([], { on: true, chatId: "gone" })).toBeNull()
  })

  test("on by default, to the most recently active", () => {
    expect(resolveDelegateTarget(delegators, undefined)?.chatId).toBe("recent")
    expect(resolveDelegateTarget(delegators, {})?.chatId).toBe("recent")
  })

  test("the one used last is the one used next", () => {
    expect(resolveDelegateTarget(delegators, { chatId: "older" })?.chatId).toBe("older")
    expect(resolveDelegateTarget(delegators, { on: true, chatId: "older" })?.chatId).toBe("older")
  })

  test("a remembered delegator that is gone falls back to the most recently active", () => {
    expect(resolveDelegateTarget(delegators, { on: true, chatId: "deleted" })?.chatId).toBe("recent")
  })

  test("turned off stays off, whichever was last used", () => {
    expect(resolveDelegateTarget(delegators, { on: false, chatId: "older" })).toBeNull()
  })
})

describe("delegatedThreads", () => {
  test("the chats directly under the delegator, archived ones included, and nothing deeper", () => {
    const threads = [
      thread("child", { parentChatId: "deleg" }),
      thread("put-away", { parentChatId: "deleg" }, { archived: true }),
      thread("grandchild", { parentChatId: "child" }),
      thread("other", { parentChatId: "another" }),
      thread("plain"),
    ]
    expect(delegatedThreads(threads, "deleg").map((item) => item.chatId)).toEqual(["child", "put-away"])
  })
})

describe("delegatedAttentionCount", () => {
  const row = (extra: Partial<SidebarChatRow>) => ({ parentChatId: "deleg", status: "idle", unread: false, ...extra }) as SidebarChatRow

  test("counts the chats under it that are waiting on the user", () => {
    expect(delegatedAttentionCount([row({ status: "waiting_for_user" }), row({ status: "running" }), row({})], "deleg")).toBe(1)
  })

  test("a chat that finished and has not been opened is counted until it is", () => {
    expect(delegatedAttentionCount([row({ unread: true })], "deleg")).toBe(1)
    expect(delegatedAttentionCount([row({ unread: false })], "deleg")).toBe(0)
  })

  test("an unread mark on a chat still working is not its last word, and not counted", () => {
    expect(delegatedAttentionCount([row({ unread: true, status: "running" }), row({ unread: true, status: "waiting_on_subagent" })], "deleg")).toBe(0)
  })

  test("only this delegator's chats", () => {
    expect(delegatedAttentionCount([row({ status: "waiting_for_user", parentChatId: "other" })], "deleg")).toBe(0)
  })
})

describe("delegatorDisplayTitle", () => {
  test("an unnamed one is called a new delegator", () => {
    expect(delegatorDisplayTitle("New Chat")).toBe("New delegator")
    expect(delegatorDisplayTitle("Ship 0.83")).toBe("Ship 0.83")
  })
})
