import { stripSystemMessages } from "../../../shared/message-preview"
import type { MessageSource } from "../../../shared/types"
import { cn } from "../../lib/utils"
import { openViewer } from "../../stores/viewerStore"
import { REPLY_LINE, REPLY_LINE_LEFT_PX, REPLY_QUOTE_WIDTH_CLASS } from "../messages/SourcedMessage"
import { TOOL_QUOTE_CLASS } from "../messages/tool-card"
import { UserMessage } from "../messages/UserMessage"
import { useTicketTranscript } from "./ticket-transcript"
import { TicketGlyph } from "./TicketMark"

type TicketSource = Extract<MessageSource, { kind: "ticket" }>

/**
 * The ticket a reply was written on, as the quote over it. The ticket's
 * glyph and not its live mark: the quote says which ticket the words were
 * about, as a chat's quote does not mark what kind of chat it is, and the
 * ticket's state is the board's to show. A click opens the ticket.
 */
export function TicketReplyQuote({ source }: { source: TicketSource }) {
  const { chatId } = useTicketTranscript()
  const content = (
    <span className="flex min-w-0 items-center gap-2.5">
      <TicketGlyph />
      <span className="-mr-1 shrink-0 tabular-nums text-muted-foreground">#{source.number}</span>
      <span className="min-w-0 truncate">{source.title}</span>
    </span>
  )
  const box = cn(TOOL_QUOTE_CLASS, "max-w-full")
  if (!chatId) return <div className={box}>{content}</div>
  return (
    <button
      type="button"
      onClick={() => openViewer({ kind: "ticket", chatId, ticketId: source.ticketId })}
      className={cn(box, "cursor-pointer outline-none hover:border-muted-foreground/20 focus-visible:ring-2 focus-visible:ring-ring")}
    >
      {content}
    </button>
  )
}

/**
 * The quote on the user's side of the column, over their bubble: the
 * mirror of `ReplyQuoteRow`, with the line hanging the same distance in
 * from the right edge.
 */
export function TicketReplyQuoteRow({ source }: { source: TicketSource }) {
  return (
    <div className="flex min-w-0 max-w-full flex-col items-end">
      <div className={REPLY_QUOTE_WIDTH_CLASS}><TicketReplyQuote source={source} /></div>
      <span
        aria-hidden
        className="rounded-full bg-border"
        style={{ width: REPLY_LINE.widthPx, height: REPLY_LINE.heightPx, marginBlock: REPLY_LINE.clearPx, marginRight: REPLY_LINE_LEFT_PX }}
      />
    </div>
  )
}

/**
 * The user reopening a ticket, as the delegator was told it: all header,
 * nothing typed, so one quiet line on the user's side and not a bubble.
 * A click opens the ticket.
 */
export function TicketReopenedLine({ source }: { source: TicketSource }) {
  const { chatId } = useTicketTranscript()
  const content = (
    <span className="grid min-w-0 grid-cols-[auto_auto_1fr] items-center gap-1.5">
      {/* A tool row's mark slot, as a report's line has. */}
      <span className="flex h-5 w-5 items-center justify-center"><TicketGlyph /></span>
      <span className="h-5 shrink-0 font-medium text-foreground/80">Reopened <span className="tabular-nums">#{source.number}</span></span>
      <span className="h-5 min-w-0 truncate text-muted-foreground">{source.title}</span>
    </span>
  )
  const box = "not-prose flex min-w-0 max-w-[85%] rounded-md text-sm sm:max-w-[80%]"
  return (
    <div className="flex justify-end">
      {chatId ? (
        <button
          type="button"
          onClick={() => openViewer({ kind: "ticket", chatId, ticketId: source.ticketId })}
          className={cn(box, "cursor-pointer outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring pointer-hover:opacity-60")}
        >
          {content}
        </button>
      ) : <div className={box}>{content}</div>}
    </div>
  )
}

/** Whether a ticket prompt draws anything: a reply has words, and a reopen has its line. */
export function ticketPromptHasBody(content: string, source: TicketSource, attachmentCount: number): boolean {
  return Boolean(source.reopened) || stripSystemMessages(content).length > 0 || attachmentCount > 0
}

/**
 * The user's reply on a ticket, as it reached the delegator: their own
 * message, on their side of the column, with the ticket quoted over it. The
 * part of the prompt meant for the agent (the ticket, its chats, how to
 * answer) is a `<system-message>`, which the bubble leaves out.
 */
export function TicketReplyMessage({ content, source, attachments, steered, flash }: {
  content: string
  source: TicketSource
  attachments?: Parameters<typeof UserMessage>[0]["attachments"]
  steered?: boolean
  flash?: boolean
}) {
  if (source.reopened && !stripSystemMessages(content) && !attachments?.length) return <TicketReopenedLine source={source} />
  return (
    <div className="flex flex-col items-end">
      <div className="flex min-w-0 max-w-[85%] justify-end sm:max-w-[80%]"><TicketReplyQuoteRow source={source} /></div>
      <div className="w-full"><UserMessage content={content} attachments={attachments} steered={steered} flash={flash} /></div>
    </div>
  )
}
