import { describe, expect, test } from "bun:test"
import {
  closeChatTab,
  closeChatTabs,
  closeChatTabsToRight,
  closeOtherChatTabs,
  getAdjacentChatTab,
  getChatTabAfterClose,
  groupChatTabs,
  openChatTab,
  pruneChatTabs,
  reorderChatTabs,
  type ChatTab,
} from "./chat-tabs"

const tab = (chatId: string): ChatTab => ({ chatId })
const ids = (tabs: ChatTab[]) => tabs.map((item) => item.chatId)

describe("openChatTab", () => {
  test("opens a chat right of the chat it was opened from, or at the end", () => {
    expect(ids(openChatTab([tab("a"), tab("b")], "c", "a"))).toEqual(["a", "c", "b"])
    expect(ids(openChatTab([tab("a")], "b"))).toEqual(["a", "b"])
  })

  test("leaves a chat that already has a tab where it is", () => {
    const tabs = [tab("a"), tab("b")]
    expect(openChatTab(tabs, "a", "b")).toBe(tabs)
  })
})

describe("closing", () => {
  const tabs = [tab("a"), tab("b"), tab("c")]

  test("hands over to the tab on the right, or the left for the last one", () => {
    expect(getChatTabAfterClose(tabs, "b")).toBe("c")
    expect(getChatTabAfterClose(tabs, "c")).toBe("b")
    expect(getChatTabAfterClose([tab("a")], "a")).toBeNull()
    expect(ids(closeChatTab(tabs, "b"))).toEqual(["a", "c"])
  })
})

describe("closing several", () => {
  const tabs = [tab("a"), tab("b"), tab("c")]

  test("closes every tab but one", () => {
    expect(ids(closeOtherChatTabs(tabs, "b"))).toEqual(["b"])
    expect(closeOtherChatTabs([tab("a")], "a")).toEqual([tab("a")])
  })

  test("closes the tabs to the right of one", () => {
    expect(ids(closeChatTabsToRight(tabs, "a"))).toEqual(["a"])
    expect(closeChatTabsToRight(tabs, "c")).toBe(tabs)
  })
})

describe("getAdjacentChatTab", () => {
  const tabs = [tab("a"), tab("b"), tab("c")]

  test("steps and wraps", () => {
    expect(getAdjacentChatTab(tabs, "a", 1)).toBe("b")
    expect(getAdjacentChatTab(tabs, "c", 1)).toBe("a")
    expect(getAdjacentChatTab(tabs, "a", -1)).toBe("c")
    expect(getAdjacentChatTab([tab("a")], "a", 1)).toBeNull()
  })
})

describe("reorderChatTabs", () => {
  test("takes the new order", () => {
    expect(ids(reorderChatTabs([tab("a"), tab("b")], ["b", "a"]))).toEqual(["b", "a"])
  })
})

describe("pruneChatTabs", () => {
  test("drops tabs for chats that are gone", () => {
    const tabs = [tab("a"), tab("b")]
    expect(ids(pruneChatTabs(tabs, (chatId) => chatId === "a"))).toEqual(["a"])
    expect(pruneChatTabs(tabs, () => true)).toBe(tabs)
  })
})

describe("groupChatTabs", () => {
  const projects: Record<string, string> = { a: "p1", b: "p2", c: "p1", d: "p2" }

  test("gathers a project's tabs where its first tab is, in their order", () => {
    const groups = groupChatTabs([tab("a"), tab("b"), tab("c"), tab("d")], (chatId) => projects[chatId])
    expect(groups.map((group) => [group.projectId, ids(group.tabs)])).toEqual([
      ["p1", ["a", "c"]],
      ["p2", ["b", "d"]],
    ])
  })

  test("leaves a tab with no known project on its own, where it is", () => {
    const groups = groupChatTabs([tab("a"), tab("new"), tab("c")], (chatId) => projects[chatId])
    expect(groups.map((group) => [group.projectId, ids(group.tabs)])).toEqual([
      ["p1", ["a", "c"]],
      [null, ["new"]],
    ])
  })
})

describe("closeChatTabs", () => {
  test("closes the named tabs, and hands back the same array when none are open", () => {
    const tabs = [tab("a"), tab("b"), tab("c")]
    expect(ids(closeChatTabs(tabs, ["a", "c"]))).toEqual(["b"])
    expect(closeChatTabs(tabs, ["x"])).toBe(tabs)
  })
})
