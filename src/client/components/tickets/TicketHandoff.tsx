import type { KeyboardEvent } from "react"
import type { TicketSummary } from "../../../shared/tickets"
import { formatTicketTime, handoffChat, ticketShortState } from "../../lib/tickets"
import { cn } from "../../lib/utils"
import { openViewer } from "../../stores/viewerStore"
import { useSidebarThread } from "../chat-ui/chat-reference"
import { TOOL_CARD_CAPTION_CLASS, toolCardClasses } from "../messages/tool-card"
import { TicketGlyph, TicketMark } from "./TicketMark"
import { useTicketClock } from "./useTicketClock"

/**
 * A delegator's hand-off, drawn as the ticket it was for. In a delegator's
 * transcript every `create_chat`, `send_message` and `fork_chat` names a
 * ticket, and the ticket is what the user follows: its card is the chat
 * card's shape, with the ticket's one mark, number, title and last update,
 * then where this hand-off went and how the ticket stands. Live, as the
 * board is. A click opens the ticket in the pane.
 */

function openTicket(delegatorChatId: string, ticketId: string) {
  openViewer({ kind: "ticket", chatId: delegatorChatId, ticketId })
}

export function TicketHandoffCard({ ticket, chatId, verb, reopened = false }: {
  ticket: TicketSummary
  /** The chat this hand-off reached. */
  chatId: string | null
  /** What the call did: "Sent to", "Forked to". */
  verb: string
  /** The hand-off took the ticket back out of Done. */
  reopened?: boolean
}) {
  const thread = useSidebarThread(chatId)
  const link = handoffChat(ticket, chatId)
  const now = useTicketClock()
  const classes = toolCardClasses(false)
  const target = thread?.title ?? link?.title ?? "a chat"
  const open = () => openTicket(ticket.delegatorChatId, ticket.id)
  // Said, since a reopen is meant for a defect in what was delivered: a new ask should have been a new ticket.
  const sent = reopened ? `Reopened, ${verb.toLowerCase()} ${target}` : `${verb} ${target}`
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return
    event.preventDefault()
    open()
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Ticket #${ticket.number} ${ticket.title}: ${sent}, ${ticketShortState(ticket)}. Open the ticket`}
      onClick={open}
      onKeyDown={onKeyDown}
      className={cn(
        classes.box,
        classes.width,
        classes.lit,
        "cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "transition-[scale] duration-150 ease-snappy active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <TicketMark ticket={ticket} />
        <span className="-mr-1 shrink-0 tabular-nums text-muted-foreground">#{ticket.number}</span>
        <span className="min-w-0 truncate">{ticket.title}</span>
        <span className="ml-auto shrink-0 pl-3 text-xs tabular-nums text-muted-foreground">{formatTicketTime(ticket.updatedAt, now)}</span>
      </div>
      <p className={TOOL_CARD_CAPTION_CLASS}>{sent} · {ticketShortState(ticket)}</p>
    </div>
  )
}

/**
 * A later hand-off on a ticket whose card is already higher in the
 * transcript: one slim line, in the look of a report's ("X replied"), with
 * the ticket's glyph, rather than the same card a second time.
 */
export function TicketAlsoSentLine({ delegatorChatId, ticketId, number, chatId, fallbackTitle, reopened = false }: {
  delegatorChatId: string
  ticketId: string
  number: number | null
  chatId: string | null
  fallbackTitle: string
  reopened?: boolean
}) {
  const thread = useSidebarThread(chatId)
  return (
    <button
      type="button"
      onClick={() => openTicket(delegatorChatId, ticketId)}
      className="not-prose flex min-w-0 max-w-full cursor-pointer rounded-md text-sm outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring pointer-hover:opacity-60"
    >
      <span className="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-1.5">
        {/* A tool row's mark slot, as the report's line has. */}
        <span className="flex h-5 w-5 items-center justify-center"><TicketGlyph /></span>
        <span className="h-5 min-w-0 truncate text-left font-medium text-foreground/80">{reopened ? "Reopened, sent to" : "Also sent to"} {thread?.title ?? fallbackTitle}</span>
        {number !== null ? <span className="h-5 shrink-0 tabular-nums text-muted-foreground">#{number}</span> : null}
      </span>
    </button>
  )
}

