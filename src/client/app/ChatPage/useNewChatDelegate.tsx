import { useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import type { AgentProvider, ChatAttachment, ModelOptions } from "../../../shared/types"
import { DelegateControl, type ComposerDelegate } from "../../components/chat-ui/DelegateControl"
import type { useAppDialog } from "../../components/ui/app-dialog"
import { projectDelegators, resolveDelegateTarget } from "../../lib/delegators"
import { getProjectSidebarLabel } from "../../lib/project-label"
import { flattenSidebarThreads } from "../../lib/thread-sections"
import { useDelegateStore } from "../../stores/delegateStore"
import { clearSending, markSending } from "../../stores/pendingSendStore"
import { findSidebarChat, useSidebarStore } from "../../stores/sidebarStore"
import { isProcessingStatus } from "../derived"
import type { KannaSocket } from "../socket"

/** What a send carries from the composer; see `ChatInput`'s `buildSubmitOptions`. */
export interface DelegatedSendOptions {
  provider?: AgentProvider
  model?: string
  modelOptions?: ModelOptions
  planMode?: boolean
  autoPlan?: boolean
  attachments?: ChatAttachment[]
}

/**
 * Delegating from the new chat page: which of the project's delegators a
 * message typed there goes to (`resolveDelegateTarget`), the control that
 * shows and changes it, and the send.
 *
 * While delegating, the page is still the new chat page, and the chat it is
 * on stays empty: the message goes to the delegator, and the app follows it
 * there. Nothing of the page's chat is used but its project.
 */
export function useNewChatDelegate({ enabled, projectId, socket, dialog }: {
  /** The page is a new chat's: empty, and not the graph's. */
  enabled: boolean
  projectId: string | null
  socket: KannaSocket
  dialog: ReturnType<typeof useAppDialog>
}): {
  delegate: ComposerDelegate | undefined
  /** Sends to the delegator and opens it. Rejects if the send does, so the composer keeps the text. */
  sendToDelegator: (chatId: string, content: string, options?: DelegatedSendOptions) => Promise<void>
} {
  const navigate = useNavigate()
  // The group, which keeps its identity across pushes that did not touch it.
  const group = useSidebarStore((state) => (
    enabled && projectId ? state.data.projectGroups.find((item) => item.groupKey === projectId) ?? null : null
  ))
  const delegators = useMemo(
    () => (group ? projectDelegators(flattenSidebarThreads({ projectGroups: [group] }), group.groupKey) : []),
    [group],
  )
  const preference = useDelegateStore((store) => (projectId ? store.projects[projectId] : undefined))
  const target = useMemo(() => resolveDelegateTarget(delegators, preference), [delegators, preference])
  const projectName = group ? getProjectSidebarLabel(group).name : "this project"

  const handlePick = useCallback((chatId: string | null) => {
    if (!projectId) return
    const store = useDelegateStore.getState()
    // Turning it off keeps which one was last used, for turning it back on.
    store.setPreference(projectId, chatId ? { on: true, chatId } : { on: false, chatId: store.projects[projectId]?.chatId })
  }, [projectId])

  const handleCreate = useCallback(async () => {
    if (!projectId) return
    // A delegator is kept and come back to, so it is named for what it looks
    // after, here, before it exists. Left blank it is "New Chat" until its
    // first message names it, as any chat is.
    const name = await dialog.prompt({
      title: "New Delegator",
      description: "A chat that hands work to the chats under it instead of doing it. Name it for what it looks after.",
      placeholder: "Name (optional)",
      allowEmpty: true,
      confirmLabel: "Create",
    })
    if (name === null) return
    try {
      const { chatId } = await socket.command<{ chatId: string }>({ type: "chat.create", projectId, delegator: true })
      if (name) await socket.command({ type: "chat.rename", chatId, title: name })
      useDelegateStore.getState().setPreference(projectId, { on: true, chatId })
    } catch (error) {
      await dialog.alert({
        title: "Could not create the delegator",
        description: error instanceof Error ? error.message : String(error),
        closeLabel: "OK",
      })
    }
  }, [dialog, projectId, socket])

  const targetChatId = target?.chatId ?? null
  const targetTitle = target?.title ?? ""
  const targetProvider = target?.row.provider ?? null
  const delegate = useMemo<ComposerDelegate | undefined>(() => (enabled && projectId ? {
    control: (
      <DelegateControl
        delegators={delegators}
        target={target}
        projectName={projectName}
        onPick={handlePick}
        onCreate={() => { void handleCreate() }}
      />
    ),
    target: targetChatId ? { chatId: targetChatId, title: targetTitle, provider: targetProvider } : null,
    // `target` is covered by the three fields read off it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  } : undefined), [delegators, enabled, handleCreate, handlePick, projectId, projectName, targetChatId, targetProvider, targetTitle])

  const sendToDelegator = useCallback(async (chatId: string, content: string, options?: DelegatedSendOptions) => {
    const message = {
      chatId,
      content,
      attachments: options?.attachments ?? [],
      provider: options?.provider,
      model: options?.model,
      modelOptions: options?.modelOptions,
      planMode: options?.planMode,
      autoPlan: options?.autoPlan,
    }
    try {
      // A delegator in the middle of a turn takes the message as its own
      // composer would give it: queued, for when the turn ends.
      if (isProcessingStatus(findSidebarChat(chatId)?.status)) {
        await socket.command({ type: "message.enqueue", ...message })
      } else {
        // Holds the delegator's place in the sidebar until the server says
        // it is running; see `usePendingSendStore`.
        markSending(chatId, Date.now())
        await socket.command({ type: "chat.send", ...message })
      }
    } catch (error) {
      clearSending(chatId)
      // The page has nowhere of its own to say so: its error line is the
      // transcript's, and this message was never in this chat's.
      void dialog.alert({
        title: "Could not send to the delegator",
        description: error instanceof Error ? error.message : String(error),
        closeLabel: "OK",
      })
      throw error
    }
    if (projectId) useDelegateStore.getState().setPreference(projectId, { on: true, chatId })
    navigate(`/chat/${chatId}`)
  }, [dialog, navigate, projectId, socket])

  return { delegate, sendToDelegator }
}
