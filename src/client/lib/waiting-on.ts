import type { WaitingOn } from "../../shared/types"

function counted(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/**
 * What a chat that is waiting on a subagent says it is waiting on: "Waiting
 * on 2 chats", "Waiting on 1 agent", "Waiting on 2 chats and 1 agent".
 *
 * Two nouns, because they are two things to a reader. A chat is a Kanna
 * sub-chat, which can be opened. An agent is the provider's own (a subagent,
 * a workflow), which is not a chat and has nowhere to open.
 *
 * With no count to go on it names no number: a wrong one would be read as
 * true. The server sends the count with the status (`WaitingOn`), so this is
 * for a server that does not yet.
 */
export function waitingOnLabel(waitingOn?: WaitingOn | null): string {
  const parts: string[] = []
  if (waitingOn && waitingOn.chats > 0) parts.push(counted(waitingOn.chats, "chat"))
  if (waitingOn && waitingOn.agents > 0) parts.push(counted(waitingOn.agents, "agent"))
  return parts.length > 0 ? `Waiting on ${parts.join(" and ")}` : "Waiting on chats"
}
