import { useState, type ReactNode, type Ref } from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { Check, CircleCheck, CircleHelp, Ellipsis, Link, Mail, PencilLine, RotateCcw, X } from "lucide-react"
import { displayAttachments } from "../../../shared/display-tools"
import type { TicketDetail, TicketHistoryEvent } from "../../../shared/tickets"
import type { AgentProvider, ChatAttachment, ChatSkillsSnapshot, ModelOptions, ProviderCatalogEntry } from "../../../shared/types"
import { readVisualizationArtifact } from "../../../shared/visualization"
import { FOCUS_FALLBACK_IGNORE_ATTRIBUTE } from "../../app/chatFocusPolicy"
import { handoffStateLabel, type TicketOpenQuestion, ticketActivityGroupLabel, ticketActivityGroupRunning, ticketActivityRows, ticketDraftKey, ticketRepliesLabel, type TicketActivityBlock } from "../../lib/tickets"
import { cn } from "../../lib/utils"
import { useChatReferenceActions, useSidebarThread } from "../chat-ui/chat-reference"
import { chatOpenMenuItems } from "../chat-ui/ChatOpenMenuItems"
import { ChatInput, type ChatInputHandle } from "../chat-ui/ChatInput"
import { TEXT_LINE_SLOT_CLASS } from "../chat-ui/StatusMark"
import { ThreadRowMenu } from "../chat-ui/sidebar/ThreadRow"
import { CollapsedGroup } from "../messages/CollapsedToolGroup"
import { AttachmentsCard } from "../messages/DisplayToolMessage"
import { formatPromptBoundary, TimeBoundary } from "../messages/ResultMessage"
import { MetaIconSlot, MetaLabel, MetaRow } from "../messages/shared"
import { AssistantText } from "../messages/TextMessage"
import { TRANSCRIPT_COLUMN_CLASS, TRANSCRIPT_ROW_CLASS } from "../messages/transcript-row"
import { UserMessage } from "../messages/UserMessage"
import { Visualization } from "../messages/Visualization"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import { TicketChatMark, TicketMark } from "./TicketMark"

/** What a reply carries besides its words: its files, and the composer's settings for the turn it starts. */
export interface TicketReplyOptions {
  attachments: ChatAttachment[]
  provider?: AgentProvider
  model?: string
  modelOptions?: ModelOptions
  planMode?: boolean
  autoPlan?: boolean
}

/**
 * One ticket, as the pane shows it under its breadcrumb: its mark and title,
 * the chats on it, what the work is, then everything that happened, oldest
 * first, and a composer to reply. Drawn from props; `TicketView` is what
 * subscribes and sends.
 *
 * Below the body it is a chat transcript, drawn by the transcript's own
 * parts, so it reads as one: the user's replies are their bubbles
 * (`UserMessage`), the delegator's are an agent's text (`AssistantText`),
 * and history is tool rows, a hand-off one row that keeps up with its chat,
 * each in a transcript row's box.
 */


/** The ticket's mark and its title, as a chat row puts its mark before its title. */
export function TicketTitle({ ticket, below }: {
  ticket: Pick<TicketDetail, "id" | "state" | "unread" | "title">
  /** Under the title, at its indent: the open question's line. */
  below?: ReactNode
}) {
  return (
    // Top-aligned, and the mark centred on the title's first line: a title
    // that wraps keeps its mark by its first words.
    <div className="flex items-start gap-[9px] text-lg leading-[1.3]">
      <span className={TEXT_LINE_SLOT_CLASS}><TicketMark ticket={ticket} /></span>
      <div className="min-w-0 flex-1">
        <h2 className="min-w-0 font-semibold tracking-[-0.01em] text-foreground">{ticket.title}</h2>
        {below}
      </div>
    </div>
  )
}

/** Marks a reply's row in the activity, for the open question's line to scroll to. */
export const TICKET_REPLY_ATTRIBUTE = "data-ticket-reply"

