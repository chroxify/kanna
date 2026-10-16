import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { DelegatePreference } from "../lib/delegators"

/**
 * What this browser remembers about delegating. Per project, what the new
 * chat page's delegate control was last set to: whether delegating is on
 * there, and which delegator it last sent to (`resolveDelegateTarget` says
 * what that means). Per delegator, whether its list has been shown yet.
 */
interface DelegateState {
  projects: Record<string, DelegatePreference>
  setPreference: (projectId: string, preference: DelegatePreference) => void
  /**
   * The delegators whose page has shown its list in the pane once. The list
   * is there by default the first time a delegator is opened; from then on
   * the pane is as it was left, and this is what tells the two apart.
   */
  paneShown: Record<string, true>
  markPaneShown: (chatId: string) => void
  /**
   * When each delegator's page was last opened here. A click on a project
   * with several opens the one last viewed (`resolveProjectNewChat`). Kept in
   * this browser like the rest: another device goes by its own, or by which
   * is most active.
   */
  viewedAt: Record<string, number>
  markViewed: (chatId: string) => void
}

export const useDelegateStore = create<DelegateState>()(
  persist(
    (set) => ({
      projects: {},
      setPreference: (projectId, preference) => set((state) => {
        const current = state.projects[projectId]
        if (current?.on === preference.on && current?.chatId === preference.chatId) return state
        return { projects: { ...state.projects, [projectId]: preference } }
      }),
      paneShown: {},
      markPaneShown: (chatId) => set((state) => (
        state.paneShown[chatId] ? state : { paneShown: { ...state.paneShown, [chatId]: true } }
      )),
      viewedAt: {},
      markViewed: (chatId) => set((state) => ({ viewedAt: { ...state.viewedAt, [chatId]: Date.now() } })),
    }),
    { name: "delegate-preferences", version: 1 },
  ),
)
