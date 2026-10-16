import type { KannaSocket } from "../../app/socket"
import { useDelegateStore } from "../../stores/delegateStore"
import type { useAppDialog } from "../ui/app-dialog"

/**
 * Makes a delegator in a project: asks for its name, creates it empty, and
 * picks it as what the project's new chat page delegates to.
 *
 * One function for the two places that offer it. The delegate control's
 * "New Delegator…" is there only once a project has a delegator, so the
 * command palette's entry is how a project gets its first, and the two must
 * not drift apart.
 *
 * Resolves to the new chat's id, or null if the prompt was dismissed or the
 * create failed (which it says in a dialog of its own).
 */
export async function createDelegator({ projectId, socket, dialog }: {
  projectId: string
  socket: KannaSocket
  dialog: ReturnType<typeof useAppDialog>
}): Promise<string | null> {
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
  if (name === null) return null
  try {
    const { chatId } = await socket.command<{ chatId: string }>({ type: "chat.create", projectId, delegator: true })
    if (name) await socket.command({ type: "chat.rename", chatId, title: name })
    useDelegateStore.getState().setPreference(projectId, { on: true, chatId })
    return chatId
  } catch (error) {
    await dialog.alert({
      title: "Could not create the delegator",
      description: error instanceof Error ? error.message : String(error),
      closeLabel: "OK",
    })
    return null
  }
}
