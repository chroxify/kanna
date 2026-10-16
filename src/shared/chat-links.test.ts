import { describe, expect, test } from "bun:test"
import { KANNA_CHAT_LINK_INSTRUCTIONS, parseChatLink } from "./chat-links"
import { ticketLinkPath } from "./tickets"

describe("parseChatLink", () => {
  test("recognizes relative and same-origin chat routes", () => {
    expect(parseChatLink("/chat/abc-123")).toBe("/chat/abc-123")
    expect(parseChatLink("https://kanna.example/chat/abc-123?x=1#reply", "https://kanna.example"))
      .toBe("/chat/abc-123?x=1#reply")
  })
  test("leaves files, external URLs, and invalid routes alone", () => {
    for (const href of [undefined, "/Users/brian/chat.jsonl", "/chat/", "/chat/a/file", "//evil.example/chat/a", "javascript:alert(1)", "https://other.example/chat/a"]) {
      expect(parseChatLink(href, "https://kanna.example")).toBeNull()
    }
  })
})

describe("ticket links", () => {
  test("a ticket's link is a chat link, relative or on this origin", () => {
    const path = ticketLinkPath("chat-1", "tk_6f0c2a")
    expect(parseChatLink(path)).toBe("/chat/chat-1?ticket=tk_6f0c2a")
    expect(parseChatLink(`https://kanna.example${path}`, "https://kanna.example")).toBe(path)
    expect(parseChatLink(`https://elsewhere.example${path}`, "https://kanna.example")).toBeNull()
  })

  test("agents are told the ticket form beside the chat form", () => {
    expect(KANNA_CHAT_LINK_INSTRUCTIONS).toContain("[#12 Ticket title](/chat/<chatId>?ticket=<ticketId>)")
    expect(KANNA_CHAT_LINK_INSTRUCTIONS).toContain("[Chat title](/chat/<chatId>)")
  })
})
