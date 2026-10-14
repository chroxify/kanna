import type { ResolvedChatReadAnchor } from "../../shared/types"

/**
 * This browser's copy of each chat's read position.
 *
 * The server holds the position and sends it with a chat's first snapshot.
 * The transcript is cached here and paints before that snapshot lands, so a
 * chat painted from the cache had no position to open at: it drew at its end
 * and jumped when the server answered. With the position kept beside the
 * cached transcript, the first frame is already in place.
 *
 * It is a copy. Another device may have moved the position since, so the
 * server's word still wins when it comes (`latchReadAnchor`).
 *
 * In localStorage, not the transcript cache's IndexedDB: the read has to
 * answer while the chat renders, and an entry is about a hundred bytes.
 */

const STORAGE_KEY = "kanna:chat-read-anchors:v1"

/** Least recently used go first. Past this a chat opens as if never seen here. */
const MAX_REMEMBERED_CHATS = 500

/**
 * A write is the whole map. It is put off so that the one made as a chat is
 * left does not land between the click and the next chat's first frame.
 */
const WRITE_DELAY_MS = 250

/** `anchor: null` is a chat known to have no stored position, which is not the same as not knowing. */
export interface RememberedReadAnchor {
  anchor: ResolvedChatReadAnchor | null
}

let remembered: Map<string, RememberedReadAnchor> | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null
let listeningForOtherTabs = false

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    // A browser that blocks storage throws on the access itself.
    return null
  }
}

function isAnchor(value: unknown): value is ResolvedChatReadAnchor {
  if (!value || typeof value !== "object") return false
  const anchor = value as Record<string, unknown>
  return typeof anchor.messageId === "string" && typeof anchor.atEnd === "boolean"
}

function load(): Map<string, RememberedReadAnchor> {
  if (remembered) return remembered
  const next = new Map<string, RememberedReadAnchor>()
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    const pairs: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(pairs)) {
      for (const pair of pairs) {
        if (!Array.isArray(pair) || typeof pair[0] !== "string") continue
        if (pair[1] === null || isAnchor(pair[1])) next.set(pair[0], { anchor: pair[1] })
      }
    }
  } catch {
    // Unreadable is the same as empty: the server still has every position.
  }
  remembered = next
  // Another tab writes the whole map too. Reading its copy again keeps this
  // tab from writing back positions that tab has since moved.
  if (!listeningForOtherTabs && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    listeningForOtherTabs = true
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) remembered = null
    })
    // The last position before the tab closes is the one a reload opens at.
    window.addEventListener("pagehide", flushReadAnchorWrites)
  }
  return next
}

/** Write what is pending now. */
export function flushReadAnchorWrites() {
  if (writeTimer === null) return
  clearTimeout(writeTimer)
  writeTimer = null
  if (!remembered) return
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify([...remembered].map(([chatId, entry]) => [chatId, entry.anchor])))
  } catch {
    // Over quota or blocked. Memory still serves this session.
  }
}

function scheduleWrite() {
  if (writeTimer !== null) return
  writeTimer = setTimeout(flushReadAnchorWrites, WRITE_DELAY_MS)
}

/** Null when this browser has no record of the chat. */
export function readRememberedReadAnchor(chatId: string): RememberedReadAnchor | null {
  return load().get(chatId) ?? null
}

export function rememberReadAnchor(chatId: string, anchor: ResolvedChatReadAnchor | null) {
  const map = load()
  map.delete(chatId)
  map.set(chatId, { anchor })
  while (map.size > MAX_REMEMBERED_CHATS) map.delete(map.keys().next().value!)
  scheduleWrite()
}

export function forgetReadAnchor(chatId: string) {
  if (load().delete(chatId)) scheduleWrite()
}

/**
 * Whether two anchors put the reader in the same place.
 *
 * Two at the end are the same whatever message each names: while the reader
 * follows the end the message at the top changes with every chunk, and only
 * the first of those is ever written (`useChatReadAnchor`'s dedupe key).
 */
export function sameReadAnchor(left: ResolvedChatReadAnchor | null, right: ResolvedChatReadAnchor | null): boolean {
  if (!left || !right) return left === right
  if (left.atEnd || right.atEnd) return left.atEnd === right.atEnd
  return left.messageId === right.messageId
    && left.offsetFromMessage === right.offsetFromMessage
    && left.transcriptWidth === right.transcriptWidth
}

/** Where a chat's anchor came from: nowhere yet, this browser's copy, or the server. */
export type ReadAnchorSource = "none" | "remembered" | "server"

export interface LatchedReadAnchor {
  chatId: string | null
  anchor: ResolvedChatReadAnchor | null
  source: ReadAnchorSource
}

/**
 * The anchor a chat opens at, given what is known this render.
 *
 * A chat opens from this browser's copy when it has one, so the first frame
 * is in place. The server's first word then settles it, once: equal to the
 * copy, the latch keeps the object it has and nothing moves; different,
 * another device moved the position and the latch changes to say so. After
 * that it never changes for the chat. Later snapshots carry whatever the
 * anchor is by then, and adopting those would let another device scrolling
 * move a reader who is sitting on the chat.
 *
 * `serverAnchor` is undefined until the chat's own snapshot is in hand.
 */
export function latchReadAnchor(
  current: LatchedReadAnchor,
  chatId: string | null,
  serverAnchor: ResolvedChatReadAnchor | null | undefined,
  remembered: RememberedReadAnchor | null,
): LatchedReadAnchor {
  if (current.chatId !== chatId) {
    if (serverAnchor !== undefined) return { chatId, anchor: serverAnchor, source: "server" }
    if (remembered) return { chatId, anchor: remembered.anchor, source: "remembered" }
    return { chatId, anchor: null, source: "none" }
  }
  if (current.source === "server" || serverAnchor === undefined) return current
  if (current.source === "remembered" && sameReadAnchor(current.anchor, serverAnchor)) {
    return { ...current, source: "server" }
  }
  return { chatId, anchor: serverAnchor, source: "server" }
}

/** For tests: drop the in-memory copy so the next read loads from storage. */
export function resetReadAnchorCacheForTests() {
  if (writeTimer !== null) clearTimeout(writeTimer)
  writeTimer = null
  remembered = null
}
