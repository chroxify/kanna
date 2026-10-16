import { useRef, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import type { TicketSummary } from "../../../shared/tickets"
import { formatSidebarAgeLabel } from "../../lib/formatters"
import { formatTicketFullTime, groupTicketBoard, olderTicketsNote, ticketBoardColumns, ticketWantsUser, type TicketBoardGroup } from "../../lib/tickets"
import { useScrollMemory } from "../viewer/scroll-memory"
import { cn } from "../../lib/utils"
import { TicketMark } from "./TicketMark"

/**
 * A delegator's ticket board, in the two shapes the pane gives it: a list
 * grouped by column while the pane sits beside the chat, three columns of
 * cards once it is expanded over it. Drawn from the summaries on the
 * delegator's chat snapshot and nothing else, so it is live as they are.
 * There is no dragging: a ticket's column is derived from its chats.
 */

/**
 * How long ago a ticket last moved, as the sidebar says a chat's age ("19m",
 * "4h", "1d"), so the board's rows read like the chats beside them. On the
 * board's minute clock. The tooltip has the date and time.
 */
function TicketAge({ at, nowMs, className }: { at: number; nowMs: number; className: string }) {
  return <span title={formatTicketFullTime(at)} className={className}>{formatSidebarAgeLabel(at, nowMs)}</span>
}

/** A press gives a row or card 1.5%, in and out on the app's curve. */
const PRESS_CLASS = "transition-[scale] duration-150 ease-snappy active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100"

/** A group's heading: its name and its count, no icon. Sticky, on the card's own colour so rows pass under it. */
export function TicketGroupHeading({ label, count, expanded, onToggle }: {
  label: string
  count: number
  /** With `onToggle`, the heading folds its group, with the sidebar section header's trailing chevron. */
  expanded?: boolean
  onToggle?: () => void
}) {
  const content = (
    <>
      {label}
      <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
      {onToggle ? (
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-snappy motion-reduce:transition-none", expanded && "rotate-90")}
        />
      ) : null}
    </>
  )
  // Centred, not on the baseline: the label and its count are one size, so
  // they line up either way, and the chevron then sits on their line's
  // centre, which is their caps' (`TEXT_LINE_SLOT_CLASS` has the rule).
  const className = "sticky top-0 z-[1] flex w-full items-center gap-1.5 bg-surface px-4 pb-1 pt-3 text-left text-[13px] font-semibold"
  if (!onToggle) return <div className={className}>{content}</div>
  return (
    <button type="button" aria-expanded={expanded} onClick={onToggle} className={cn(className, "cursor-pointer select-none outline-none focus-visible:underline")}>
      {content}
    </button>
  )
}

/**
 * A ticket in the list, on one line in the sidebar's row: its mark, its
 * title (bold while it wants the user), its number, and its time. No line
 * of status under it: the mark and the group's heading already say how it
 * stands, and the ticket itself says the rest. The number follows the
 * title and does not truncate with it, so a long title still says which
 * ticket it is. One mark and no harness logos.
 */
export function TicketRow({ ticket, nowMs, onOpen }: { ticket: TicketSummary; nowMs: number; onOpen: (ticketId: string) => void }) {
  const wants = ticketWantsUser(ticket)
  return (
    // The rows touch, with their spacing inside them, so the pointer moving
    // down the list never falls between two. The box is a sidebar row's
    // (`ThreadRow`): 8px across, 6px down, on the text's 20px line.
    <button
      type="button"
      onClick={() => onOpen(ticket.id)}
      // The status line is still said, for a reader who cannot see the mark.
      aria-label={`#${ticket.number} ${ticket.title}, ${ticket.statusLine}`}
      className={cn(
        "mx-1.5 flex w-[calc(100%-12px)] min-w-0 items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "pointer-hover:border-border pointer-hover:bg-muted/45",
        PRESS_CLASS,
      )}
    >
      <TicketMark ticket={ticket} />
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className={cn("min-w-0 truncate", wants ? "font-semibold" : "font-normal")}>{ticket.title}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">#{ticket.number}</span>
      </span>
      <TicketAge at={ticket.updatedAt} nowMs={nowMs} className="ml-auto shrink-0 pl-3 text-xs tabular-nums text-muted-foreground" />
    </button>
  )
}

/**
 * The board as a list, in its sections (`groupTicketBoard`): Waiting on you
 * while it has tickets, In progress, Ready for review, Done, then the
 * delegator's chats no ticket links to, under Other chats. In progress and
 * Ready for review are always open: they are what is going on and what is
 * news. Done folds like Other chats, folded until opened, and holds its 10
 * latest and a way to the rest.
 */
export function TicketBoardList({ tickets, readDoneTotal, nowMs, onOpenTicket, otherChats, showAllDone, onShowAllDoneChange, doneExpanded, onDoneToggle }: {
  tickets: readonly TicketSummary[]
  /** Every read Done ticket, loaded or not: the snapshot holds only the latest of them. */
  readDoneTotal?: number
  nowMs: number
  onOpenTicket: (ticketId: string) => void
  /** `expanded` and `onToggle` fold the group: it is folded until opened. */
  otherChats?: { count: number; rows: ReactNode; expanded: boolean; onToggle: () => void } | null
  /**
   * Whether Done shows all of itself ("Show N more" pressed). Kept by the
   * pane, not here: this list is a new one each time the board comes back
   * from a ticket, and has to come back as it was left.
   */
  showAllDone: boolean
  onShowAllDoneChange: (showAll: boolean) => void
  /** Whether Done is open: kept by the pane with the other folds. */
  doneExpanded: boolean
  onDoneToggle: () => void
}) {
  const groups = groupTicketBoard(tickets, { showAllDone, readDoneTotal })
  return (
    <div className="pb-2">
      {groups.map((group) => {
        const folds = group.section === "done"
        const open = !folds || doneExpanded
        return (
        <section key={group.section} aria-label={group.label}>
          <TicketGroupHeading
            label={group.label}
            count={group.total}
            {...(folds ? { expanded: doneExpanded, onToggle: onDoneToggle } : {})}
          />
          {open ? group.tickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} nowMs={nowMs} onOpen={onOpenTicket} />) : null}
          {open && group.hidden === 0 && group.unloaded > 0 ? <OlderTicketsNote unloaded={group.unloaded} className="mx-1.5 py-1.5 pl-2.5 pr-2.5" /> : null}
          {open && folds && (group.hidden > 0 || showAllDone) ? (
            <button
              type="button"
              onClick={() => onShowAllDoneChange(!showAllDone)}
              // In line with the group's heading: its 6px margin and 10px of
              // padding put the words at the heading's 16px.
              className="mx-1.5 mb-1.5 w-[calc(100%-12px)] rounded-lg py-1.5 pl-2.5 pr-2.5 text-left text-[13px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-hover:text-foreground"
            >
              {group.hidden > 0 ? `Show ${group.hidden} more` : "Show fewer"}
            </button>
          ) : null}
        </section>
        )
      })}
      {otherChats && otherChats.count > 0 ? (
        <section aria-label="Other chats">
          <TicketGroupHeading label="Other chats" count={otherChats.count} expanded={otherChats.expanded} onToggle={otherChats.onToggle} />
          {otherChats.expanded ? otherChats.rows : null}
        </section>
      ) : null}
    </div>
  )
}

