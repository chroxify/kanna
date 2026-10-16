import { useEffect, useRef } from "react"
import { MessageCircle, Ticket } from "lucide-react"
import type { TicketChatLink, TicketSummary } from "../../../shared/tickets"
import { ticketChipMarkKind, ticketMarkKind, type TicketMarkKind } from "../../lib/tickets"
import { cn } from "../../lib/utils"
import { useSidebarThread } from "../chat-ui/chat-reference"
import { PROVIDER_ICONS } from "../chat-ui/ChatPreferenceControls"
import { STATUS_MARK_SLOT_CLASS, StatusMark } from "../chat-ui/StatusMark"
import { TASK_STATUS_ICON } from "../chat-ui/widgets/task-status-icon"

const MARK_LABELS: Record<TicketMarkKind, string> = {
  working: "In progress",
  waiting: "Waiting on you",
  unread: "Done, unread",
  read: "Done",
}

/**
 * The mark each ticket was last drawn with, anywhere on the page. A ping
 * grows in only when a ticket already seen changes to it: not on the page's
 * first paint, and not when a row is drawn again or moves to another group
 * (which mounts it afresh) still saying what it said.
 */
const lastMarks = new Map<string, TicketMarkKind>()

function useMarkEnters(ticketId: string, kind: TicketMarkKind): boolean {
  const decided = useRef<{ kind: TicketMarkKind; enters: boolean } | null>(null)
  if (decided.current?.kind !== kind) {
    const previous = lastMarks.get(ticketId) ?? decided.current?.kind
    decided.current = { kind, enters: previous !== undefined && previous !== kind && (kind === "waiting" || kind === "unread") }
  }
  useEffect(() => {
    lastMarks.set(ticketId, kind)
  }, [kind, ticketId])
  return decided.current.enters
}

/** The muted ticket glyph, in a mark's slot: for the lines and quotes that point at a ticket, which are not its status. */
export function TicketGlyph({ className }: { className?: string }) {
  return (
    <span className={STATUS_MARK_SLOT_CLASS}>
      <Ticket aria-hidden className={cn("size-4 text-muted-foreground", className)} />
    </span>
  )
}

/**
 * A ticket's one mark (`ticketMarkKind`): the sidebar's spinner and pings,
 * or for a read Done ticket the Tasks widget's finished check, in the green
 * of the unread ping it follows. The same on a row, a card, the ticket's
 * title and the transcript's card.
 */
export function TicketMark({ ticket }: { ticket: Pick<TicketSummary, "id" | "state" | "unread"> }) {
  const kind = ticketMarkKind(ticket)
  const enters = useMarkEnters(ticket.id, kind)
  if (kind === "read") return <TicketDoneMark />
  return <StatusMark kind={kind} label={MARK_LABELS[kind]} enters={enters} />
}

function TicketDoneMark() {
  // Read at render, not when the module loads, so no import order can find it unset.
  const DoneIcon = TASK_STATUS_ICON.completed.Icon
  return (
    <span className={STATUS_MARK_SLOT_CLASS}>
      <DoneIcon role="img" aria-label={MARK_LABELS.read} className="size-4 text-emerald-400" />
    </span>
  )
}

/**
 * A linked chat's mark on its chip: the sidebar's mark while it is working
 * or waiting on the user, and its harness logo once it is neither. Never
 * both, and never the chat's unread ping: the ticket says whether there is
 * news, and the chip only who did the work.
 */
export function TicketChatMark({ link, harnessClassName = "size-3 text-muted-foreground" }: {
  link: Pick<TicketChatLink, "chatId" | "state" | "queued">
  /** The logo's size and colour: a widget row's column sizes it itself, a tool row's slot takes 16px. */
  harnessClassName?: string
}) {
  const thread = useSidebarThread(link.chatId)
  const kind = ticketChipMarkKind(link.state, link.queued === true)
  if (kind !== "harness") return <StatusMark kind={kind} label={kind === "working" ? "Working" : "Waiting on you"} />
  const Harness = thread?.row.provider ? PROVIDER_ICONS[thread.row.provider] : MessageCircle
  return (
    <span className={STATUS_MARK_SLOT_CLASS}>
      <Harness aria-hidden className={harnessClassName} />
    </span>
  )
}
