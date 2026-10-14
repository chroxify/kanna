import { createContext, useContext } from "react"

/**
 * What a chat's right-click menu can do that needs nothing but the chat's id
 * and the socket. Given once, at the app's layout, and read by the menu
 * itself (`ThreadRowMenu`), so an item added here is in that menu everywhere
 * a chat is shown (the sidebars, a tab, a card in a transcript, a Tasks row,
 * a node of the graph) without a handler threaded to each of them.
 *
 * Absent where there is no socket (the standalone export, the demo): the
 * items it would back are left out.
 */
export interface ChatMenuCommands {
  /** Makes the chat a delegator, or an ordinary chat again. Takes effect on its next turn. */
  setDelegator: (chatId: string, delegator: boolean) => void
  /** Marks the chat done, which takes it out of Relevant, or not done. Its next turn clears it. */
  setDone: (chatId: string, done: boolean) => void
}

const ChatMenuCommandsContext = createContext<ChatMenuCommands | null>(null)

export const ChatMenuCommandsProvider = ChatMenuCommandsContext.Provider

export function useChatMenuCommands(): ChatMenuCommands | null {
  return useContext(ChatMenuCommandsContext)
}
