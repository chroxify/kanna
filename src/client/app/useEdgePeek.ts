import { useEffect, useState, type RefObject } from "react"

/** How far past the panel's inner edge the mouse may stray before the panel leaves. */
const PEEK_SLOP_PX = 24

/**
 * How long the mouse has to rest at the edge before the panel comes. A mouse
 * on its way somewhere else (the send button in the corner, a scrollbar, the
 * dock) crosses the edge strip in a frame or two; one that means to peek
 * stops there. Long enough to tell the two apart, short enough not to feel
 * like waiting.
 */
export const PEEK_DWELL_MS = 220

/**
 * Faster than this (px/ms) and the mouse is still travelling, so the dwell
 * starts over. 0.5 px/ms is half a pixel a millisecond: a hand that is
 * slowing to a stop, not one sweeping past.
 */
export const PEEK_SETTLE_SPEED = 0.5

/**
 * Leaving the window through the edge faster than this is a flick to another
 * window or screen, not a reach for the panel.
 */
const PEEK_LEAVE_SPEED = 1.5

/** How long the mouse may be off the panel before it leaves: an overshoot or a wobble comes back in time. */
export const PEEK_HIDE_DELAY_MS = 280

/** A gap between two moves longer than this is a pause: the mouse was at rest, whatever the distance. */
const PAUSE_MS = 100

/**
 * A menu, select or dialog that is up. They portal out of the panel, so the
 * pointer is over one of these while it is no longer over the panel.
 */
export const OPEN_LAYER_SELECTOR = "[role='menu'][data-state='open'], [role='listbox'][data-state='open'], [role='dialog'][data-state='open'], [role='alertdialog'][data-state='open']"

interface EdgePeekOptions {
  side: "left" | "right"
  /** The panel is closed, so there is something to peek at. */
  enabled: boolean
  /** The panel as it is laid out: its width and its vertical extent are read from it. */
  panelRef: RefObject<HTMLElement | null>
  /** How close to the window's edge the mouse opens the peek. */
  edgePx: number
  /** The gap between the window's edge and the panel once it is shown. */
  insetPx?: number
}

interface PointerSample {
  x: number
  y: number
  t: number
}

/**
 * The mouse's speed between two samples, in px/ms. A pause between them reads
 * as rest: the mouse that sat still and then twitched has not been sweeping.
 */
export function pointerSpeed(previous: PointerSample | null, next: PointerSample) {
  if (!previous) return 0
  const dt = next.t - previous.t
  if (dt <= 0) return 0
  if (dt > PAUSE_MS) return 0
  return Math.hypot(next.x - previous.x, next.y - previous.y) / dt
}

/**
 * The peek: a closed side panel comes back as an overlay while the mouse
 * rests at its edge of the window, and leaves once the mouse has been off it
 * for a moment. Nothing is opened: this only says when to show the panel
 * over the chat.
 *
 * It reads intent, not position. The mouse has to settle in the edge strip
 * (PEEK_DWELL_MS below PEEK_SETTLE_SPEED) before the panel comes, so one
 * passing through on its way to a corner does not open it; and it has to be
 * off the panel for PEEK_HIDE_DELAY_MS before it goes, so an overshoot does
 * not slam it shut.
 *
 * Listened for on the document rather than on a strip along the edge. A
 * strip would take the clicks that land on it, and a fast mouse crosses a few
 * pixels between two events; the move that leaves the window by that side is
 * caught instead, which is also what makes the edge easy to hit when the
 * window is not against the screen's.
 */
