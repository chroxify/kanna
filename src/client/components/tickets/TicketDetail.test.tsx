import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { TicketDetail } from "../../../shared/tickets"
import { ticketActivityBlocks, ticketOpenQuestion } from "../../lib/tickets"
import { TICKET_REPLY_ATTRIBUTE, TicketActivity, TicketDetailBody } from "./TicketDetail"

const at = (hour: number, minute: number) => new Date(2026, 9, 15, hour, minute).getTime()

const ticket: TicketDetail = {
  id: "tk_000002",
  delegatorChatId: "deleg",
  number: 2,
  title: "Edit a visualization's HTML as code",
  state: "in_progress",
  statusLine: "Download is working",
  chats: [
    { chatId: "c1", title: "Download visualization as image", state: "working", outstanding: true, lastSentAt: at(11, 8) },
    { chatId: "c2", title: "HTML source editor", state: "finished", outstanding: false, lastSentAt: at(11, 12) },
  ],
  createdAt: at(11, 0),
  updatedAt: at(11, 40),
  unread: false,
  replyCount: 2,
  body: "Let the user edit a visualization's HTML.",
  bodyEditedAt: at(11, 5),
  asksUser: false,
  awaitingDelegator: false,
  replies: [
    { id: "r1", ticketId: "tk_000002", author: "user", text: "can you mock it up first", createdAt: at(11, 10) },
    { id: "r2", ticketId: "tk_000002", author: "delegator", text: "Should an edit replace the original?", asksUser: true, createdAt: at(11, 32) },
  ],
  history: [
    { id: "e1", ticketId: "tk_000002", createdAt: at(11, 12), kind: "sent_to", chatId: "c2" },
    { id: "e2", ticketId: "tk_000002", createdAt: at(11, 30), kind: "chat_finished", chatId: "c2" },
  ],
}

const names = { chat: (chatId: string) => (chatId === "c2" ? "HTML source editor" : "Download"), delegator: "Main" }

function render() {
  const blocks = ticketActivityBlocks(ticket, names)
  return renderToStaticMarkup(
    <TicketDetailBody
      ticket={ticket}
      activity={<TicketActivity blocks={blocks} chatTitle={names.chat} onOpenChat={() => {}} />}
    />,
  )
}

