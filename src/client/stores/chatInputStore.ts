import { useMemo } from "react"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { useShallow } from "zustand/react/shallow"
import type { ChatAttachment } from "../../shared/types"

/**
 * `localStorage.setItem` is synchronous, and the persisted blob is every draft
 * in every chat. Writing it on each keystroke put a JSON.stringify plus a disk
 * write on the typing path. Writes now settle for a moment first, and flush on
 * `pagehide` so a closing tab keeps its last characters.
 */
const DRAFT_PERSIST_DELAY_MS = 300

function createDebouncedStorage(delayMs: number): Storage {
  const pending = new Map<string, string>()
  let timer: number | null = null

  const flush = () => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    for (const [key, value] of pending) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // Quota or private mode: the draft stays in memory for this session.
      }
    }
    pending.clear()
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush)
  }

  return {
    get length() {
      return window.localStorage.length
    },
    key: (index) => window.localStorage.key(index),
    clear: () => {
      pending.clear()
      window.localStorage.clear()
    },
    getItem: (key) => pending.get(key) ?? window.localStorage.getItem(key),
    removeItem: (key) => {
      pending.delete(key)
      window.localStorage.removeItem(key)
    },
    setItem: (key, value) => {
      pending.set(key, value)
      if (timer === null) {
        timer = window.setTimeout(flush, delayMs)
      }
    },
  }
}

let debouncedLocalStorage: Storage | null = null

/** Throws where there is no `localStorage` (tests); `persist` then runs in memory. */
function getDebouncedLocalStorage(): Storage {
  if (typeof window === "undefined" || !("localStorage" in window)) {
    throw new Error("localStorage unavailable")
  }
  debouncedLocalStorage ??= createDebouncedStorage(DRAFT_PERSIST_DELAY_MS)
  return debouncedLocalStorage
}

interface ChatInputState {
  drafts: Record<string, string>
  /**
   * When each draft *appeared* — the moment the composer went from empty to
   * holding something, not the last keystroke. That's what the sidebar sorts
   * by, so a chat keeps the place it took when you started writing rather than
   * climbing a row at a time as you type. Persisted alongside the text so the
   * order survives a reload; absent for drafts written before this existed,
   * which fall back to chat activity.
   */
  draftStartedAt: Record<string, number>
  /**
   * When each draft was last changed, text or attachments. Unlike
   * `draftStartedAt` it moves with every keystroke, so nothing that draws a
   * list reads it: it only picks between two drafts (`resolveProjectNewChat`).
   */
  draftTouchedAt: Record<string, number>
  attachmentDrafts: Record<string, ChatAttachment[]>
  /**
   * The chats this browser started as new chats, and the project each is in.
   * A new chat that is never sent from is deleted by the server once nothing
   * is connected to speak for its draft, and the draft is then under an id no
   * list shows. This is what still says which project it was being written
   * in, so that a click on the project can bring it back.
   */
  startedChats: Record<string, StartedChat>
  setDraft: (chatId: string, value: string) => void
  clearDraft: (chatId: string) => void
  getDraft: (chatId: string) => string
  setAttachmentDrafts: (chatId: string, attachments: ChatAttachment[]) => void
  clearAttachmentDrafts: (chatId: string) => void
  getAttachmentDrafts: (chatId: string) => ChatAttachment[]
  /** Everything one chat's draft is (text, attachments, its times), under another chat's id. */
  moveDraft: (fromChatId: string, toChatId: string) => void
  rememberStartedChat: (chatId: string, projectId: string) => void
  forgetStartedChat: (chatId: string) => void
}

export interface StartedChat {
  projectId: string
  at: number
}

/** A started chat with nothing written in it is remembered this long, for a draft still to come. */
const STARTED_CHAT_MEMORY_MS = 24 * 60 * 60 * 1000

function without<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  if (!(key in record)) return record
  const { [key]: _, ...rest } = record
  return rest
}