export function useEdgePeek({ side, enabled, panelRef, edgePx, insetPx = 0 }: EdgePeekOptions) {
  const [requested, setRequested] = useState(false)
  if (!enabled && requested) setRequested(false)

  useEffect(() => {
    if (!enabled) return
    let open = false
    let last: PointerSample | null = null
    let showTimer: ReturnType<typeof setTimeout> | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null

    function clearShow() {
      if (showTimer !== null) clearTimeout(showTimer)
      showTimer = null
    }

    function clearHide() {
      if (hideTimer !== null) clearTimeout(hideTimer)
      hideTimer = null
    }

    function startShow() {
      clearShow()
      showTimer = setTimeout(() => {
        showTimer = null
        if (!document.hasFocus()) return
        open = true
        setRequested(true)
      }, PEEK_DWELL_MS)
    }

    function startHide() {
      if (hideTimer !== null) return
      hideTimer = setTimeout(() => {
        hideTimer = null
        // Something the panel opened may have come up in the meantime.
        if (document.querySelector(OPEN_LAYER_SELECTOR)) return
        open = false
        setRequested(false)
      }, PEEK_HIDE_DELAY_MS)
    }

    function hideNow() {
      clearShow()
      clearHide()
      open = false
      setRequested(false)
    }

    // The peek belongs to the window you are working in. Once another app
    // (or another window) is in front, a panel left hanging over the chat is
    // in the way of reading what is behind it, and a mouse crossing this
    // window's edge on its way somewhere else is not asking for it. So it
    // leaves when the window loses focus, whatever was going on in it, and
    // stays away until the window has focus again.
    function handleWindowBlur() {
      hideNow()
    }

    // The blur event is not the whole story: a window can stop being the one
    // in front without the page being told (focus was in another part of the
    // app's window, or already gone when the peek came up). So while the
    // peek is up, the question is also asked outright, a few times a second.
    const focusWatch = window.setInterval(() => {
      if ((open || showTimer !== null) && !document.hasFocus()) hideNow()
    }, 200)

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") hideNow()
    }

    // The distance from the panel's side of the window, so both sides read alike.
    function fromEdge(event: MouseEvent) {
      return side === "left" ? event.clientX : window.innerWidth - event.clientX
    }

    // The panel may not run the window's whole height (the terminal sits
    // under the right one): its edge is only the part it stands beside.
    function besidePanel(event: MouseEvent, slopPx: number) {
      const rect = panelRef.current?.getBoundingClientRect()
      return Boolean(rect) && event.clientY >= rect!.top - slopPx && event.clientY <= rect!.bottom + slopPx
    }

    // Whether something the panel started is still going on: a drag (resize,
    // reorder), a menu or dialog opened from a row, a rename being typed.
    // Closing under any of them would take away what the user is using.
    function isBusy(event: MouseEvent) {
      if (event.buttons !== 0) return true
      if (document.querySelector(OPEN_LAYER_SELECTOR)) return true
      const focused = document.activeElement
      return focused instanceof HTMLElement
        && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA")
        && Boolean(panelRef.current?.contains(focused))
    }

    // Where the panel rests, not where it is: a mouse that outruns the panel
    // on its way in is still headed for it.
    function overPanel(event: MouseEvent) {
      const panel = panelRef.current
      if (!panel) return false
      return fromEdge(event) <= insetPx + panel.offsetWidth + PEEK_SLOP_PX
        && besidePanel(event, PEEK_SLOP_PX)
    }

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType !== "mouse") return
      const sample = { x: event.clientX, y: event.clientY, t: event.timeStamp }
      const speed = pointerSpeed(last, sample)
      last = sample

      if (open) {
        if (overPanel(event) || isBusy(event)) clearHide()
        else startHide()
        return
      }

      const atEdge = fromEdge(event) <= edgePx && besidePanel(event, 0) && event.buttons === 0 && document.hasFocus()
      if (!atEdge) {
        clearShow()
        return
      }
      // Still travelling: the dwell counts from when it slows down.
      if (showTimer === null || speed > PEEK_SETTLE_SPEED) startShow()
    }

    function handleMouseLeave(event: MouseEvent) {
      const sample = { x: event.clientX, y: event.clientY, t: event.timeStamp }
      const speed = pointerSpeed(last, sample)
      last = null
      const byPanelEdge = fromEdge(event) <= 0 && besidePanel(event, 0)
      if (open) {
        // Out past the panel's own edge is still on the panel's side.
        if (byPanelEdge || isBusy(event)) clearHide()
        else startHide()
        return
      }
      if (byPanelEdge && event.buttons === 0 && document.hasFocus() && speed <= PEEK_LEAVE_SPEED) {
        if (showTimer === null) startShow()
      } else {
        clearShow()
      }
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("blur", handleWindowBlur)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    document.documentElement.addEventListener("mouseleave", handleMouseLeave)
    return () => {
      clearShow()
      clearHide()
      window.clearInterval(focusWatch)
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("blur", handleWindowBlur)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      document.documentElement.removeEventListener("mouseleave", handleMouseLeave)
    }
  }, [edgePx, enabled, insetPx, panelRef, side])

  return enabled && requested
}
