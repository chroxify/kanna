import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { readChatJumpLocationState } from "../../lib/chat-navigation"
import type { TranscriptJumpRequest } from "./transcriptScrollAnchors"

/**
 * Turns a "open this chat at this message" navigation into a one-shot request
 * for the transcript viewport.
 *
 * Two things have to happen and neither is the other's job:
 *
 * - The history entry is stripped as soon as the request is picked up. A jump
 *   is an act, not a place: leaving it on the entry means going back to this
 *   chat later, or reloading, silently re-runs a jump the reader didn't ask for
 *   a second time.
 * - The request outlives that strip, held in component state until the viewport
 *   reports it spent. The rows it names usually aren't mounted on the commit
 *   the navigation lands in — the transcript is still hydrating — so a request
 *   read straight off `location.state` would be gone by the time it could be
 *   honoured.
 *
 * The request is also handed over in the render that brings it, before the
 * state above is set. A chat held in memory mounts with its rows in that same
 * render and is positioned before it is painted. Without the request in hand
 * it opened at the reader's stored position, and moved to the message a frame
 * later when the effect delivered it.
 */
export function useTranscriptJumpRequest(): {
  jumpRequest: TranscriptJumpRequest | null
  onJumpRequestHandled: (requestId: string) => void
} {
  const location = useLocation()
  const navigate = useNavigate()
  const [jumpRequest, setJumpRequest] = useState<TranscriptJumpRequest | null>(null)

  const jump = readChatJumpLocationState(location.state)
  const requestId = jump?.requestId
  const { pathname, search } = location

  // Keyed on the request id alone: the target is a fresh object each render,
  // and one id never names two targets.
  const targetRef = useRef(jump?.target)
  targetRef.current = jump?.target
  // Spent in the render it arrived in, a request must not be held after: it
  // would never be cleared, and would fire again on the chat's next open.
  const handledIdRef = useRef<string | null>(null)
  useEffect(() => {
    const target = targetRef.current
    if (!target || !requestId) return
    if (handledIdRef.current !== requestId) setJumpRequest({ target, requestId })
    navigate(`${pathname}${search}`, { replace: true, state: null })
  }, [navigate, pathname, requestId, search])

  const onJumpRequestHandled = useCallback((handledId: string) => {
    handledIdRef.current = handledId
    setJumpRequest((current) => (current?.requestId === handledId ? null : current))
  }, [])

  const arriving = useMemo<TranscriptJumpRequest | null>(
    () => (requestId && targetRef.current ? { target: targetRef.current, requestId } : null),
    [requestId],
  )

  return { jumpRequest: jumpRequest ?? arriving, onJumpRequestHandled }
}
