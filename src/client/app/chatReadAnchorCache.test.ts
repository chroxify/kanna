import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { ResolvedChatReadAnchor } from "../../shared/types"
import {
  flushReadAnchorWrites,
  forgetReadAnchor,
  latchReadAnchor,
  readRememberedReadAnchor,
  rememberReadAnchor,
  resetReadAnchorCacheForTests,
  sameReadAnchor,
  type LatchedReadAnchor,
} from "./chatReadAnchorCache"

const at = (messageId: string, offsetFromMessage?: number): ResolvedChatReadAnchor => ({
  messageId,
  atEnd: false,
  ...(offsetFromMessage === undefined ? {} : { offsetFromMessage, transcriptWidth: 800 }),
})
const atEnd = (messageId: string): ResolvedChatReadAnchor => ({ messageId, atEnd: true })

describe("this browser's copy of a chat's read position", () => {
  const original = globalThis.localStorage
  let stored: Map<string, string>

  beforeEach(() => {
    stored = new Map()
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
    } })
    resetReadAnchorCacheForTests()
  })
  afterEach(() => {
    resetReadAnchorCacheForTests()
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original })
  })

  test("a chat never seen is unknown, which is not the same as having no position", () => {
    expect(readRememberedReadAnchor("a")).toBeNull()
    rememberReadAnchor("a", null)
    expect(readRememberedReadAnchor("a")).toEqual({ anchor: null })
  })

  test("a position is there for the next read at once, and after a reload", () => {
    rememberReadAnchor("a", at("m1", 120))
    expect(readRememberedReadAnchor("a")?.anchor).toEqual(at("m1", 120))
    flushReadAnchorWrites()
    resetReadAnchorCacheForTests()
    expect(readRememberedReadAnchor("a")?.anchor).toEqual(at("m1", 120))
  })

  test("a deleted chat is forgotten", () => {
    rememberReadAnchor("a", at("m1"))
    forgetReadAnchor("a")
    expect(readRememberedReadAnchor("a")).toBeNull()
  })

  test("the least recently written chats go first", () => {
    for (let index = 0; index < 501; index += 1) rememberReadAnchor(`chat-${index}`, null)
    expect(readRememberedReadAnchor("chat-0")).toBeNull()
    expect(readRememberedReadAnchor("chat-1")).not.toBeNull()
    expect(readRememberedReadAnchor("chat-500")).not.toBeNull()
  })

  test("storage that holds something else reads as empty", () => {
    stored.set("kanna:chat-read-anchors:v1", "{not json")
    expect(readRememberedReadAnchor("a")).toBeNull()
    resetReadAnchorCacheForTests()
    stored.set("kanna:chat-read-anchors:v1", JSON.stringify([["a", { messageId: 4 }], ["b", at("m2")], "c"]))
    expect(readRememberedReadAnchor("a")).toBeNull()
    expect(readRememberedReadAnchor("b")?.anchor).toEqual(at("m2"))
  })
})

describe("sameReadAnchor", () => {
  test("the same message at the same depth and width", () => {
    expect(sameReadAnchor(at("m1", 40), at("m1", 40))).toBe(true)
    expect(sameReadAnchor(at("m1", 40), at("m1", 41))).toBe(false)
    expect(sameReadAnchor(at("m1", 40), at("m2", 40))).toBe(false)
    expect(sameReadAnchor(at("m1", 40), { ...at("m1", 40), transcriptWidth: 640 })).toBe(false)
    expect(sameReadAnchor(at("m1"), at("m1", 40))).toBe(false)
  })

  test("two at the end are the same, whatever message each names", () => {
    expect(sameReadAnchor(atEnd("m1"), atEnd("m9"))).toBe(true)
    expect(sameReadAnchor(atEnd("m1"), at("m1"))).toBe(false)
  })

  test("none is only the same as none", () => {
    expect(sameReadAnchor(null, null)).toBe(true)
    expect(sameReadAnchor(null, at("m1"))).toBe(false)
  })
})

describe("latchReadAnchor", () => {
  const closed: LatchedReadAnchor = { chatId: null, anchor: null, source: "none" }

  test("a chat this browser has seen opens from its copy, before the server answers", () => {
    const copy = at("m1", 200)
    const latched = latchReadAnchor(closed, "a", undefined, { anchor: copy })
    expect(latched).toEqual({ chatId: "a", anchor: copy, source: "remembered" })
  })

  test("a chat known to have no position opens resolved, on none", () => {
    expect(latchReadAnchor(closed, "a", undefined, { anchor: null })).toEqual({ chatId: "a", anchor: null, source: "remembered" })
  })

  test("a chat this browser has not seen waits for the server", () => {
    const waiting = latchReadAnchor(closed, "a", undefined, null)
    expect(waiting.source).toBe("none")
    // Nothing new, nothing changes: the same object, so nothing re-renders.
    expect(latchReadAnchor(waiting, "a", undefined, null)).toBe(waiting)
    expect(latchReadAnchor(waiting, "a", at("m3"), null)).toEqual({ chatId: "a", anchor: at("m3"), source: "server" })
  })

  test("the server agreeing keeps the very anchor the chat opened at", () => {
    const copy = at("m1", 200)
    const opened = latchReadAnchor(closed, "a", undefined, { anchor: copy })
    const confirmed = latchReadAnchor(opened, "a", at("m1", 200), null)
    expect(confirmed.source).toBe("server")
    expect(confirmed.anchor).toBe(copy)
  })

  test("the server naming another place replaces it: another device moved the position", () => {
    const opened = latchReadAnchor(closed, "a", undefined, { anchor: at("m1", 200) })
    expect(latchReadAnchor(opened, "a", at("m7"), null).anchor).toEqual(at("m7"))
    expect(latchReadAnchor(opened, "a", null, null)).toEqual({ chatId: "a", anchor: null, source: "server" })
  })

  test("after the server's first word the anchor does not move again", () => {
    const settled = latchReadAnchor(latchReadAnchor(closed, "a", undefined, null), "a", at("m3"), null)
    // A later snapshot carrying another device's scrolling.
    expect(latchReadAnchor(settled, "a", at("m9"), null)).toBe(settled)
    expect(latchReadAnchor(settled, "a", null, null)).toBe(settled)
  })

  test("switching chats starts over, and the server's anchor wins if it is already in hand", () => {
    const onA = latchReadAnchor(closed, "a", at("m1"), null)
    expect(latchReadAnchor(onA, "b", undefined, { anchor: at("b1") })).toEqual({ chatId: "b", anchor: at("b1"), source: "remembered" })
    expect(latchReadAnchor(onA, "b", at("b2"), { anchor: at("b1") })).toEqual({ chatId: "b", anchor: at("b2"), source: "server" })
    expect(latchReadAnchor(onA, null, undefined, null)).toEqual({ chatId: null, anchor: null, source: "none" })
  })
})
