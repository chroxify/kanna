import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Loader2, Network, X } from "lucide-react"
import type { SubagentActivity, TranscriptEntry } from "../../../../shared/types"
import { cn } from "../../../lib/utils"
import { formatPromptTimestamp } from "../../messages/ResultMessage"
import { formatToolCallTitle } from "../../messages/ToolCallMessage"
import { useToolPayload } from "../../messages/tool-payload-context"
import { TURN_CARD_ROW_INSET, TurnCardMetaRow, TurnCardMetaSeparator } from "../../ui/turn-card"
import { deriveSubagentDetails, type SubagentDetails } from "./derive"
import { WidgetList, WidgetRow } from "./parts"
import { SwapIn, WidgetCard } from "./WidgetCard"
import { WidgetHoverCard } from "./WidgetHoverCard"

/**
 * Work the agent delegated this turn: subagents, background shells, monitors.
 *
 * The main agent's result lands as soon as *it* stops, so a turn can read as
 * finished while the work it kicked off runs on. This widget makes that
 * visible: while anything is running the chat is not done, whatever the turn
 * status says.
 */

/** Elapsed time, re-rendered on a 1s tick only while something is running. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** "3 of 5 running" while some run, "3 running" while all do, then the total. */
export function formatAgentsCount(subagents: readonly SubagentActivity[]): string {
  const running = subagents.filter((agent) => agent.status === "running").length
  if (running === 0) return String(subagents.length)
  return running === subagents.length ? `${running} running` : `${running} of ${subagents.length} running`
}

const STATUS_ICON: Record<SubagentActivity["status"], { Icon: typeof Check; className: string; label: string }> = {
  // The same red spinner a running chat shows in the sidebar.
  running: { Icon: Loader2, className: "animate-spin text-logo", label: "Running" },
  completed: { Icon: Check, className: "text-success", label: "Done" },
  failed: { Icon: X, className: "text-destructive", label: "Failed" },
}

