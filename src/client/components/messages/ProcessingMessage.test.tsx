import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ProcessingMessage } from "./ProcessingMessage"

describe("ProcessingMessage", () => {
  test("waiting on a subagent is a line of words that shimmers, with no spinner before it", () => {
    const html = renderToStaticMarkup(<ProcessingMessage status="waiting_on_subagent" waitingOn={{ chats: 2, agents: 0 }} />)
    expect(html).toContain("Waiting on 2 chats")
    // Jake's wording, with no dots after it.
    expect(html).not.toContain("Waiting on 2 chats.")
    expect(html).toContain("kanna-shiny-track")
    expect(html).not.toContain("animate-spin")
    expect(html).not.toContain("<svg")
  })

  test("says what it can when the count has not come", () => {
    expect(renderToStaticMarkup(<ProcessingMessage status="waiting_on_subagent" />)).toContain("Waiting on chats")
  })

  test("a turn of the chat's own keeps its spinner", () => {
    const html = renderToStaticMarkup(<ProcessingMessage status="running" />)
    expect(html).toContain("Running...")
    expect(html).toContain("animate-spin")
  })
})