/** A ticket on the full board: its mark, number and time on top, the title, one line of status. */
export function TicketCard({ ticket, nowMs, onOpen }: { ticket: TicketSummary; nowMs: number; onOpen: (ticketId: string) => void }) {
  const wants = ticketWantsUser(ticket)
  return (
    <button
      type="button"
      onClick={() => onOpen(ticket.id)}
      aria-label={`#${ticket.number} ${ticket.title}, ${ticket.statusLine}`}
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 rounded-[10px] border border-border bg-card px-3 pb-[11px] pt-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "pointer-hover:border-muted-foreground/40",
        PRESS_CLASS,
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <TicketMark ticket={ticket} />
        <span className="tabular-nums">#{ticket.number}</span>
        <TicketAge at={ticket.updatedAt} nowMs={nowMs} className="ml-auto tabular-nums" />
      </span>
      <span className={cn("text-sm leading-[1.35]", wants ? "font-semibold" : "font-medium")}>{ticket.title}</span>
      <span className="truncate text-xs text-muted-foreground">{ticket.statusLine}</span>
    </button>
  )
}

/**
 * The board expanded: three columns, each scrolling on its own, all of
 * every column shown. Read Done tickets are here too: this is where the
 * whole board is looked at.
 */
export function TicketBoardColumns({ tickets, readDoneTotal, nowMs, onOpenTicket, scrollKey }: {
  tickets: readonly TicketSummary[]
  readDoneTotal?: number
  nowMs: number
  onOpenTicket: (ticketId: string) => void
  /**
   * Names the board, so it comes back from a ticket scrolled as it was left:
   * the row of columns across, and each column down, as each scrolls itself.
   */
  scrollKey?: string
}) {
  const gridRef = useRef<HTMLDivElement | null>(null)
  useScrollMemory(scrollKey && `${scrollKey}:columns`, gridRef)
  const columns = ticketBoardColumns(tickets, { readDoneTotal })
  return (
    <div
      ref={gridRef}
      // Three columns, or four while Waiting on you has tickets.
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))` }}
      className="grid h-full min-h-0 gap-3 overflow-auto p-3"
    >
      {columns.map((column) => (
        <TicketBoardColumn key={column.section} column={column} nowMs={nowMs} onOpenTicket={onOpenTicket} scrollKey={scrollKey && `${scrollKey}:${column.section}`} />
      ))}
    </div>
  )
}

function TicketBoardColumn({ column, nowMs, onOpenTicket, scrollKey }: {
  column: TicketBoardGroup
  nowMs: number
  onOpenTicket: (ticketId: string) => void
  scrollKey?: string
}) {
  const ref = useRef<HTMLElement | null>(null)
  useScrollMemory(scrollKey, ref)
  return (
    <section
      ref={ref}
      aria-label={column.label}
      className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto rounded-xl bg-muted/45 p-2 scrollbar-hide"
    >
      <h3 className="mx-1.5 mb-0.5 mt-1 flex items-baseline gap-1.5 text-[13px] font-semibold">
        {column.label}
        <span className="font-normal tabular-nums text-muted-foreground">{column.total}</span>
      </h3>
      {column.tickets.length === 0
        ? <p className="mx-1.5 text-xs text-muted-foreground">None</p>
        : column.tickets.map((ticket) => <TicketCard key={ticket.id} ticket={ticket} nowMs={nowMs} onOpen={onOpenTicket} />)}
      {column.unloaded > 0 ? <OlderTicketsNote unloaded={column.unloaded} className="mx-1.5 mb-1" /> : null}
    </section>
  )
}

/**
 * The end of Done when older tickets were left out of the snapshot. Quiet,
 * and nothing to press: they are still there for a link or the agent's
 * tools, just not listed.
 */
function OlderTicketsNote({ unloaded, className }: { unloaded: number; className?: string }) {
  return <p className={cn("text-[13px] text-muted-foreground/70", className)}>{olderTicketsNote(unloaded)}</p>
}
