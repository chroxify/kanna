import { useMemo } from "react"
import { Loader2 } from "lucide-react"
import type { SubagentActivity } from "../../../shared/types"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { orderTaskLog } from "./widgets/derive"
import { formatElapsed, useNow } from "./widgets/TasksWidget"

/**
 * What the chat is still waiting on, next to the composer.
 *
 * The main agent's result lands as soon as *it* stops, so a turn can read as
 * finished while the work it delegated runs on. The pill exists to make that
 * visible: while anything is running it shows the live count, and the chat is
 * not done no matter what the turn status says.
 *
 * The task list is a log across turns and the Tasks widget shows all of it,
 * so the pill shows only what is still running and renders nothing otherwise.
 */

export function SubagentActivityPill({ subagents }: { subagents: readonly SubagentActivity[] }) {
  // A workflow's own agents are part of its row, as in the Tasks widget.
  const tasks = useMemo(
    () => orderTaskLog(subagents).filter((task) => task.status === "running"),
    [subagents]
  )
  const running = tasks.length
  const now = useNow(running > 0)

  if (running === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${running} task${running === 1 ? "" : "s"} running`}
          // h-6 matches ContextWindowMeter's 24px dial, so the pill and the
          // gauge sit on one line without nudging the composer's rhythm.
          className="inline-flex h-6 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 text-primary text-xs transition-colors"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          <span className="tabular-nums">{running}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1.5">
        <p className="px-2 py-1 text-muted-foreground text-xs">
          Waiting on {running}
        </p>
        <ul className="max-h-64 overflow-y-auto">
          {tasks.map((agent) => (
            <li key={agent.id} className="flex items-baseline gap-2 rounded px-2 py-1 hover:bg-accent">
              <span className="min-w-0 flex-1 truncate text-sm" title={agent.label}>{agent.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground text-xs">
                {formatElapsed(now - agent.startedAt)}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
