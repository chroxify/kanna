import type { SidebarChatRow, SidebarData, SidebarProjectGroup } from "../../shared/types"

const BROWSER_CHAT_TITLE_MAX_LENGTH = 80

function getSidebarGroupChats(group: SidebarProjectGroup): SidebarChatRow[] {
  return [...group.chats, ...(group.archivedChats ?? [])]
}

export function getNotificationTitleCount(sidebarData: SidebarData) {
  return sidebarData.projectGroups.reduce((count, group) => (
    count + group.chats.reduce((chatCount, chat) => (
      chatCount + (chat.unread ? 1 : 0) + (chat.status === "waiting_for_user" ? 1 : 0)
    ), 0)
  ), 0)
}

export function getBrowserWindowTitle(args: {
  appName: string
  sidebarData: SidebarData
  activeProjectId: string | null
  activeChatId: string | null
}) {
  const notificationCount = getNotificationTitleCount(args.sidebarData)
  const baseTitle = notificationCount > 0 ? `[${notificationCount}] ${args.appName}` : args.appName
  const projectGroupById = args.activeProjectId
    ? args.sidebarData.projectGroups.find((group) => group.groupKey === args.activeProjectId)
    : undefined
  const projectGroupByChat = args.activeChatId
    ? args.sidebarData.projectGroups.find((group) => (
        getSidebarGroupChats(group).some((chat) => chat.chatId === args.activeChatId)
      ))
    : undefined
  const projectGroup = projectGroupById ?? projectGroupByChat
  const projectTitle = projectGroup?.title?.trim()
  if (!projectGroup || !projectTitle) return baseTitle

  const chatTitle = args.activeChatId
    ? getSidebarGroupChats(projectGroup).find((chat) => chat.chatId === args.activeChatId)?.title.trim()
    : null
  if (!chatTitle) return `${baseTitle} : ${projectTitle} :`

  const browserChatTitle = chatTitle.length > BROWSER_CHAT_TITLE_MAX_LENGTH
    ? `${chatTitle.slice(0, BROWSER_CHAT_TITLE_MAX_LENGTH)}...`
    : chatTitle
  return `${baseTitle} : ${projectTitle} : ${browserChatTitle}`
}

interface ChatNotificationSnapshot {
  unreadCount: number
  waitingChatIds: Set<string>
}

/**
 * What the active chat is doing, for hosts that show it outside the page —
 * Floaty reads it from `<meta name="floaty:status">` and draws a dot on the
 * tab. Deliberately coarser than KannaStatus: a tab needs "is it working, does
 * it need me, is it finished", not the state machine.
 *
 * - working: the agent is running
 * - waiting: it stopped to ask you something
 * - done:    it finished and you haven't looked yet
 * - failed:  the turn errored
 * - idle:    nothing to say
 */
export type BrowserPageStatus = "idle" | "working" | "waiting" | "done" | "failed"

export function getBrowserPageStatus(args: {
  sidebarData: SidebarData
  activeChatId: string | null
}): { status: BrowserPageStatus; badge: number } {
  const badge = getNotificationTitleCount(args.sidebarData)
  if (!args.activeChatId) return { status: "idle", badge }

  let chat: SidebarChatRow | undefined
  for (const group of args.sidebarData.projectGroups) {
    chat = getSidebarGroupChats(group).find((row) => row.chatId === args.activeChatId)
    if (chat) break
  }
  if (!chat) return { status: "idle", badge }

  switch (chat.status) {
    case "starting":
    case "running":
      return { status: "working", badge }
    case "waiting_for_user":
      return { status: "waiting", badge }
    case "failed":
      return { status: "failed", badge }
    case "idle":
      return { status: chat.unread ? "done" : "idle", badge }
  }
}

export function getChatNotificationSnapshot(sidebarData: SidebarData): ChatNotificationSnapshot {
  let unreadCount = 0
  const waitingChatIds = new Set<string>()

  for (const group of sidebarData.projectGroups) {
    for (const chat of group.chats) {
      if (chat.unread) unreadCount += 1
      if (chat.status === "waiting_for_user") {
        waitingChatIds.add(chat.chatId)
      }
    }
  }

  return { unreadCount, waitingChatIds }
}

export function getChatSoundBurstCount(previous: SidebarData | null, next: SidebarData): number {
  if (!previous) return 0

  const previousSnapshot = getChatNotificationSnapshot(previous)
  const nextSnapshot = getChatNotificationSnapshot(next)

  const unreadIncrease = Math.max(0, nextSnapshot.unreadCount - previousSnapshot.unreadCount)
  let newWaitingChats = 0
  for (const chatId of nextSnapshot.waitingChatIds) {
    if (!previousSnapshot.waitingChatIds.has(chatId)) {
      newWaitingChats += 1
    }
  }

  return unreadIncrease + newWaitingChats
}
