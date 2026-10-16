import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react"
import { ChevronLeft } from "lucide-react"
import type { TicketDetail } from "../../../shared/tickets"
import type { AgentProvider, ChatSkillsSnapshot } from "../../../shared/types"
import type { ChatInputHandle } from "../../components/chat-ui/ChatInput"
import { useSidebarThread } from "../../components/chat-ui/chat-reference"
import { TICKET_HEAD_TOP_CLASS, TICKET_REPLY_ATTRIBUTE, TicketActivity, TicketColumn, TicketComposer, type TicketReplyOptions, TicketDetailBody, TicketMenu, TicketTitle } from "../../components/tickets/TicketDetail"
import { ViewerIconButton, ViewerSurface } from "../../components/viewer/ViewerSurface"
import { copyTextToClipboard } from "../../lib/clipboard"
import { delegatorDisplayTitle } from "../../lib/delegators"
import { snapshotDroppedFiles } from "../../lib/snapshotDroppedFiles"
import { adjacentTicketId, ticketActivityBlocks, ticketLinkPath, ticketOpenQuestion, ticketReplyCommand, ticketStepOrder, type TicketOpenQuestion } from "../../lib/tickets"
import { useStableSidebarThreads } from "../useStableSidebarThreads"
import { useSidebarStore } from "../../stores/sidebarStore"
import { useTicketBoard, useTicketSummary } from "../../stores/ticketBoardStore"
import { useViewerStore, type ViewerItem } from "../../stores/viewerStore"
import { viewerLevelBelow } from "../../lib/viewer-levels"
import type { ViewerNavigation } from "../../components/viewer/ViewerSurface"
import { prefersReducedMotion } from "../paneAnimation"
import { useOpenChat } from "../useOpenChat"
import type { ChatPreviewContext } from "./ChatPreview"
import { hasFileDragTypes } from "./utils"

type TicketItem = Extract<ViewerItem, { kind: "ticket" }>

/**
 * One ticket in the pane, over its delegator's board: subscribed to on the
 * `ticket` topic for as long as it is open, which pushes it whole whenever
 * anything on it changes. Until the first push it is drawn from its row on
 * the board, so it opens with its title and state at once.
 *
 * Opening it marks it read, and so does news landing while it is open. Mark
 * as unread goes back to the board, since staying would read it again.
 */