describe("the ticket pane", () => {
  const html = render()

  test("divides the body from the activity with the transcript's rule, counting the replies only", () => {
    expect(html).toMatch(/bg-border\/70[\s\S]*?>2 replies</)
    expect(html).not.toContain("border-b border-border px-5")
  })

  test("centres the title's mark on the title's first line, from a slot one line tall", () => {
    expect(html).toMatch(/text-lg leading-\[1\.3\]"><span class="flex h-\[1lh\] shrink-0 items-center">/)
    expect(html).not.toContain("mt-1 flex shrink-0")
  })

  test("draws a hand-off's chat logo at a tool row's 16px", () => {
    const activity = html.slice(html.indexOf('class="px-3 pb-2 pt-2"'))
    expect(activity).toContain("size-4 text-muted-icon")
  })

  test("goes title, body, the replies divider, then the activity, with no list of chats", () => {
    const title = html.indexOf("Edit a visualization")
    const body = html.indexOf("Let the user edit")
    const divider = html.indexOf(">2 replies<")
    const activity = html.indexOf('class="px-3 pb-2 pt-2"')
    expect(title).toBeGreaterThan(-1)
    expect([title, body, divider, activity]).toEqual([...[title, body, divider, activity]].sort((x, y) => x - y))
    // The chat with no hand-off in the activity is shown nowhere, and no widget row draws one.
    expect(html).not.toContain("Download visualization as image")
    expect(html).not.toContain("data-row-key")
  })

  test("sets the title and body in the transcript's column, as the activity is", () => {
    const column = 'class="mx-auto w-full max-w-[816px] px-2'
    expect(html.indexOf(column)).toBeGreaterThan(-1)
    expect(html.indexOf(column)).toBeLessThan(html.indexOf("Edit a visualization"))
    // The title's column, then the body's.
    expect(html.split(column).length - 1).toBe(2)
    expect(html).not.toContain('class="px-5')
  })

  test("has no pill and no Activity heading", () => {
    expect(html).not.toContain(">In progress<")
    expect(html).not.toContain(">Activity<")
  })

  test("draws the user's reply as their bubble and the delegator's as an agent's text", () => {
    expect(html).toMatch(/items-end[^>]*>[\s\S]*can you mock it up first/)
    expect(html).toContain("text-pretty prose prose-sm")
    expect(html).not.toContain(">You<")
    expect(html).not.toContain(">Main<")
  })

  test("shows the hand-off as one row, settled in place, that opens its chat", () => {
    expect(html).not.toContain("updates")
    expect(html).not.toContain("Sent to HTML source editor")
    expect(html).not.toContain("· Done")
    expect(html).toMatch(/<button[^>]*>[\s\S]*?HTML source editor[\s\S]*?>Finished</)
  })

  test("draws no time under the user's message or on tool rows, and no rule over the activity's first message", () => {
    const activity = html.slice(html.indexOf('class="px-3 pb-2 pt-2"'))
    expect(activity).not.toMatch(/\d{1,2}:\d{2}/)
    expect(activity).not.toContain("bg-border/70")
  })

  test("draws no badge on a question, and no edited mark", () => {
    expect(html).not.toContain("Asks you")
    expect(html).not.toContain("Edited")
    expect(html).toContain("Should an edit replace the original?")
  })
})

describe("a turn's rule", () => {
  test("is the transcript's own, with the message's time", () => {
    const html = renderToStaticMarkup(
      <TicketActivity
        blocks={[
          { type: "handoff", key: "h", at: at(11, 8), chatId: "c1", state: "working" },
          { type: "divider", key: "d", at: at(11, 10) },
          { type: "user", key: "u", reply: { id: "u", ticketId: "tk_000002", author: "user", text: "faster", createdAt: at(11, 10) } },
        ]}
        chatTitle={() => "Download"}
        onOpenChat={() => {}}
      />,
    )
    expect(html).toContain("bg-border/70")
    expect(html).toMatch(/>11:10\s?AM</)
  })
})

describe("the activity's folded runs", () => {
  const history: TicketDetail["history"] = [
    { id: "f1", ticketId: "tk_000002", createdAt: at(12, 0), kind: "closed", by: "delegator" },
    { id: "f2", ticketId: "tk_000002", createdAt: at(12, 1), kind: "reopened", cause: "manual", by: "delegator" },
    { id: "f3", ticketId: "tk_000002", createdAt: at(12, 2), kind: "sent_to", chatId: "c1" },
  ]
  const html = renderToStaticMarkup(
    <TicketActivity blocks={ticketActivityBlocks({ ...ticket, replies: [], history }, names)} chatTitle={names.chat} onOpenChat={() => {}} />,
  )

  test("draws a run as the transcript's folded line, closed, shimmering while its chat works", () => {
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain("1 close, 1 reopen, 1 hand-off")
    expect(html).not.toContain("Closed by Main")
    expect(html).toContain("kanna-shiny-track")
  })
})

describe("a ticket that waits on the user", () => {
  const asking: TicketDetail = {
    ...ticket,
    state: "waiting_on_you",
    asksUser: true,
    replies: [
      { id: "r1", ticketId: "tk_000002", author: "user", text: "can you mock it up first", createdAt: at(11, 10) },
      {
        id: "r9",
        ticketId: "tk_000002",
        author: "delegator",
        text: "Should an edit replace the original?\n\nThe mock shows both.",
        asksUser: true,
        artifacts: [{ type: "visualization", version: 1, title: "Edit mock", height: 360, url: "/api/chats/deleg/media/visualization-mock.html" }],
        createdAt: at(11, 32),
      },
    ],
  }
  const question = ticketOpenQuestion(asking, names.chat)
  const html = renderToStaticMarkup(
    <TicketDetailBody
      ticket={asking}
      question={question}
      activity={<TicketActivity blocks={ticketActivityBlocks(asking, names)} chatTitle={names.chat} onOpenChat={() => {}} />}
    />,
  )

  test("names the question in one line under the title, before the body", () => {
    expect(question).toMatchObject({ kind: "reply", replyId: "r9", text: "Should an edit replace the original?" })
    const title = html.indexOf("Edit a visualization")
    const line = html.indexOf('title="Should an edit replace the original?"')
    expect(line).toBeGreaterThan(title)
    expect(line).toBeLessThan(html.indexOf("Let the user edit"))
  })

  test("marks the reply the line scrolls to", () => {
    expect(html).toContain(`${TICKET_REPLY_ATTRIBUTE}="r9"`)
  })

  test("draws a mock posted with its words as one message: the words, then the mock", () => {
    const row = html.slice(html.indexOf(`${TICKET_REPLY_ATTRIBUTE}="r9"`))
    const end = row.indexOf(TICKET_REPLY_ATTRIBUTE, 1)
    const message = end > 0 ? row.slice(0, end) : row
    expect(message.indexOf("The mock shows both.")).toBeGreaterThan(-1)
    // The visualization, before it loads (all a server render draws of it).
    expect(message.indexOf('class="visualization')).toBeGreaterThan(message.indexOf("The mock shows both."))
  })

  test("shows no line while it waits on no one", () => {
    // The same asking reply, on a ticket that is In progress.
    expect(render()).not.toContain('title="Should an edit replace the original?"')
  })
})

describe("a hand-off still in its chat's queue", () => {
  const queued: TicketDetail = {
    ...ticket,
    chats: [{ chatId: "c1", title: "Download", state: "working", outstanding: true, queued: true, lastSentAt: at(11, 8) }],
    history: [{ id: "q1", ticketId: "tk_000002", createdAt: at(11, 8), kind: "sent_to", chatId: "c1" }],
    replies: [],
  }
  const html = renderToStaticMarkup(<TicketActivity blocks={ticketActivityBlocks(queued, names)} chatTitle={names.chat} onOpenChat={() => {}} />)

  test("reads Queued, not Working, with no spinner", () => {
    expect(html).toContain(">Queued<")
    expect(html).not.toContain(">Working<")
  })
})
