import { isWorkingStatus, type SidebarChatRow } from "../../shared/types"
import type { SidebarThread } from "./thread-sections"

/**
 * Delegators on the client: a chat whose job is to hand work to the chats
 * under it (`SidebarChatRow.delegator`). The rules that are not drawing:
 * which of a project's delegators the new chat page sends to, which chats a
 * delegator's list holds, and how many of them want the user. React-free for
 * tests.
 */

/**
 * A project's delegators, the one to reach for first at the head: the most
 * recently active. Archived ones are not offered: archiving a delegator is
 * putting it away.
 */
export function projectDelegators(threads: readonly SidebarThread[], projectId: string | null): SidebarThread[] {
  if (!projectId) return []
  return threads
    .filter((thread) => thread.projectId === projectId && Boolean(thread.row.delegator) && !thread.archived)
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt || left.chatId.localeCompare(right.chatId))
}

/** What this browser remembers of the delegate control, per project. */
export interface DelegatePreference {
  /** False once delegating was turned off here. Absent means never touched. */
  on?: boolean
  /** The delegator last sent to or picked. */
  chatId?: string
}

/**
 * The delegator a message typed on the new chat page goes to, or null when it
 * starts an ordinary chat.
 *
 * Delegating is on whenever the project has a delegator, until it is turned
 * off for that project: someone who made a delegator made it to be the way
 * in, and a control that had to be switched on each time would be forgotten.
 * The one used last is the one used next, while it still exists; otherwise
 * the most recently active.
 *
 * `delegators` is `projectDelegators`' list, most recently active first.
 */
export function resolveDelegateTarget(
  delegators: readonly SidebarThread[],
  preference: DelegatePreference | undefined,
): SidebarThread | null {
  if (delegators.length === 0 || preference?.on === false) return null
  return delegators.find((thread) => thread.chatId === preference?.chatId) ?? delegators[0]!
}

/**
 * The chats a delegator's list holds: the ones directly under it, archived
 * ones included (the list files them under Archived, as the sidebar does).
 *
 * Direct children only, not the whole tree. Every chat a delegator starts or
 * messages becomes its child, so its children are the chats it is running
 * and reporting on. A chat one of those started for itself reports to that
 * chat, which answers for it; listing it here would put work in front of the
 * user that the delegator never mentions. It is one step away, in its
 * parent's Tasks and in the graph.
 */
export function delegatedThreads(threads: readonly SidebarThread[], delegatorChatId: string): SidebarThread[] {
  return threads.filter((thread) => thread.row.parentChatId === delegatorChatId)
}

/**
 * Whether a chat under a delegator wants the user: it is waiting on an
 * answer, or it has come to rest with something unread.
 *
 * A channel row's rule (`ChannelList`) without its exception for sub-chats.
 * Elsewhere a sub-chat's unread mark is its parent's business, which is why
 * it makes no sound and adds to no count. This list is made of sub-chats,
 * and the mark is what its rows show, so here it counts: the number is the
 * rows in the list with a mark on them. A chat that finishes therefore stays
 * counted until it is opened. The iOS app counts the same way.
 */
export function delegatedChatWantsUser(row: Pick<SidebarChatRow, "status" | "unread">): boolean {
  return row.status === "waiting_for_user" || (row.unread && !isWorkingStatus(row.status))
}

/** How many of the chats under a delegator want the user. Archived ones are put away, and not counted. */
export function delegatedAttentionCount(
  rows: readonly Pick<SidebarChatRow, "parentChatId" | "status" | "unread">[],
  delegatorChatId: string,
): number {
  let count = 0
  for (const row of rows) {
    if (row.parentChatId === delegatorChatId && delegatedChatWantsUser(row)) count += 1
  }
  return count
}

/** What a new, still unnamed delegator is called in the control: the server's "New Chat" would read as no delegator at all. */
export function delegatorDisplayTitle(title: string): string {
  return title.trim() === "" || title === "New Chat" ? "New delegator" : title
}
