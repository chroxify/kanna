import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { TicketSummary } from "../../../shared/tickets"
import { TicketBoardList, TicketCard, TicketRow } from "./TicketBoard"

const ticket: TicketSummary = {
  id: "tk_00000d",
  delegatorChatId: "deleg",
  number: 13,
  title: "Escape hold: 1.5s to 500ms",
  state: "in_progress",
  statusLine: "Sub-Chat Preview Panel is working",
  chats: [],
  createdAt: 0,
  updatedAt: new Date(2026, 9, 15, 16, 23).getTime(),
  unread: false,
  replyCount: 0,
}
const NOW = new Date(2026, 9, 15, 17, 0).getTime()

describe("TicketRow", () => {
  const html = renderToStaticMarkup(<TicketRow ticket={ticket} nowMs={NOW} onOpen={() => {}} />)

  test("is one line: no status line under the title", () => {
    expect(html).not.toContain(">Sub-Chat Preview Panel is working<")
    expect(html).not.toContain("flex-col")
  })

  test("puts the number after the title, outside its truncation", () => {
    const title = html.indexOf(ticket.title)
    const number = html.indexOf(">#13<")
    expect(title).toBeGreaterThan(-1)
    expect(number).toBeGreaterThan(title)
    expect(html).toMatch(/class="[^"]*shrink-0[^"]*">#13</)
  })

  test("still says the status to a reader who cannot see the mark", () => {
    expect(html).toContain('aria-label="#13 Escape hold: 1.5s to 500ms, Sub-Chat Preview Panel is working"')
  })

  test("is the sidebar row's size", () => {
    expect(html).toContain("px-2 py-1.5")
    expect(html).toContain("items-center")
  })
})

describe("TicketCard", () => {
  test("keeps its status line", () => {
    const html = renderToStaticMarkup(<TicketCard ticket={ticket} nowMs={NOW} onOpen={() => {}} />)
    expect(html).toContain(">Sub-Chat Preview Panel is working<")
  })
})

describe("a read Done ticket's mark", () => {
  test("is the finished check in green, and an unread one keeps the green ping", () => {
    const read = renderToStaticMarkup(<TicketRow ticket={{ ...ticket, id: "tk_0000a1", state: "done", unread: false }} nowMs={NOW} onOpen={() => {}} />)
    expect(read).toContain("lucide-check")
    expect(read).toContain("text-emerald-400")
    expect(read).not.toContain("lucide-ticket")
    const unread = renderToStaticMarkup(<TicketRow ticket={{ ...ticket, id: "tk_0000a2", state: "done", unread: true }} nowMs={NOW} onOpen={() => {}} />)
    expect(unread).toContain("kanna-ping")
    expect(unread).toContain("bg-emerald-400")
  })
})

describe("Other chats", () => {
  const list = (expanded: boolean) => renderToStaticMarkup(
    <TicketBoardList
      tickets={[ticket]}
      nowMs={NOW}
      onOpenTicket={() => {}}
      otherChats={{ count: 2, rows: <span>an untracked chat</span>, expanded, onToggle: () => {} }}
      showAllDone={false}
      onShowAllDoneChange={() => {}}
      doneExpanded={false}
      onDoneToggle={() => {}}
    />,
  )

  test("folded, it is its heading and count alone", () => {
    const html = list(false)
    expect(html).toContain("Other chats")
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain("an untracked chat")
  })

  test("its chevron is centred on the heading's line, not nudged", () => {
    const html = list(false)
    expect(html).toMatch(/<button[^>]*items-center[^>]*aria-expanded|aria-expanded="false"[^>]*items-center/)
    expect(html).not.toContain("translate-y-[2px]")
  })

  test("open, it lists its chats", () => {
    expect(list(true)).toContain("an untracked chat")
  })
})

describe("ticket times on the board", () => {
  test("rows and cards say how long ago, as the sidebar does, with the date and time on hover", () => {
    const row = renderToStaticMarkup(<TicketRow ticket={ticket} nowMs={NOW} onOpen={() => {}} />)
    const card = renderToStaticMarkup(<TicketCard ticket={ticket} nowMs={NOW} onOpen={() => {}} />)
    for (const html of [row, card]) {
      expect(html).toContain(">37m<")
      expect(html).toMatch(/title="[^"]*2026[^"]*"[^>]*>37m</)
    }
  })
})

describe("the list's sections", () => {
  const at = (minutes: number) => NOW - minutes * 60_000
  const tickets: TicketSummary[] = [
    { ...ticket, id: "tk_0000b1", number: 1, title: "Working one", state: "in_progress", updatedAt: at(5) },
    { ...ticket, id: "tk_0000b2", number: 2, title: "Fresh one", state: "done", unread: true, updatedAt: at(10) },
    { ...ticket, id: "tk_0000b3", number: 3, title: "Read one", state: "done", unread: false, updatedAt: at(20) },
  ]
  const list = (doneExpanded: boolean) => renderToStaticMarkup(
    <TicketBoardList tickets={tickets} nowMs={NOW} onOpenTicket={() => {}} showAllDone={false} onShowAllDoneChange={() => {}} doneExpanded={doneExpanded} onDoneToggle={() => {}} />,
  )
  const section = (html: string, label: string) => {
    const start = html.indexOf(`aria-label="${label}"`)
    const end = html.indexOf("</section>", start)
    return html.slice(start, end)
  }

  test("In progress and Ready for review are open, with no fold", () => {
    const html = list(false)
    expect(section(html, "In progress")).toContain(">Working one<")
    expect(section(html, "In progress")).not.toContain("aria-expanded")
    const review = section(html, "Ready for review")
    expect(review).toContain(">Fresh one<")
    expect(review).not.toContain("aria-expanded")
    // Its rows keep the unread ping and the bold title.
    expect(review).toContain("kanna-ping")
    expect(review).toContain("font-semibold")
  })

  test("Done is folded until opened, with Other chats' chevron, and its rows keep the check", () => {
    const folded = section(list(false), "Done")
    expect(folded).toContain('aria-expanded="false"')
    expect(folded).not.toContain(">Read one<")
    const open = section(list(true), "Done")
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain(">Read one<")
    expect(open).toContain("lucide-check")
  })

  test("Waiting on you is not there with nothing waiting", () => {
    expect(list(true)).not.toContain('aria-label="Waiting on you"')
  })
})
