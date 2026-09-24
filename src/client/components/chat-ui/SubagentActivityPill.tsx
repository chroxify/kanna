import { useEffect, useState } from "react"
import { Loader2, Network } from "lucide-react"
import { cn } from "../../lib/utils"
import type { SubagentActivity } from "../../../shared/types"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"

/**
 * What the chat is still waiting on, next to the composer.
 *
 * The main agent's result lands as soon as *it* stops, so a turn can read as
 * finished while the work it delegated runs on. The pill exists to make that
 * visible: while anything is running it shows the live count, and the chat is
 * not done no matter what the turn status says.
 */

function runningCount(subagents: readonly SubagentActivity[]): number {
  return subagents.reduce((total, agent) => total + (agent.status === "running" ? 1 : 0), 0)
}

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

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const STATUS_LABEL: Record<SubagentActivity["status"], string> = {
  running: "Running",
  completed: "Done",
  failed: "Failed",
}

export function SubagentActivityPill({ subagents }: { subagents: readonly SubagentActivity[] }) {
  const running = runningCount(subagents)
  const now = useNow(running > 0)

  // Nothing delegated this turn — the pill would be a permanently empty
  // control, so it does not render at all.
  if (subagents.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={running > 0 ? `${running} agent${running === 1 ? "" : "s"} running` : "Agents this turn"}
          className={cn(
            // h-6 matches ContextWindowMeter's 24px dial, so the pill and the
            // gauge sit on one line without nudging the composer's rhythm.
            "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors",
            running > 0
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          {running > 0
            ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            : <Network className="h-3 w-3" aria-hidden />}
          <span className="tabular-nums">{running > 0 ? running : subagents.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1.5">
        <p className="px-2 py-1 text-muted-foreground text-xs">
          {running > 0
            ? `Waiting on ${running} of ${subagents.length}`
            : "Nothing running — the turn is done"}
        </p>
        <ul className="max-h-64 overflow-y-auto">
          {subagents.map((agent) => (
            <li key={agent.id} className="flex items-baseline gap-2 rounded px-2 py-1 hover:bg-accent">
              <span className="min-w-0 flex-1 truncate text-sm" title={agent.label}>{agent.label}</span>
              <span
                className={cn(
                  "shrink-0 text-xs",
                  agent.status === "running" ? "text-primary" : agent.status === "failed" ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {STATUS_LABEL[agent.status]}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground text-xs">
                {formatElapsed((agent.endedAt ?? now) - agent.startedAt)}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