export const TicketView = memo(function TicketView({ item, context, onClose }: {
  item: TicketItem
  context: ChatPreviewContext
  onClose: () => void
}) {
  const { socket } = context
  const { chatId, ticketId } = item
  const summary = useTicketSummary(chatId, ticketId)
  const [detail, setDetail] = useState<TicketDetail | null | undefined>(undefined)
  useEffect(() => socket.subscribe<TicketDetail | null>({ type: "ticket", chatId, ticketId }, setDetail), [chatId, socket, ticketId])

  const delegator = useSidebarThread(chatId)
  const delegatorName = delegatorDisplayTitle(delegator?.title ?? "")
  const threads = useStableSidebarThreads(useSidebarStore((store) => store.data))
  const titles = useMemo(() => new Map(threads.map((thread) => [thread.chatId, thread.title])), [threads])
  const linkTitles = useMemo(() => new Map((detail?.chats ?? []).map((link) => [link.chatId, link.title])), [detail?.chats])
  const nameOfChat = useCallback((id: string) => titles.get(id) ?? linkTitles.get(id) ?? "A chat", [linkTitles, titles])

  // Read on open, and again when news lands while it is open, unless it was
  // just marked unread here (and then the view has gone back to the board).
  const unread = detail?.unread ?? summary?.unread ?? false
  const updatedAt = detail?.updatedAt ?? summary?.updatedAt
  const markedUnreadRef = useRef(false)
  useEffect(() => {
    if (!unread || markedUnreadRef.current) return
    void socket.command({ type: "ticket.markRead", chatId, ticketId }).catch(() => {})
  }, [chatId, socket, ticketId, unread, updatedAt])

  const blocks = useMemo(
    () => (detail ? ticketActivityBlocks(detail, { chat: nameOfChat, delegator: delegatorName }) : []),
    [delegatorName, detail, nameOfChat],
  )

  // Opened at the latest, as a conversation is, and kept there as it grows
  // while the reader is there.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stuckRef = useRef(true)
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller && stuckRef.current) scroller.scrollTop = scroller.scrollHeight
  }, [blocks])

  const stepBack = useViewerStore((store) => store.stepBack)
  // Its board is under it on its delegator's page. Opened from a link in
  // another chat it has none there, so it offers no way back to one: its
  // Close, and the pane's own Back where the page has a board of its own.
  const floor = useViewerStore((store) => store.floor)
  const pageChatKey = useViewerStore((store) => store.chatKey)
  const below = viewerLevelBelow({ item }, floor, pageChatKey || null)
  const boardBelow = below !== "closed" && below.item.kind === "delegated" && below.item.chatId === chatId

  // The ↑ and ↓ in the header, and k and j, through the board in its order.
  // Each step puts the next ticket where this one is, as a new card (the view
  // is keyed by ticket): it opens at its latest, is read on opening, and
  // adds no level, so Back still goes to the list. A step from the keyboard
  // lands at once (`changedByKey`); from a button, the body only fades.
  const board = useTicketBoard(chatId)
  const navigation = useMemo<ViewerNavigation | undefined>(() => {
    const order = board ? ticketStepOrder(board.tickets) : []
    const index = order.indexOf(ticketId)
    if (index < 0) return undefined
    const previous = adjacentTicketId(order, ticketId, "previous")
    const next = adjacentTicketId(order, ticketId, "next")
    const go = (id: string | null) => () => {
      if (id) useViewerStore.getState().open({ kind: "ticket", chatId, ticketId: id })
    }
    return {
      index,
      count: order.length,
      onPrevious: go(previous),
      onNext: go(next),
      previousLabel: "Previous ticket · K",
      nextLabel: "Next ticket · J",
      hasPrevious: previous !== null,
      hasNext: next !== null,
    }
  }, [board, chatId, ticketId])
  const shown = detail ?? null
  const head = shown ?? summary

  const reply = useCallback(async (text: string, { attachments, ...run }: TicketReplyOptions) => {
    stuckRef.current = true
    await socket.command(ticketReplyCommand(chatId, ticketId, text, attachments, run))
  }, [chatId, socket, ticketId])

  // The "/" menu lists what the delegator's harness can run, since that is
  // where the reply goes, as a chat's composer lists its own chat's.
  const projectId = delegator?.projectId ?? null
  const listSkills = useCallback(
    (provider: AgentProvider) => socket.command<ChatSkillsSnapshot>({ type: "chat.listSkills", provider, chatId, projectId: projectId ?? undefined }),
    [chatId, projectId, socket],
  )
  const previousReply = useMemo(
    () => [...(detail?.replies ?? [])].reverse().find((candidate) => candidate.author === "user" && candidate.text.trim())?.text ?? null,
    [detail?.replies],
  )

  // Files dropped anywhere on the ticket go to its composer. Handled here,
  // as a previewed chat does: the page's own drop target is the main chat's
  // card, and a drop nothing takes makes the browser open the file.
  const composerRef = useRef<ChatInputHandle | null>(null)
  const handleDragOver = useCallback((event: DragEvent) => {
    if (!hasFileDragTypes(event.dataTransfer?.types ?? [])) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])
  const handleDrop = useCallback((event: DragEvent) => {
    if (!hasFileDragTypes(event.dataTransfer?.types ?? [])) return
    event.preventDefault()
    void snapshotDroppedFiles([...event.dataTransfer.files]).then((files) => composerRef.current?.enqueueFiles(files))
  }, [])
  const setStatus = useCallback((status: "done" | "open") => {
    void socket.command({ type: "ticket.setStatus", chatId, ticketId, status }).catch(() => {})
  }, [chatId, socket, ticketId])
  const markUnread = useCallback(() => {
    markedUnreadRef.current = true
    void socket.command({ type: "ticket.markUnread", chatId, ticketId }).catch(() => {})
    stepBack()
  }, [chatId, socket, stepBack, ticketId])
  const copyLink = useCallback(() => {
    void copyTextToClipboard(new URL(ticketLinkPath(chatId, ticketId), window.location.origin).href)
  }, [chatId, ticketId])

  const openChat = useOpenChat()
  const question = useMemo(() => (detail ? ticketOpenQuestion(detail, nameOfChat) : null), [detail, nameOfChat])
  const openQuestion = (open: TicketOpenQuestion) => {
    if (open.kind === "chat") {
      openChat(open.chatId, { from: "preview" })
      return
    }
    const row = scrollRef.current?.querySelector(`[${TICKET_REPLY_ATTRIBUTE}="${CSS.escape(open.replyId)}"]`)
    row?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" })
  }
  const number = head ? `#${head.number}` : "Ticket"
  return (
    <ViewerSurface
      label={head ? `Ticket ${number}, ${head.title}` : "Ticket"}
      navigation={navigation}
      leading={boardBelow ? <ViewerIconButton label="Back to tickets (Esc)" onClick={stepBack}><ChevronLeft /></ViewerIconButton> : undefined}
      title={(
        <span className="flex min-w-0 items-center gap-1.5">
          {boardBelow
            ? <button type="button" onClick={stepBack} className="shrink-0 font-normal text-muted-foreground outline-none focus-visible:underline pointer-hover:text-foreground">Tickets</button>
            : <span className="shrink-0 font-normal text-muted-foreground">Tickets</span>}
          <span aria-hidden className="text-muted-foreground">/</span>
          <span className="font-semibold tabular-nums">{number}</span>
        </span>
      )}
      toolbar={head ? (
        <TicketMenu
          done={head.state === "done"}
          onSetStatus={setStatus}
          onMarkUnread={markUnread}
          onCopyLink={copyLink}
        />
      ) : null}
      onClose={onClose}
      // Sized by the pane, for the air around the ticket's head.
      bodyClassName="kanna-ticket-pane flex flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col" onDragOver={handleDragOver} onDrop={handleDrop}>
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const box = event.currentTarget
          stuckRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {shown ? (
          <TicketDetailBody
            question={question}
            onOpenQuestion={openQuestion}
            ticket={shown}
            activity={<TicketActivity blocks={blocks} chatTitle={nameOfChat} onOpenChat={(id) => openChat(id, { from: "preview" })} />}
          />
        ) : summary ? (
          // The board's row, until the ticket itself arrives.
          <TicketColumn className={`${TICKET_HEAD_TOP_CLASS} pb-1`}><TicketTitle ticket={summary} /></TicketColumn>
        ) : detail === null ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">This ticket is not in the list any more.</p>
        ) : null}
      </div>
      {detail !== null ? (
        <TicketComposer
          composerRef={composerRef}
          delegatorChatId={chatId}
          ticketId={ticketId}
          projectId={delegator?.projectId ?? null}
          projectPath={delegator?.row.localPath ?? null}
          provider={delegator?.row.provider ?? null}
          availableProviders={context.fallbackProviders}
          onSend={reply}
          onListSkills={listSkills}
          previousPrompt={previousReply}
        />
      ) : null}
      </div>
    </ViewerSurface>
  )
})
