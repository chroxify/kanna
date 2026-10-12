import { Loader2, X } from "lucide-react"
import type { WaitingOn } from "../../../shared/types"
import { waitingOnLabel } from "../../lib/waiting-on"
import { MetaRow, MetaContent } from "./shared"
import { AnimatedShinyText } from "../ui/animated-shiny-text"

const STATUS_LABELS: Record<string, string> = {
  connecting: "Connecting...",
  acquiring_sandbox: "Booting...",
  initializing: "Initializing...",
  starting: "Starting...",
  running: "Running...",
  waiting_for_user: "Waiting...",
  failed: "Failed",
}

interface ProcessingMessageProps {
  status?: string
  /** With `waiting_on_subagent`: how many of what, for the line to say. */
  waitingOn?: WaitingOn
}

export function ProcessingMessage({ status, waitingOn }: ProcessingMessageProps) {
  // Waiting on a subagent is a line of words and no more. Nothing is
  // happening in this chat for a spinner to stand for, and the shimmer on the
  // words already says the wait is live. With no mark before it the line
  // starts where the messages above it do.
  if (status === "waiting_on_subagent") {
    return (
      <MetaRow className="mt-3">
        <MetaContent>
          <AnimatedShinyText className="!mx-0 text-sm" shimmerWidth={44}>
            {waitingOnLabel(waitingOn)}
          </AnimatedShinyText>
        </MetaContent>
      </MetaRow>
    )
  }

  const label = (status ? STATUS_LABELS[status] : undefined) || "Processing..."
  const isFailed = status === "failed"

  return (
    <MetaRow className="ml-[1px] mt-3">
      <MetaContent>
        {isFailed ? (
          <X className="size-4.5 text-red-500" />
        ) : (
          <Loader2 className="size-4.5 animate-spin text-muted-icon" />
        )}
        <AnimatedShinyText className="ml-[1px] text-sm" shimmerWidth={44}>
          {label}
        </AnimatedShinyText>
      </MetaContent>
    </MetaRow>
  )
}
