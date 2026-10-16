import { beforeEach, describe, expect, test } from "bun:test"
import { useChatInputStore } from "./chatInputStore"

describe("chatInputStore", () => {
  beforeEach(() => {
    useChatInputStore.setState({
      drafts: {},
      draftStartedAt: {},
      draftTouchedAt: {},
      attachmentDrafts: {},
      startedChats: {},
    })
  })

  test("a draft is last touched when its text or its attachments last changed, and not once both are gone", () => {
    const store = useChatInputStore.getState()
    const attachment = { id: "a", kind: "file", displayName: "a.txt" } as never
    store.setDraft("chat-1", "typed")
    expect(useChatInputStore.getState().draftTouchedAt["chat-1"]).toBeGreaterThan(0)

    store.setAttachmentDrafts("chat-1", [attachment])
    store.setDraft("chat-1", "")
    // The attachment is still staged, so there is still a draft.
    expect(useChatInputStore.getState().draftTouchedAt["chat-1"]).toBeGreaterThan(0)
    store.setAttachmentDrafts("chat-1", [])
    expect(useChatInputStore.getState().draftTouchedAt["chat-1"]).toBeUndefined()
  })

  test("moving a draft takes all of it to the other chat and leaves nothing behind", () => {
    const store = useChatInputStore.getState()
    const attachment = { id: "a", kind: "file", displayName: "a.txt" } as never
    store.setDraft("gone", "written before lunch")
    store.setAttachmentDrafts("gone", [attachment])
    const before = useChatInputStore.getState()

    store.moveDraft("gone", "fresh")

    const after = useChatInputStore.getState()
    expect(after.drafts).toEqual({ fresh: "written before lunch" })
    expect(after.attachmentDrafts).toEqual({ fresh: [attachment] })
    expect(after.draftStartedAt).toEqual({ fresh: before.draftStartedAt.gone! })
    expect(after.draftTouchedAt).toEqual({ fresh: before.draftTouchedAt.gone! })
  })

  test("a started chat is remembered while it has a draft or is young enough to get one", () => {
    const day = 24 * 60 * 60 * 1000
    useChatInputStore.setState({
      drafts: { "old-with-draft": "kept" },
      startedChats: {
        "old-with-draft": { projectId: "p", at: Date.now() - 3 * day },
        "old-empty": { projectId: "p", at: Date.now() - 3 * day },
        "young-empty": { projectId: "p", at: Date.now() - 1000 },
      },
    })

    useChatInputStore.getState().rememberStartedChat("new", "q")

    const { startedChats } = useChatInputStore.getState()
    expect(Object.keys(startedChats).sort()).toEqual(["new", "old-with-draft", "young-empty"])
    expect(startedChats.new?.projectId).toBe("q")

    useChatInputStore.getState().forgetStartedChat("new")
    expect(useChatInputStore.getState().startedChats.new).toBeUndefined()
  })

  test("stamps a draft when it appears, and leaves it alone as you keep typing", () => {
    // The sidebar sorts Relevant by this, so it has to hold still mid-sentence
    // — a row that climbs a place per keystroke is unreadable to type beside.
    const store = useChatInputStore.getState()
    store.setDraft("chat-1", "h")
    const startedAt = useChatInputStore.getState().draftStartedAt["chat-1"]

    expect(startedAt).toBeGreaterThan(0)
    store.setDraft("chat-1", "half a thought")
    expect(useChatInputStore.getState().draftStartedAt["chat-1"]).toBe(startedAt)
  })

  test("a draft cleared and started again is a new draft", () => {
    const store = useChatInputStore.getState()
    store.setDraft("chat-1", "first")
    const firstStartedAt = useChatInputStore.getState().draftStartedAt["chat-1"]

    store.clearDraft("chat-1")
    expect(useChatInputStore.getState().draftStartedAt["chat-1"]).toBeUndefined()

    store.setDraft("chat-1", "second")
    expect(useChatInputStore.getState().draftStartedAt["chat-1"]).toBeGreaterThanOrEqual(firstStartedAt)
  })

  test("emptying a draft drops its stamp too", () => {
    const store = useChatInputStore.getState()
    store.setDraft("chat-1", "typed")
    store.setDraft("chat-1", "")

    expect(useChatInputStore.getState().drafts["chat-1"]).toBeUndefined()
    expect(useChatInputStore.getState().draftStartedAt["chat-1"]).toBeUndefined()
  })

  test("stores attachment drafts per chat", () => {
    useChatInputStore.getState().setAttachmentDrafts("chat-1", [{
      id: "attachment-1",
      kind: "image",
      displayName: "mock.png",
      absolutePath: "/tmp/project/.kanna/uploads/mock.png",
      relativePath: "./.kanna/uploads/mock.png",
      contentUrl: "/api/projects/project-1/uploads/mock.png/content",
      mimeType: "image/png",
      size: 512,
    }])

    expect(useChatInputStore.getState().getAttachmentDrafts("chat-1")).toHaveLength(1)
    expect(useChatInputStore.getState().getAttachmentDrafts("chat-2")).toEqual([])
  })

  test("clears attachment drafts for a chat", () => {
    useChatInputStore.getState().setAttachmentDrafts("chat-1", [{
      id: "attachment-1",
      kind: "file",
      displayName: "spec.pdf",
      absolutePath: "/tmp/project/.kanna/uploads/spec.pdf",
      relativePath: "./.kanna/uploads/spec.pdf",
      contentUrl: "/api/projects/project-1/uploads/spec.pdf/content",
      mimeType: "application/pdf",
      size: 1234,
    }])

    useChatInputStore.getState().clearAttachmentDrafts("chat-1")
    expect(useChatInputStore.getState().getAttachmentDrafts("chat-1")).toEqual([])
  })
})
