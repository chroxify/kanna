import { useCallback, useEffect, useMemo, useRef } from "react"
import type { ResolvedChatReadAnchor } from "../../shared/types"
import { latchReadAnchor, readRememberedReadAnchor, rememberReadAnchor, sameReadAnchor, type LatchedReadAnchor } from "./chatReadAnchorCache"
import type { KannaSocket } from "./socket"

/**
 * Minimum gap between `chat.setReadAnchor` writes while the user keeps
 * scrolling. Also bounds how long after they stop before the final position
 * lands (the trailing write fires at most this late).
 */
const READ_ANCHOR_WRITE_INTERVAL_MS = 1500

/**
 * Where in the message the reader was, and the column width that makes it
 * meaningful. Restoring uses the offset only at a matching width, since a
 * narrower column rewraps the message and moves everything inside it.
 */
export interface ReadAnchorLayout {
  transcriptWidth: number
  offsetFromMessage: number
}

/**
 * A layout, or a function that measures one. The measurement is a
 * `querySelector` plus three rect reads, so callers on the scroll path hand
 * over the function and only the write that actually goes out pays for it.
 */
export type ReadAnchorLayoutSource = ReadAnchorLayout | (() => ReadAnchorLayout | undefined)

export interface ChatReadAnchorState {
  /**
   * False until it is known where the chat opens: from this browser's copy of
   * the position, or else from the chat's first snapshot. Consumers must wait
   * for this before restoring scroll, otherwise they'd land on the fallback
   * and then visibly jump when the anchor arrives.
   */
  resolved: boolean
  /**
   * Changes at most once after it resolves: when the chat opened from this
   * browser's copy and the server's first word names a different place
   * (another device moved it).
   */
  anchor: ResolvedChatReadAnchor | null
  /**
   * The chat's first snapshot is in: the anchor is the server's, and the
   * transcript is the server's too, not a cached window that may end short
   * of it. A consumer that restored before this checks its position once
   * more when it turns true, and moves if where to land has changed and the
   * reader has not scrolled.
   */
  confirmed: boolean
}

export interface ChatReadAnchorSync {
  anchorState: ChatReadAnchorState
  /**
   * Report the message currently at the top of the viewport. Safe to call on
   * every scroll event — writes are throttled and deduped.
   */
  reportReadAnchor: (messageId: string, atEnd: boolean, layout?: ReadAnchorLayoutSource) => void
}

/**
 * Tracks a chat's server-side read position.
 *
 * The anchor arrives inline on the chat snapshot, already resolved against the
 * window the server chose — opening a chat is one round trip rather than a
 * probe followed by a re-subscription at a wider limit, which fetched the
 * transcript twice.
 *
 * A chat this browser has seen opens from its own copy of the position
 * (`chatReadAnchorCache`), so a transcript painted from the cache is in place
 * before the snapshot lands. The snapshot then confirms it or corrects it.
 *
 * Only the first snapshot per chat is consulted, so a device sitting on an
 * open chat never gets its viewport moved because another device scrolled.
 * Writes are throttled and ack-only.
 */
