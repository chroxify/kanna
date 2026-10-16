import { delegatedAttentionCount } from "../../lib/delegators"
import { cn } from "../../lib/utils"
import { useRightSidebarStore } from "../../stores/rightSidebarStore"
import { useSidebarStore } from "../../stores/sidebarStore"
import { useTicketBoardStore } from "../../stores/ticketBoardStore"
import { openViewer, useViewerStore } from "../../stores/viewerStore"
import { Button } from "../ui/button"
import { ListTodo } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"

/** The delegated list's toggle, read once: for the command palette, which shows the same state. */
export function isDelegatedPaneOpen(chatId: string): boolean {
  return Boolean(useRightSidebarStore.getState().chatViewers[chatId])
}

/**
 * Opens the list of the chats under a delegator in the viewer's pane, or
 * shuts the pane if it is open. What the navbar's button does, and the
 * command palette's entry.
 */
export function toggleDelegatedPane(chatId: string) {
  if (isDelegatedPaneOpen(chatId)) useViewerStore.getState().shut()
  else openViewer({ kind: "delegated", chatId })
}

/**
 * A delegator's way to its tickets: the navbar's button, just left of the
 * widgets toggle, on a delegator and nowhere else. It opens them in the
 * viewer's pane and shuts the pane again, and counts the tickets that want
 * the user, pane open or not. A to-do list, for what it opens, and not the
 * compass: the title beside it is the delegator's, and says what it is.
 *
 * One control at every width. Beside the chat it is a toggle among the
 * navbar's other plain icon buttons, lit while the pane is open as the
 * widgets toggle is, and the count is what asks for attention. On a phone
 * (`overlay`) there is no pane: the list opens over the transcript, which
 * covers this bar, so the button only ever opens it. There it is in the
 * brand colour, as the mark of what the page is, since the list it stands
 * for is out of sight until asked for.
 */
export function DelegatedListButton({ chatId, overlay }: { chatId: string; overlay: boolean }) {
  // A number, so the button re-renders when the count moves and not for
  // every push of the sidebar. A delegator with a board counts its tickets:
  // waiting on the user, or Done and unread. Its own snapshot says so first,
  // the sidebar's row (which leaves out a zero) otherwise. One from before
  // tickets counts the chats under it, as its list shows them.
  const boardCount = useTicketBoardStore((state) => state.boards[chatId]?.attention)
  const sidebarCount = useSidebarStore((state) => {
    let total = 0
    let tickets: number | undefined
    for (const group of state.data.projectGroups) {
      total += delegatedAttentionCount(group.chats, chatId)
      tickets ??= group.chats.find((row) => row.chatId === chatId)?.ticketAttention
    }
    return tickets ?? total
  })
  const count = boardCount ?? sidebarCount
  const open = useRightSidebarStore((store) => Boolean(store.chatViewers[chatId]))
  const pressed = open && !overlay
  const action = pressed ? "Hide tickets" : "Show tickets"
  const label = count > 0 ? `${action}, ${count} ${count === 1 ? "wants" : "want"} you` : action
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="none"
          aria-label={label}
          aria-pressed={overlay ? undefined : pressed}
          onClick={() => (overlay ? openViewer({ kind: "delegated", chatId }) : toggleDelegatedPane(chatId))}
          className={cn(
            // The box of the buttons beside it (see the terminal and widgets toggles).
            "flex h-9 items-center justify-center gap-1 border border-border/0 px-1.5 hover:!border-border/0 hover:!bg-transparent max-md:h-[45px] max-md:min-w-[42px]",
            overlay ? "text-logo hover:text-logo" : pressed && "text-foreground",
          )}
        >
          <ListTodo strokeWidth={2} className="h-4 shrink-0 max-md:h-5 max-md:w-5" />
          {count > 0 ? (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-foreground/10 px-1 text-xs font-bold leading-none text-foreground tabular-nums">
              {count}
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{action}</TooltipContent>
    </Tooltip>
  )
}