export const useChatInputStore = create<ChatInputState>()(
  persist(
    (set, get) => ({
      drafts: {},
      draftStartedAt: {},
      draftTouchedAt: {},
      attachmentDrafts: {},
      startedChats: {},

      setDraft: (chatId, value) =>
        set((state) => {
          if (!value) {
            const { [chatId]: _, ...rest } = state.drafts
            const { [chatId]: __, ...restStartedAt } = state.draftStartedAt
            return {
              drafts: rest,
              draftStartedAt: restStartedAt,
              // Staged attachments are still a draft, last touched when they were.
              draftTouchedAt: state.attachmentDrafts[chatId] ? state.draftTouchedAt : without(state.draftTouchedAt, chatId),
            }
          }
          // Stamped on the clean → dirty flip only. Every later keystroke
          // leaves it alone, so the object identity holds still while you type
          // and the sidebar doesn't re-sort under the cursor.
          const startedAt = state.draftStartedAt[chatId]
          return {
            drafts: { ...state.drafts, [chatId]: value },
            draftStartedAt: startedAt == null
              ? { ...state.draftStartedAt, [chatId]: Date.now() }
              : state.draftStartedAt,
            draftTouchedAt: { ...state.draftTouchedAt, [chatId]: Date.now() },
          }
        }),

      clearDraft: (chatId) =>
        set((state) => {
          const { [chatId]: _, ...rest } = state.drafts
          const { [chatId]: __, ...restStartedAt } = state.draftStartedAt
          return {
            drafts: rest,
            draftStartedAt: restStartedAt,
            draftTouchedAt: state.attachmentDrafts[chatId] ? state.draftTouchedAt : without(state.draftTouchedAt, chatId),
          }
        }),

      getDraft: (chatId) => get().drafts[chatId] ?? "",

      setAttachmentDrafts: (chatId, attachments) =>
        set((state) => {
          if (attachments.length === 0) {
            const { [chatId]: _, ...rest } = state.attachmentDrafts
            return {
              attachmentDrafts: rest,
              draftTouchedAt: state.drafts[chatId] ? state.draftTouchedAt : without(state.draftTouchedAt, chatId),
            }
          }
          return {
            attachmentDrafts: {
              ...state.attachmentDrafts,
              [chatId]: attachments,
            },
            draftTouchedAt: { ...state.draftTouchedAt, [chatId]: Date.now() },
          }
        }),

      clearAttachmentDrafts: (chatId) =>
        set((state) => {
          const { [chatId]: _, ...rest } = state.attachmentDrafts
          return {
            attachmentDrafts: rest,
            draftTouchedAt: state.drafts[chatId] ? state.draftTouchedAt : without(state.draftTouchedAt, chatId),
          }
        }),

      getAttachmentDrafts: (chatId) => get().attachmentDrafts[chatId] ?? [],

      moveDraft: (fromChatId, toChatId) =>
        set((state) => {
          if (fromChatId === toChatId) return state
          const move = <TValue,>(record: Record<string, TValue>) => {
            const value = record[fromChatId]
            const rest = without(record, fromChatId)
            return value === undefined ? rest : { ...rest, [toChatId]: value }
          }
          return {
            drafts: move(state.drafts),
            draftStartedAt: move(state.draftStartedAt),
            draftTouchedAt: move(state.draftTouchedAt),
            attachmentDrafts: move(state.attachmentDrafts),
          }
        }),

      rememberStartedChat: (chatId, projectId) =>
        set((state) => {
          const now = Date.now()
          // Housekeeping rides along: a chat with no draft has nothing to be
          // found by, once it is too old to be getting one.
          const kept = Object.entries(state.startedChats).filter(([id, started]) => (
            Boolean(state.drafts[id]) || Boolean(state.attachmentDrafts[id]) || now - started.at < STARTED_CHAT_MEMORY_MS
          ))
          return { startedChats: { ...Object.fromEntries(kept), [chatId]: { projectId, at: now } } }
        }),

      forgetStartedChat: (chatId) =>
        set((state) => (chatId in state.startedChats ? { startedChats: without(state.startedChats, chatId) } : state)),
    }),
    {
      name: "chat-input-drafts",
      storage: createJSONStorage(getDebouncedLocalStorage),
    }
  )
)

/**
 * One chat's unsent draft, trimmed, `""` when it has none — whitespace alone is
 * not something to advertise.
 *
 * Subscribes to that chat's string alone, so a row re-renders only while *its*
 * draft is being typed rather than on every keystroke anywhere. Drafts live in
 * the browser, never on the server, so anything reading this is per-device.
 *
 * Read this as close to the thing that displays the text as possible, and pass
 * the value into the presentational piece rather than reading it there. Two
 * reasons, and they pull the same way: those pieces stay renderable (and
 * testable) without a live store, which under zustand v5 they would not be —
 * its server snapshot is the *initial* state, so a store read inside one
 * silently renders as empty — and a subscription in an always-mounted component
 * re-renders it on every keystroke. A sidebar row wants `useChatHasDraft`; only
 * the open hover card wants the text.
 */
export function useChatDraft(chatId: string): string {
  return useChatInputStore((state) => (state.drafts[chatId] ?? "").trim())
}

/**
 * Whether a chat holds an unsent draft, without subscribing to its text.
 *
 * The text changes on every keystroke; whether there *is* text changes twice per
 * draft. Surfaces that only show a pencil icon or enable a "Clear Draft" item
 * want the second question — asking the first re-rendered a sidebar row (and its
 * menu and hover card) on every character typed into the composer.
 */
export function useChatHasDraft(chatId: string): boolean {
  return useChatInputStore((state) => (state.drafts[chatId] ?? "").trim().length > 0)
}

/**
 * Every chat holding an unsent draft, mapped to when that draft appeared.
 * Drives the sidebar's Relevant section: membership keeps those chats out of
 * the date buckets, and the value is what they sort by.
 *
 * `0` means "draft with no known start time" — written before the timestamp
 * existed. Callers fall back to the chat's own activity there rather than
 * sinking it to the bottom of the list.
 *
 * Compared shallowly, and the underlying stamps only move on the clean → dirty
 * flip, so the identity changes when a chat gains or loses a draft and at no
 * other time — never mid-sentence, which would re-sort the list you are
 * looking at.
 */
export function useDraftStartTimes(): ReadonlyMap<string, number> {
  const startTimes = useChatInputStore(
    useShallow((state) => {
      const times: Record<string, number> = {}
      for (const [chatId, draft] of Object.entries(state.drafts)) {
        if (!draft.trim()) continue
        times[chatId] = state.draftStartedAt[chatId] ?? 0
      }
      return times
    })
  )
  return useMemo(() => new Map(Object.entries(startTimes)), [startTimes])
}
