import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { TicketSummary } from "../../../shared/tickets"
import { TicketBoardList } from "../../components/tickets/TicketBoard"
import { sectionExpanded, setSectionExpanded } from "../../stores/sidebarSectionStore"

/**
 * The board comes back from a ticket as a new card. What it shows is held
 * outside it: the folds (Done shown whole, Other chats open) in the section
 * store under the board's scope, which `TicketBoardPane` reads, and the
 * scroll in `scroll-memory`. A static render reads a store's first state,
 * so the two halves are tested apart: the store keeps the state, and the
 * list draws what it is given.
 */
const done = (number: number): TicketSummary => ({
  id: `tk_${String(number).padStart(6, "0")}`,
  delegatorChatId: "deleg-rt",
  number,
  title: `Ticket ${number}`,
  state: "done",
  statusLine: "1 chat finished",
  chats: [],
  createdAt: number,
  updatedAt: number * 1000,
  unread: false,
  replyCount: 0,
})
const tickets = Array.from({ length: 14 }, (_, index) => done(index + 1))

describe("the board, back from a ticket", () => {
  test("the store keeps Done shown whole, and Other chats open, per board", () => {
    expect(sectionExpanded("delegated:deleg-rt", "done-all")).toBeUndefined()
    // Show 4 more, and Other chats opened; then a ticket opened and closed.
    setSectionExpanded("delegated:deleg-rt", "done-all", true)
    setSectionExpanded("delegated:deleg-rt", "other-chats", true)
    expect(sectionExpanded("delegated:deleg-rt", "done-all")).toBe(true)
    expect(sectionExpanded("delegated:deleg-rt", "other-chats")).toBe(true)
    // Done's own fold, folded until opened, is kept the same way.
    expect(sectionExpanded("delegated:deleg-rt", "done")).toBeUndefined()
    setSectionExpanded("delegated:deleg-rt", "done", true)
    expect(sectionExpanded("delegated:deleg-rt", "done")).toBe(true)
    // Another delegator's board is its own.
    expect(sectionExpanded("delegated:another", "done-all")).toBeUndefined()
  })

  test("the list comes back as the state it is given says", () => {
    const list = (showAllDone: boolean) => renderToStaticMarkup(
      <TicketBoardList tickets={tickets} nowMs={20_000} onOpenTicket={() => {}} showAllDone={showAllDone} onShowAllDoneChange={() => {}} doneExpanded onDoneToggle={() => {}} />,
    )
    const whole = list(true)
    expect(whole).toContain("Show fewer")
    expect(whole).toContain(">Ticket 1<")
    const folded = list(false)
    expect(folded).toContain("Show 4 more")
    expect(folded).not.toContain(">Ticket 1<")
  })
})
