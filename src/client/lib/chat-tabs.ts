/**
 * Chat tabs: which chats are open in the navbar, in what
 * order. React-free for tests; `chatTabsStore` holds and persists the result.
 */

/** An object rather than a bare id, so a tab can carry more than its chat later without a new stored format. */
export interface ChatTab {
  chatId: string
}

/** More than anyone reads across; the oldest tabs fall off the front past it. */
export const MAX_CHAT_TABS = 40

/**
 * A chat was opened. One already in the bar is left where it is. A new one
 * goes right of the chat it was opened from (`afterChatId`), as a browser's
 * does, or at the end.
 */
export function openChatTab(tabs: readonly ChatTab[], chatId: string, afterChatId?: string | null): ChatTab[] {
  if (tabs.some((tab) => tab.chatId === chatId)) return tabs as ChatTab[]
  const opened: ChatTab = { chatId }
  const afterIndex = afterChatId ? tabs.findIndex((tab) => tab.chatId === afterChatId) : -1
  const next = afterIndex === -1
    ? [...tabs, opened]
    : [...tabs.slice(0, afterIndex + 1), opened, ...tabs.slice(afterIndex + 1)]
  return next.length > MAX_CHAT_TABS ? next.slice(next.length - MAX_CHAT_TABS) : next
}

export function closeChatTab(tabs: readonly ChatTab[], chatId: string): ChatTab[] {
  return tabs.filter((tab) => tab.chatId !== chatId)
}

/** Every tab but this one. */
export function closeOtherChatTabs(tabs: readonly ChatTab[], chatId: string): ChatTab[] {
  const kept = tabs.filter((tab) => tab.chatId === chatId)
  return kept.length === tabs.length || kept.length === 0 ? (tabs as ChatTab[]) : kept
}

/** The tabs after this one in the bar. */
export function closeChatTabsToRight(tabs: readonly ChatTab[], chatId: string): ChatTab[] {
  const index = tabs.findIndex((tab) => tab.chatId === chatId)
  return index === -1 || index === tabs.length - 1 ? (tabs as ChatTab[]) : tabs.slice(0, index + 1)
}

/**
 * The tab that takes over when one closes: the one to its right, or to its
 * left for the last tab. Null when it was the only one.
 */
export function getChatTabAfterClose(tabs: readonly ChatTab[], chatId: string): string | null {
  const index = tabs.findIndex((tab) => tab.chatId === chatId)
  if (index === -1) return null
  return (tabs[index + 1] ?? tabs[index - 1])?.chatId ?? null
}

/** The next or previous tab, wrapping at the ends. Null with fewer than two. */
export function getAdjacentChatTab(tabs: readonly ChatTab[], chatId: string | null, direction: 1 | -1): string | null {
  if (tabs.length < 2) return null
  const index = tabs.findIndex((tab) => tab.chatId === chatId)
  if (index === -1) return tabs[0]!.chatId
  return tabs[(index + direction + tabs.length) % tabs.length]!.chatId
}

/** The tabs in a new order. Unchanged if the order doesn't name them all. */
export function reorderChatTabs(tabs: readonly ChatTab[], orderedChatIds: readonly string[]): ChatTab[] {
  const byId = new Map(tabs.map((tab) => [tab.chatId, tab]))
  const ordered = orderedChatIds.flatMap((chatId) => {
    const tab = byId.get(chatId)
    return tab ? [tab] : []
  })
  return ordered.length === tabs.length ? ordered : (tabs as ChatTab[])
}

/** These tabs, whichever are in the bar. Same array back when none are. */
export function closeChatTabs(tabs: readonly ChatTab[], chatIds: readonly string[]): ChatTab[] {
  const closing = new Set(chatIds)
  const kept = tabs.filter((tab) => !closing.has(tab.chatId))
  return kept.length === tabs.length ? (tabs as ChatTab[]) : kept
}

/**
 * A run of tabs in the bar: a project's tabs, gathered together, or a lone
 * tab whose project isn't known yet (`projectId` null: a chat just created,
 * before the sidebar reports it).
 */
export interface ChatTabGroup {
  projectId: string | null
  tabs: ChatTab[]
}

/**
 * The bar's tabs grouped by project. A group sits where its project's first
 * tab does, and holds every tab of that project in their order, so a tab
 * opened beside one of another project still lands in its own group.
 */
export function groupChatTabs(tabs: readonly ChatTab[], projectOf: (chatId: string) => string | undefined): ChatTabGroup[] {
  const groups: ChatTabGroup[] = []
  const byProject = new Map<string, ChatTabGroup>()
  for (const tab of tabs) {
    const projectId = projectOf(tab.chatId)
    if (projectId === undefined) {
      groups.push({ projectId: null, tabs: [tab] })
      continue
    }
    const existing = byProject.get(projectId)
    if (existing) {
      existing.tabs.push(tab)
      continue
    }
    const group: ChatTabGroup = { projectId, tabs: [tab] }
    byProject.set(projectId, group)
    groups.push(group)
  }
  return groups
}

/** Drops tabs for chats that are gone. Same array back when none are. */
export function pruneChatTabs(tabs: readonly ChatTab[], keep: (chatId: string) => boolean): ChatTab[] {
  const kept = tabs.filter((tab) => keep(tab.chatId))
  return kept.length === tabs.length ? (tabs as ChatTab[]) : kept
}