/**
 * What a ticket in Waiting on you waits for, in one quiet line under its
 * title (`ticketOpenQuestion`): the delegator's question, which a click
 * scrolls to, or the chat that is asking, which a click opens. One line in
 * the head, not a badge on the reply: the reply is where it is answered.
 */
function OpenQuestionLine({ question, onOpen }: { question: TicketOpenQuestion; onOpen?: (question: TicketOpenQuestion) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(question)}
      title={question.text}
      className="mt-1 flex max-w-full cursor-pointer items-center gap-1.5 rounded-md text-left text-sm leading-5 text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-hover:text-foreground"
    >
      <CircleHelp aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{question.text}</span>
    </button>
  )
}

/**
 * A history line as a tool row (ToolCallMessage's): its mark in the 20px
 * slot and the words, and no time, as a tool row has none: the rule over
 * the turn dates it. A line that names a chat opens it in the previewer, as
 * the chat's row in the header does, with the tool row's hover and a press.
 */
function ActivityLine({ icon, label, detail, onOpen }: {
  icon: ReactNode
  label: string
  /** Quieter, after the words: how a hand-off stands. */
  detail?: string
  onOpen?: () => void
}) {
  const content = (
    <span className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-1.5 text-sm">
      <MetaIconSlot>{icon}</MetaIconSlot>
      <span className="flex min-w-0 items-baseline gap-2">
        <MetaLabel className="min-w-0 truncate text-left">{label}</MetaLabel>
        {detail ? <span className="shrink-0 text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </span>
  )
  if (!onOpen) return <MetaRow className="w-full">{content}</MetaRow>
  return (
    <MetaRow className="w-full">
      <button
        type="button"
        onClick={onOpen}
        // The middle button, which opening a chat reads as "in a tab".
        onAuxClick={(event) => { if (event.button === 1) onOpen() }}
        className="min-w-0 max-w-full cursor-pointer rounded-md outline-none transition-[opacity,scale] duration-150 ease-snappy hover:opacity-60 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        {content}
      </button>
    </MetaRow>
  )
}

/**
 * A hand-off, as one row that keeps up with the chat it went to: the chat's
 * live mark or its harness logo (an X once it failed), its title, and how it
 * stands. The one place on the ticket a chat is shown, so it carries the
 * chat's own right-click menu, as a chat's card in a transcript does.
 */
function HandoffRow({ block, title, onOpen }: {
  block: Extract<TicketActivityBlock, { type: "handoff" }>
  title: string
  onOpen: (chatId: string) => void
}) {
  const thread = useSidebarThread(block.chatId)
  const actions = useChatReferenceActions()
  const icon = block.state === "failed"
    ? <X className="size-4 text-destructive" />
    // A tool row's icon is 16px; the chat's logo is one here too.
    : <TicketChatMark link={{ chatId: block.chatId, state: block.state, queued: block.queued }} harnessClassName="size-4 text-muted-icon" />
  const line = (
    <ActivityLine
      icon={icon}
      label={thread?.title ?? title}
      detail={block.queued ? "Queued" : handoffStateLabel(block.state)}
      onOpen={() => onOpen(block.chatId)}
    />
  )
  if (!thread || !actions) return line
  return (
    <ThreadRowMenu
      thread={thread}
      archived={thread.archived}
      editorLabel={actions.editorLabel}
      {...actions.menu}
      leadingItems={chatOpenMenuItems(thread, actions)}
    >
      <div>{line}</div>
    </ThreadRowMenu>
  )
}

/** The mark of a history line that is not a hand-off. */
function eventIcon(kind: TicketHistoryEvent["kind"]): ReactNode {
  switch (kind) {
    case "chat_failed": return <X className="size-4 text-destructive" />
    case "chat_asking": return <CircleHelp className="size-4 text-muted-icon" />
    case "closed": return <CircleCheck className="size-4 text-muted-icon" />
    case "reopened": return <RotateCcw className="size-4 text-muted-icon" />
    case "renamed": return <PencilLine className="size-4 text-muted-icon" />
    case "sent_to":
    case "chat_finished": return <Check className="size-4 text-muted-icon" />
  }
}

/**
 * The parts a reply is in the transcript's terms. The user's: their bubble,
 * with its attachments over it. The delegator's: its text, then each
 * visualization and set of files, as `show_visualization` and
 * `send_attachments` draw in a chat. Drawn as one message: a mock posted
 * with its words (`show_visualization` with `text`) is one reply.
 */
function replyRows(block: Extract<TicketActivityBlock, { type: "user" | "delegator" }>): Array<{ key: string; node: ReactNode }> {
  const { reply } = block
  if (block.type === "user") {
    return [{ key: reply.id, node: <UserMessage content={reply.text} attachments={reply.attachments} /> }]
  }
  const artifacts = reply.artifacts ?? []
  const visualizations = artifacts.flatMap((artifact) => {
    const read = readVisualizationArtifact([artifact])
    return read ? [read] : []
  })
  const files = displayAttachments(artifacts)
  const rows: Array<{ key: string; node: ReactNode }> = []
  if (reply.text.trim()) rows.push({ key: reply.id, node: <AssistantText text={reply.text} /> })
  for (const artifact of visualizations) rows.push({ key: `${reply.id}:${artifact.url}`, node: <Visualization key={artifact.url} artifact={artifact} /> })
  if (files.length > 0) rows.push({ key: `${reply.id}:files`, node: <AttachmentsCard attachments={files} /> })
  if (rows.length === 0) rows.push({ key: reply.id, node: null })
  // Nothing is drawn to say a reply asks the user something, as nothing is
  // under an agent's question in a chat: the words say it, and the ticket's
  // mark (Waiting on you) says it is waiting.
  return rows
}

/**
 * The activity, as transcript rows (`ticketActivityBlocks`), each in a
 * transcript row's box and at the transcript's inset (its 12px, the row's
 * 8px), so the rhythm and the column are the chat's. Hand-offs and events
 * fold as tool calls do (`ticketActivityRows`): a run of them is one line,
 * folded until opened, that shimmers while a chat in it works. New rows
 * arrive as a chat's do: in place, with no entrance of their own.
 */
export function TicketActivity({ blocks, chatTitle, onOpenChat }: {
  blocks: readonly TicketActivityBlock[]
  chatTitle: (chatId: string) => string
  onOpenChat: (chatId: string) => void
}) {
  // Keyed by a group's first row, which a growing run keeps, as the transcript's are.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const box = (key: string, node: ReactNode) => <div key={key} className={TRANSCRIPT_ROW_CLASS}>{node}</div>
  const line = (block: Extract<TicketActivityBlock, { type: "handoff" | "event" }>) => {
    if (block.type === "handoff") return <HandoffRow block={block} title={chatTitle(block.chatId)} onOpen={onOpenChat} />
    const { chatId } = block
    return <ActivityLine icon={eventIcon(block.kind)} label={block.text} onOpen={chatId ? () => onOpenChat(chatId) : undefined} />
  }
  return (
    <div className="px-3 pb-2 pt-2">
      {ticketActivityRows(blocks).flatMap((row) => {
        if (row.type === "group") {
          const key = row.items[0]!.key
          const lines = row.items.flatMap((block) => (block.type === "handoff" || block.type === "event" ? [block] : []))
          return [box(key, (
            <CollapsedGroup
              label={ticketActivityGroupLabel(lines)}
              loading={ticketActivityGroupRunning(lines)}
              count={lines.length}
              expanded={expanded[key] ?? false}
              onExpandedChange={(next) => setExpanded((current) => ({ ...current, [key]: next }))}
            >
              {lines.map((block) => <div key={block.key}>{line(block)}</div>)}
            </CollapsedGroup>
          ))]
        }
        const block = row.item
        if (block.type === "divider") {
          return [box(block.key, <TimeBoundary label={formatPromptBoundary(new Date(block.at).toISOString())} />)]
        }
        if (block.type === "handoff" || block.type === "event") return [box(block.key, line(block))]
        const parts = replyRows(block)
        return [(
          // Found by the line under the title that names the open question.
          <div key={block.key} className={TRANSCRIPT_ROW_CLASS} {...{ [TICKET_REPLY_ATTRIBUTE]: block.reply.id }}>
            {parts.length === 1
              ? parts[0]!.node
              // The rhythm of separate transcript rows: a row's 4px margin and 8px either side.
              : <div className="flex flex-col gap-5">{parts.map((part) => <div key={part.key}>{part.node}</div>)}</div>}
          </div>
        )]
      })}
    </div>
  )
}

/**
 * The air between the pane's header and the title, here and while the
 * ticket loads, and under the body down to the replies' rule. Fluid with the
 * pane's height: see `.kanna-ticket-pane`.
 */
export const TICKET_HEAD_TOP_CLASS = "pt-(--ticket-head-gap)"
const TICKET_BODY_END_CLASS = "pb-(--ticket-body-end)"

/**
 * The transcript's column, at its inset (the viewport's 12px, a row's 8px),
 * for what heads a ticket: its title and body sit where its activity's text
 * does, in a narrow pane 20px in and in a wide one in the same centred
 * column. Not a row's box, which would add a row's margin between them.
 */
export function TicketColumn({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="px-3">
      <div className={cn(TRANSCRIPT_COLUMN_CLASS, "px-2", className)}>{children}</div>
    </div>
  )
}

/**
 * The ticket's head: its mark and title, then the body, and under it, where
 * the conversation starts, the transcript's own
 * rule, saying how many replies there are (`ticketRepliesLabel`). Live: the
 * count is of the replies the ticket has as pushed.
 */
export function TicketDetailBody({ ticket, activity, question, onOpenQuestion }: {
  ticket: TicketDetail
  activity: ReactNode
  /** What it waits on the user for, while it does. */
  question?: TicketOpenQuestion | null
  onOpenQuestion?: (question: TicketOpenQuestion) => void
}) {
  const hasBody = Boolean(ticket.body.trim())
  return (
    <>
      {/* The same air down to the rule as above the title, from the body or, with none, the title. */}
      <TicketColumn className={cn(TICKET_HEAD_TOP_CLASS, hasBody ? "pb-1" : TICKET_BODY_END_CLASS)}>
        <TicketTitle ticket={ticket} below={question ? <OpenQuestionLine question={question} onOpen={onOpenQuestion} /> : null} />
      </TicketColumn>
      {hasBody ? (
        <TicketColumn className={cn(TICKET_BODY_END_CLASS, "pt-1.5")}>
          {/* An agent's text, as the transcript draws one: the same prose, and the same markdown. */}
          <AssistantText text={ticket.body} />
        </TicketColumn>
      ) : null}
      {/* In a transcript row's box at the activity's inset, as the rules between its turns are. */}
      <div className="px-3">
        <div className={TRANSCRIPT_ROW_CLASS}><TimeBoundary label={ticketRepliesLabel(ticket.replies.length)} /></div>
      </div>
      {activity}
    </>
  )
}

const MENU_ITEM_CLASS = "flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none focus-visible:bg-muted pointer-hover:bg-muted [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"

/**
 * The ticket's ••• menu: Close or Reopen, Mark as unread, Copy link. Radix's
 * popover without the app's wrapper, whose own entrance would win over this
 * one's (`kanna-ticket-menu` in index.css).
 */
export function TicketMenu({ done, onSetStatus, onMarkUnread, onCopyLink }: {
  done: boolean
  onSetStatus: (status: "done" | "open") => void
  onMarkUnread: () => void
  onCopyLink: () => void
}) {
  const [open, setOpen] = useState(false)
  const run = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <PopoverPrimitive.Trigger asChild>
            <button
              type="button"
              aria-label="Ticket menu"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4",
                "transition-[scale,background-color,color] duration-150 ease-snappy active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100",
                "pointer-hover:bg-muted pointer-hover:text-foreground",
                open && "bg-muted text-foreground",
              )}
            >
              <Ellipsis />
            </button>
          </PopoverPrimitive.Trigger>
        </TooltipTrigger>
        <TooltipContent>Ticket menu</TooltipContent>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={4}
          {...{ [FOCUS_FALLBACK_IGNORE_ATTRIBUTE]: "" }}
          className="kanna-ticket-menu z-50 w-[190px] rounded-[10px] border border-border p-1 text-popover-foreground shadow-[0_10px_30px_rgb(0_0_0/0.16)] outline-none"
        >
          {done ? (
            <button type="button" className={MENU_ITEM_CLASS} onClick={run(() => onSetStatus("open"))}><RotateCcw />Reopen</button>
          ) : (
            <button type="button" className={MENU_ITEM_CLASS} onClick={run(() => onSetStatus("done"))}><CircleCheck />Close</button>
          )}
          <button type="button" className={MENU_ITEM_CLASS} onClick={run(onMarkUnread)}><Mail />Mark as unread</button>
          <button type="button" className={MENU_ITEM_CLASS} onClick={run(onCopyLink)}><Link />Copy link</button>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/**
 * "Reply…" at the foot of the ticket: the delegator chat's own composer,
 * options row and all, since a reply is a message to that chat and starts a
 * turn of it. Its settings (harness, model, mode, effort, fast mode,
 * context window) are that chat's: they are kept by chat id, and this
 * composer is given the delegator's, so a change here is a change there and
 * the other way round. Only the draft is the ticket's own (`ticketDraftKey`).
 *
 * Files upload to the delegator's project as a chat's do. The reply goes on
 * `ticket.reply` with the attachments and the settings, and the server runs
 * the delegator's turn with them, steered in or queued. The composer keeps
 * what was typed if the send fails.
 */