export function useChatReadAnchor(
  socket: KannaSocket,
  activeChatId: string | null,
  snapshotAnchor: ResolvedChatReadAnchor | null | undefined,
  chatReady: boolean
): ChatReadAnchorSync {
  // Latched per chat: later snapshots carry a moving anchor (it is recomputed
  // as entries append), and adopting those would let a background update
  // retarget a restore that already happened.
  const latchedRef = useRef<LatchedReadAnchor>({ chatId: null, anchor: null, source: "none" })
  // The snapshot's anchor counts only once it is there. `chatReady` alone
  // does not say so: on the render that switches chats it is still true for
  // the chat being left, while the new chat's transcript is already drawn
  // from the cache. Reading that as "no stored position" would open the chat
  // on its fallback.
  const serverAnchor = activeChatId && chatReady ? snapshotAnchor : undefined
  const previousLatch = latchedRef.current
  const latched = latchReadAnchor(
    previousLatch,
    activeChatId,
    serverAnchor,
    activeChatId && previousLatch.chatId !== activeChatId ? readRememberedReadAnchor(activeChatId) : null,
  )
  if (latched !== previousLatch) {
    latchedRef.current = latched
    // The server's first word becomes this browser's copy, unless the copy
    // has moved since the chat opened: the reader scrolled in the moment
    // before the snapshot came, and their position is the newer one.
    //
    // Only for a chat that was waiting on that word. A latch that starts
    // with a snapshot in hand is a chat already open, latched again after
    // React rendered another chat and came back (a push landing mid-switch
    // does that). Its snapshot's anchor is from when it opened, and the copy
    // holds everything the reader has done since.
    if (activeChatId && latched.source === "server" && serverAnchor !== undefined) {
      const local = readRememberedReadAnchor(activeChatId)
      const wasWaiting = previousLatch.chatId === activeChatId
      if (!local || (wasWaiting && sameReadAnchor(local.anchor, previousLatch.anchor))) {
        rememberReadAnchor(activeChatId, serverAnchor)
      }
    }
  }

  const resolved = !activeChatId || latched.source !== "none"
  const confirmed = !activeChatId || latched.source === "server"
  const anchorState = useMemo<ChatReadAnchorState>(
    () => ({ resolved, anchor: latched.anchor, confirmed }),
    [resolved, latched.anchor, confirmed]
  )

  const pendingRef = useRef<{
    chatId: string
    messageId: string
    atEnd: boolean
    layout?: ReadAnchorLayoutSource
  } | null>(null)
  const timerRef = useRef<number | null>(null)
  const lastWriteAtRef = useRef(0)
  const lastWrittenKeyRef = useRef<string | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending) return
    const layout = typeof pending.layout === "function" ? pending.layout() : pending.layout

    // While parked at the bottom the top-visible message churns with every
    // streamed chunk, but restore only needs to know "was at the end" — so all
    // of those collapse to a single write instead of one every interval.
    // Scrolling within one long message changes only the offset, so that has to
    // be part of the key or the position would stick where the message first
    // came into view.
    const key = pending.atEnd
      ? `${pending.chatId}:atEnd`
      : `${pending.chatId}:${pending.messageId}:${layout?.offsetFromMessage ?? ""}`
    if (key === lastWrittenKeyRef.current) return
    lastWrittenKeyRef.current = key
    lastWriteAtRef.current = Date.now()
    // This browser's copy moves with every write, so coming back to the chat
    // opens where it was left without waiting on the server.
    rememberReadAnchor(pending.chatId, { messageId: pending.messageId, atEnd: pending.atEnd, ...(layout ?? {}) })

    void socket.command({
      type: "chat.setReadAnchor",
      chatId: pending.chatId,
      messageId: pending.messageId,
      atEnd: pending.atEnd,
      ...(layout ?? {}),
    }).catch(() => {
      // Every pending command rejects with "Disconnected" on socket close even
      // though the envelope may still be delivered. Never surface this.
    })
  }, [socket])

  const reportReadAnchor = useCallback((messageId: string, atEnd: boolean, layout?: ReadAnchorLayoutSource) => {
    if (!activeChatId) return
    pendingRef.current = { chatId: activeChatId, messageId, atEnd, layout }
    // A measured position, not a function to measure one later, is the
    // transcript's last sample as it is taken down. Kept here at once: the
    // write goes out when effects run, after the transcript cache has already
    // been cut to the position on record.
    if (typeof layout !== "function") {
      rememberReadAnchor(activeChatId, { messageId, atEnd, ...(layout ?? {}) })
    }
    // Already scheduled — the newer position just replaces the pending one.
    if (timerRef.current !== null) return
    const delay = Math.max(0, READ_ANCHOR_WRITE_INTERVAL_MS - (Date.now() - lastWriteAtRef.current))
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      flush()
    }, delay)
  }, [activeChatId, flush])

  // Write anything still queued for the outgoing chat, and reset the dedupe key
  // so the new chat's first sample always writes.
  //
  // Leaving used to discard the pending sample instead. Writes are throttled to
  // `READ_ANCHOR_WRITE_INTERVAL_MS`, so the position a reader stops at is
  // almost always still pending when they navigate away — which is exactly the
  // position worth keeping. Dropping it meant returning to wherever they
  // happened to be a second and a half earlier, or to a much older sample if
  // they never paused that long. The pending entry carries its own `chatId`, so
  // flushing here writes it against the chat it was sampled from.
  useEffect(() => {
    return () => {
      flush()
      lastWrittenKeyRef.current = null
    }
  }, [activeChatId, flush])

  // Backgrounding a tab is the common way a session ends. `visibilitychange`
  // fires reliably here, unlike pagehide/beforeunload where the socket may
  // already be closing and the envelope would sit in an undrained queue.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flush()
      // A resumed subscription must learn whether this tab still follows the tail.
      else lastWrittenKeyRef.current = null
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [flush])

  return useMemo(
    () => ({ anchorState, reportReadAnchor }),
    [anchorState, reportReadAnchor]
  )
}
