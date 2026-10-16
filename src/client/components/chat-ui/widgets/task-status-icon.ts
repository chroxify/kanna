import { Check, Loader2, Square, X, type LucideIcon } from "lucide-react"
import type { SubagentActivity } from "../../../../shared/types"

/**
 * The mark for how a task stands, by status: the Tasks widget's rows, a
 * workflow's outcome, and a read Done ticket's check (`TicketMark`).
 *
 * A leaf, importing nothing of the app's. The Tasks widget pulls in the
 * transcript's tool rows, which draw ticket cards, which draw this check:
 * kept in the widget, the map was read by a ticket's mark before the
 * widget's module had run, and the app crashed on load.
 */
export interface StatusIcon {
  Icon: LucideIcon
  className: string
  label: string
}

export const TASK_STATUS_ICON: Record<SubagentActivity["status"], StatusIcon> = {
  // Grey: work in progress is the normal state here, not something to flag.
  running: { Icon: Loader2, className: "animate-spin text-muted-foreground", label: "Running" },
  completed: { Icon: Check, className: "text-success", label: "Done" },
  failed: { Icon: X, className: "text-destructive", label: "Failed" },
  // Someone chose to end it: not an outcome to flag in red or green.
  stopped: { Icon: Square, className: "text-muted-foreground", label: "Stopped" },
}
