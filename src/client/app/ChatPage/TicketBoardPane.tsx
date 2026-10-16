import { memo, useMemo } from "react"
import { ThreadRowContent } from "../../components/chat-ui/ThreadRowContent"
import { TicketBoardColumns, TicketBoardList } from "../../components/tickets/TicketBoard"
import { useViewerPlacement, VIEWER_END_PAD_CLASS, ViewerSurface } from "../../components/viewer/ViewerSurface"
import { getThreadDetailLabel } from "../../lib/thread-detail-label"
import type { SidebarThread } from "../../lib/thread-sections"
import { cn, normalizeChatId } from "../../lib/utils"
import type { TicketBoard } from "../../stores/ticketBoardStore"
import { useSectionOverrides } from "../../stores/sidebarSectionStore"
import { openViewer } from "../../stores/viewerStore"

/** The key "Other chats" is folded under, in the board's list of sections. */
const OTHER_CHATS_SECTION = "other-chats"
/** And the key Done's "Show N more" is kept under, open or not. */
const ALL_DONE_SECTION = "done-all"
/** And Done's own fold: folded until opened, like Other chats. */
const DONE_SECTION = "done"

/**
 * A delegator's ticket board in the pane, where its list of chats was: what
 * the compass in the navbar opens, and the floor of a delegator's pane (see
 * `lib/viewer-levels`). Beside the chat it is a list grouped by column;
 * the pane's Expand lays it over the chat as three columns of cards.
 *
 * A ticket opens over it, and Back returns here. The delegator's chats that
 * no ticket links to (an older delegator's) are under "Other chats", and
 * open as any chat picked here does.
 */
export const TicketBoardPane = memo(function TicketBoardPane({ delegatorChatId, delegatorTitle, board, threads, nowMs, onSelectChat, onClose }: {
  delegatorChatId: string
  /** Null for a delegator not named yet: the pane is then just "Tickets". */
  delegatorTitle: string | null
  board: TicketBoard
  /** The sidebar's chats, for the ones under "Other chats". */
  threads: readonly SidebarThread[]
  nowMs: number
  onSelectChat: ((chatId: string) => void) | null
  onClose: () => void
}) {
  const expanded = useViewerPlacement()?.expanded ?? false
  // Folded until opened, and kept as it was left while the page is open (a
  // ticket opened over the board and closed again finds it as it was), as
  // the sidebar's own sections are kept.
  const [sectionOverrides, setSectionExpanded] = useSectionOverrides(`delegated:${delegatorChatId}`)
  const othersExpanded = sectionOverrides[OTHER_CHATS_SECTION] ?? false
  // Kept with the folds, for the same reason: the board is a new card each
  // time it comes back from a ticket, and comes back as it was left, Done
  // shown whole or not, and so scrolled where it was (`scrollMemoryKey`).
  const showAllDone = sectionOverrides[ALL_DONE_SECTION] ?? false
  const doneExpanded = sectionOverrides[DONE_SECTION] ?? false
  const openTicket = (ticketId: string) => openViewer({ kind: "ticket", chatId: delegatorChatId, ticketId })

  const others = useMemo(() => {
    const ids = new Set(board.untrackedChatIds)
    return threads.filter((thread) => ids.has(thread.chatId) && !thread.archived)
  }, [board.untrackedChatIds, threads])

  const otherRows = onSelectChat ? others.map((thread) => (
    <button
      key={thread.chatId}
      type="button"
      data-chat-id={normalizeChatId(thread.chatId)}
      onClick={() => onSelectChat(thread.chatId)}
      className={cn(
        // A board row's box, so the two groups line up.
        "mx-1.5 flex h-[34px] w-[calc(100%-12px)] min-w-0 items-center gap-2.5 rounded-lg border border-transparent pl-2 pr-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "pointer-hover:border-border pointer-hover:bg-muted/45",
        "transition-[scale] duration-150 ease-snappy active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100",
      )}
    >
      <ThreadRowContent thread={thread} showStatus delegatorMark={false} detailLabel={getThreadDetailLabel(thread, "project-scoped", nowMs)} />
    </button>
  )) : null

  return (
    <ViewerSurface
      label={delegatorTitle ? `Tickets, ${delegatorTitle}` : "Tickets"}
      title={<span className="font-semibold">Tickets</span>}
      subtitle={delegatorTitle ?? undefined}
      onClose={onClose}
      bodyClassName={expanded ? "flex flex-col overflow-hidden" : undefined}
      // Back from a ticket is a new card: it opens where the board was left.
      scrollMemoryKey={expanded ? undefined : `delegated:${delegatorChatId}`}
      // There when a delegator's page opens, without having been asked for.
      quietFocus
    >
      {board.tickets.length === 0 && others.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No tickets yet. Each piece of work this delegator hands out gets one here.
        </p>
      ) : expanded ? (
        <TicketBoardColumns tickets={board.tickets} readDoneTotal={board.readDoneTotal} nowMs={nowMs} onOpenTicket={openTicket} scrollKey={`tickets:${delegatorChatId}`} />
      ) : (
        <div className={VIEWER_END_PAD_CLASS}>
          <TicketBoardList
            tickets={board.tickets}
            readDoneTotal={board.readDoneTotal}
            nowMs={nowMs}
            onOpenTicket={openTicket}
            otherChats={otherRows ? { count: others.length, rows: otherRows, expanded: othersExpanded, onToggle: () => setSectionExpanded(OTHER_CHATS_SECTION, !othersExpanded) } : null}
            showAllDone={showAllDone}
            onShowAllDoneChange={(showAll) => setSectionExpanded(ALL_DONE_SECTION, showAll)}
            doneExpanded={doneExpanded}
            onDoneToggle={() => setSectionExpanded(DONE_SECTION, !doneExpanded)}
          />
        </div>
      )}
    </ViewerSurface>
  )
})