/** "1 tool call", "12 messages". */
function countLabel(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`
}

/**
 * A subagent's card: what it was asked (the prompt, clamped), what it has
 * done (calls and messages so far, and its latest step), and when it started
 * and for how long it has run.
 */
export function AgentHoverCardContent({
  agent,
  details,
  prompt,
  now,
  canJump,
}: {
  agent: SubagentActivity
  details: SubagentDetails
  /** The full prompt, once fetched when the transcript left it in the sidecar. */
  prompt?: string
  now: number
  canJump: boolean
}) {
  const running = agent.status === "running"
  const latest = details.latestTool ? formatToolCallTitle(details.latestTool) : null
  return (
    <>
      <TurnCardMetaRow>
        <span className="truncate">{details.subagentType ?? agent.label}</span>
        <TurnCardMetaSeparator />
        <span className="shrink-0">{STATUS_ICON[agent.status].label}</span>
        <span className="ml-auto shrink-0 pl-2 tabular-nums">
          {formatPromptTimestamp(new Date(agent.startedAt).toISOString())} · {formatElapsed((agent.endedAt ?? now) - agent.startedAt)}
        </span>
      </TurnCardMetaRow>
      {/* The task in full, which the row cuts to one line. */}
      {details.description ? (
        <div className={cn("mt-1 line-clamp-3 text-sm font-medium text-popover-foreground", TURN_CARD_ROW_INSET)}>{details.description}</div>
      ) : null}
      {/* What it was told: the start of the prompt, as much as a card holds. */}
      {prompt ? (
        <div className={cn("mt-0.5 line-clamp-[8] whitespace-pre-wrap text-sm text-muted-foreground", TURN_CARD_ROW_INSET)}>{prompt.trim()}</div>
      ) : null}
      <div className="-mx-1.5 mt-2 border-t border-border/60" aria-hidden />
      <TurnCardMetaRow className="mt-1.5">
        <span>{countLabel(details.toolCalls, "tool call")}</span>
        <TurnCardMetaSeparator />
        <span>{countLabel(details.messages, "message")}</span>
      </TurnCardMetaRow>
      {latest ? (
        <div className={cn("truncate text-[12px] text-muted-foreground", TURN_CARD_ROW_INSET)}>
          <span className="text-muted-foreground/70">{running ? "Now" : "Last"}</span> {latest}
        </div>
      ) : running ? (
        <div className={cn("text-[12px] text-muted-foreground/70", TURN_CARD_ROW_INSET)}>No steps yet</div>
      ) : null}
      {canJump ? (
        <TurnCardMetaRow className="mt-1">
          <span>Click to show in chat</span>
        </TurnCardMetaRow>
      ) : null}
    </>
  )
}

/** Fetches the prompt when the transcript holds only the spawn call's header. */
function AgentHoverCardBody(props: Omit<Parameters<typeof AgentHoverCardContent>[0], "prompt">) {
  const { spawn } = props.details
  const full = useToolPayload(!props.details.prompt && spawn.trimmed ? spawn._id : undefined)
  const fetched = full?.kind === "tool_call" && full.tool.toolKind === "subagent_task" ? full.tool.input.prompt : undefined
  return <AgentHoverCardContent {...props} prompt={props.details.prompt ?? fetched} />
}

export function AgentsWidget({
  subagents,
  toolIds,
  entries,
  onJumpToToolCall,
}: {
  subagents: readonly SubagentActivity[]
  /** Subagent id → the tool call that spawned it, for the ones found in the loaded transcript. */
  toolIds: ReadonlyMap<string, string>
  /** The loaded transcript: each agent's task, prompt and steps so far. */
  entries: readonly TranscriptEntry[]
  onJumpToToolCall: (toolId: string) => void
}) {
  const now = useNow(subagents.some((agent) => agent.status === "running"))
  const details = useMemo(() => deriveSubagentDetails(entries, toolIds), [entries, toolIds])
  const listRef = useRef<HTMLDivElement | null>(null)
  return (
    <WidgetCard
      // Static: the rows already spin for what is running, and a spinning
      // header too read as the main agent being busy.
      icon={<Network />}
      title="Agents"
      count={formatAgentsCount(subagents)}
    >
      <WidgetList listRef={listRef}>
        {subagents.map((agent) => {
          const { Icon, className, label } = STATUS_ICON[agent.status]
          const toolId = toolIds.get(agent.id)
          const agentDetails = details.get(agent.id)
          // The task the caller named ("Audit durable.ts turn engine"), not
          // the agent's type: six "general-purpose" rows say nothing apart.
          const title = agentDetails?.description ?? agent.label
          return (
            <WidgetRow
              key={agent.id}
              rowKey={agent.id}
              icon={(
                <SwapIn swapKey={agent.status}>
                  <Icon role="img" className={className} aria-label={label} />
                </SwapIn>
              )}
              title={title}
              meta={formatElapsed((agent.endedAt ?? now) - agent.startedAt)}
              // Opens the chat at the call that spawned it: a list of labels
              // with timers otherwise leaves "where is that?" open.
              onActivate={toolId ? () => onJumpToToolCall(toolId) : undefined}
              // The card says it all once there is one; a native tooltip on
              // top would be a second popover.
              tooltip={agentDetails ? undefined : toolId ? `${title}: show in chat` : title}
            />
          )
        })}
      </WidgetList>
      <WidgetHoverCard containerRef={listRef}>
        {(agentId) => {
          const agent = subagents.find((candidate) => candidate.id === agentId)
          const agentDetails = details.get(agentId)
          if (!agent || !agentDetails) return null
          return <AgentHoverCardBody agent={agent} details={agentDetails} now={now} canJump={toolIds.has(agentId)} />
        }}
      </WidgetHoverCard>
    </WidgetCard>
  )
}
