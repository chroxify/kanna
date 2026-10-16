import { useLayoutEffect, type RefObject } from "react"

/**
 * Where each remembered scroller was left, by key, for the life of the page.
 * For a list that things are opened from and gone back to, which is a new
 * element each time: a viewer card's body (`scrollMemoryKey`), and the
 * columns of a delegator's expanded board, each of which scrolls itself.
 */
const remembered = new Map<string, { top: number; left: number }>()

type Scroller = { scrollTop: number; scrollLeft: number }

export function saveScroll(key: string, element: Scroller) {
  remembered.set(key, { top: element.scrollTop, left: element.scrollLeft })
}

/** Puts the scroller back where it was left. False when nothing was kept for it. */
export function restoreScroll(key: string, element: Scroller): boolean {
  const position = remembered.get(key)
  if (!position) return false
  element.scrollTop = position.top
  element.scrollLeft = position.left
  return true
}

/**
 * Restores the element's scroll before paint, so it is never seen at its
 * top first, and keeps it as it scrolls. Nothing without a key.
 */
export function useScrollMemory(key: string | undefined, ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!key || !element) return
    restoreScroll(key, element)
    const remember = () => saveScroll(key, element)
    element.addEventListener("scroll", remember, { passive: true })
    return () => element.removeEventListener("scroll", remember)
  }, [key, ref])
}
