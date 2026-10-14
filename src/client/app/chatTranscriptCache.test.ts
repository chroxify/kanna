import { expect, test } from "bun:test"
import {
  canPaintCachedWindow,
  createTranscriptCacheWriter,
  deleteCachedWindow,
  peekPaintableMemoryWindow,
  readMemoryCachedWindow,
  trimCachedWindow,
} from "./chatTranscriptCache"
import { rememberReadAnchor } from "./chatReadAnchorCache"
import type { TranscriptEntry } from "../../shared/types"

test("a chat switch makes a bounded memory window available before disk writes", async () => {
  const id = crypto.randomUUID()
  try {
    const writer = createTranscriptCacheWriter()
    const messages: TranscriptEntry[] = Array.from({ length: 200 }, (_, i) => ({ _id: `${i}`, kind: "assistant_text", createdAt: i, text: "test" }))
    writer.schedule(id, { messages, startIndex: 100 }, true)
    writer.flush()
    const window = readMemoryCachedWindow(id)
    expect(window?.entries).toHaveLength(50)
    expect(window?.startIndex).toBe(250)
    expect(window?.entries.at(-1)?._id).toBe("199")
  } finally { await deleteCachedWindow(id) }
})

test("memory follows a streaming chat on every change, before anything settles", async () => {
  const id = crypto.randomUUID()
  try {
    const writer = createTranscriptCacheWriter()
    const first: TranscriptEntry[] = [{ _id: "0", kind: "assistant_text", createdAt: 0, text: "a" }]
    writer.schedule(id, { messages: first, startIndex: 0 }, true)
    expect(readMemoryCachedWindow(id)?.entries).toBe(first)

    const second = [...first, { _id: "1", kind: "assistant_text", createdAt: 1, text: "b" } as TranscriptEntry]
    writer.schedule(id, { messages: second, startIndex: 0 }, true)
    // The live array itself, not a copy: nothing is encoded mid-stream.
    expect(readMemoryCachedWindow(id)?.entries).toBe(second)
  } finally { await deleteCachedWindow(id) }
})

const texts = (count: number): TranscriptEntry[] => (
  Array.from({ length: count }, (_, i) => ({ _id: `${i}`, kind: "assistant_text", createdAt: i, text: "test" }))
)

test("a cached window is drawn before the server answers only when it holds where the chat opens", async () => {
  const id = crypto.randomUUID()
  try {
    const writer = createTranscriptCacheWriter()
    writer.schedule(id, { messages: texts(200), startIndex: 0 }, true)
    const window = () => trimCachedWindow(readMemoryCachedWindow(id)!, 50)

    // Never seen here: where it opens is the server's to say.
    expect(canPaintCachedWindow(window())).toBe(false)
    expect(peekPaintableMemoryWindow(id, 50)).toBeNull()

    // Known to have no position, or to be at the end: any window holds that.
    rememberReadAnchor(id, null)
    expect(canPaintCachedWindow(window())).toBe(true)
    rememberReadAnchor(id, { messageId: "3", atEnd: true })
    expect(canPaintCachedWindow(window())).toBe(true)

    // A message in the window, and one the transcript no longer has.
    rememberReadAnchor(id, { messageId: "180", atEnd: false })
    expect(peekPaintableMemoryWindow(id, 50)?.entries).toHaveLength(50)
    rememberReadAnchor(id, { messageId: "gone", atEnd: false })
    expect(peekPaintableMemoryWindow(id, 50)).toBeNull()
  } finally { await deleteCachedWindow(id) }
})

test("the cut reaches back to where the reader was, in memory and when a chat is put away", async () => {
  const id = crypto.randomUUID()
  try {
    const writer = createTranscriptCacheWriter()
    rememberReadAnchor(id, { messageId: "120", atEnd: false })
    writer.schedule(id, { messages: texts(200), startIndex: 100 }, true)

    const open = peekPaintableMemoryWindow(id, 50)
    expect(open?.entries[0]?._id).toBe("120")
    expect(open?.startIndex).toBe(220)
    // Asked again, the same object: an open asks while rendering and again
    // when it subscribes, and must not get two arrays to render.
    expect(trimCachedWindow(readMemoryCachedWindow(id)!, 50)).toBe(open!)

    writer.flush()
    expect(readMemoryCachedWindow(id)?.entries[0]?._id).toBe("120")

    // Back at the end, the next cut is the plain one.
    rememberReadAnchor(id, { messageId: "199", atEnd: true })
    expect(peekPaintableMemoryWindow(id, 50)?.entries).toHaveLength(50)
  } finally { await deleteCachedWindow(id) }
})

test("deleting a chat's cache forgets where it was read to", async () => {
  const id = crypto.randomUUID()
  const writer = createTranscriptCacheWriter()
  rememberReadAnchor(id, null)
  writer.schedule(id, { messages: texts(3), startIndex: 0 }, true)
  expect(peekPaintableMemoryWindow(id, 50)).not.toBeNull()
  await deleteCachedWindow(id)
  writer.schedule(id, { messages: texts(3), startIndex: 0 }, true)
  expect(peekPaintableMemoryWindow(id, 50)).toBeNull()
  await deleteCachedWindow(id)
})