export function TicketComposer({ delegatorChatId, ticketId, projectId, projectPath, provider, availableProviders, onSend, onListSkills, previousPrompt, composerRef }: {
  delegatorChatId: string
  ticketId: string
  projectId: string | null
  projectPath: string | null
  provider: AgentProvider | null
  availableProviders: ProviderCatalogEntry[]
  onSend: (text: string, options: TicketReplyOptions) => Promise<void>
  /** The delegator's skills, for the "/" menu: its harness is the one the reply reaches. */
  onListSkills: (provider: AgentProvider) => Promise<ChatSkillsSnapshot>
  /** The user's last reply on this ticket, for Arrow Up to bring back. */
  previousPrompt: string | null
  /** For files dropped anywhere on the ticket. */
  composerRef?: Ref<ChatInputHandle>
}) {
  return (
    // The options row's own padding is the gap under it, as on the chat's page.
    <div className="shrink-0 border-t border-border pt-2.5">
      <ChatInput
        ref={composerRef}
        chatId={delegatorChatId}
        draftKey={ticketDraftKey(delegatorChatId, ticketId)}
        // Beside the chat's own composer: it does not take focus on mount,
        // and leaves the command palette's Attach Files to the chat.
        secondary
        placeholder="Reply…"
        disabled={!projectId}
        projectId={projectId}
        projectPath={projectPath}
        activeProvider={provider}
        availableProviders={availableProviders}
        onListSkills={onListSkills}
        previousPrompt={previousPrompt}
        onSubmit={(value, options) => onSend(value, {
          attachments: options?.attachments ?? [],
          provider: options?.provider,
          model: options?.model,
          modelOptions: options?.modelOptions,
          planMode: options?.planMode,
          autoPlan: options?.autoPlan,
        })}
      />
    </div>
  )
}
