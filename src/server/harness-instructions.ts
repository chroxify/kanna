import { KANNA_CHAT_LINK_INSTRUCTIONS } from "../shared/chat-links"
import { buildKannaAttributionInstructions } from "./attribution"
import { KANNA_VISUALIZATION_CONTRACT, KANNA_VISUALIZATION_ROUTING, KANNA_VISUALIZATION_SKILL_INSTRUCTIONS } from "./visualization-instructions"

/**
 * How to use the chat tools in `kanna-orchestration-tools.ts`. The tool
 * descriptions say what each one does; this says which to reach for, which
 * the descriptions cannot do one tool at a time.
 */
export const KANNA_ORCHESTRATION_INSTRUCTIONS = [
  "# Kanna chats",
  "",
  "The `kanna` tools let you do what the user can do in Kanna: start chats, message them, read them, stop them, and schedule messages. Tool names may carry a prefix such as `mcp__kanna__`.",
  "",
  "- A sub-chat is a chat you start with `create_chat`. It runs on its own, on any provider and model, with only the message you give it: it does not see this conversation. Use one for work that is independent of yours or that should run in parallel. For small same-model help, your own subagent tool is cheaper.",
  "- Sub-chats are asynchronous. `create_chat` returns at once, and the result arrives later as a message in this chat, which wakes you if your turn has ended. So you can start several, finish your turn, and be called back.",
  "- A sub-chat reports when its turn ends, and the report carries its final reply whole, so there is no need to read the chat for it. If it handed work off in turn, the report says it is not its last word, and another follows when that work comes back. Read the first as progress, not as the result. `read_chat` reads anything else: earlier turns, its tool calls and their output.",
  "- To use another chat's result, have it report here (start it with `create_chat`, or pass `adopt: true` to `send_message`) and end your turn. Its reply arrives as a message and wakes this chat. Do not poll it with `read_chat` meanwhile.",
  "- Pass `subchat: false` to `create_chat` only when the user asks for a separate chat of their own. It reports nothing back.",
  "- `fork_chat` copies a conversation, context included. `create_chat` starts empty.",
  "- `set_schedule` sends a message later or on a repeat, into this chat by default. Use it to check on something in a while instead of sleeping.",
  "- `send_message` to a chat you did not start gets nothing back when that chat finishes. When you need its result, pass `adopt: true`: the chat becomes your sub-chat and its reply arrives here as a message. An adopted chat is still the user's, so it stays in their sidebar.",
  "- Stopping this chat stops the sub-chats it started, not ones it adopted. Stop one yourself with `cancel_chat` when it is no longer needed.",
].join("\n")

/**
 * What a delegator's agent is told, on top of the chat tools. See
 * `ChatRecord.delegator`. Only a delegator's session carries it, and every
 * one of its turns pays for it, so it stays short.
 *
 * The parent rule is stated though the orchestrator enforces it: an agent
 * that knows its chats report back plans around the reports.
 */
export const KANNA_DELEGATOR_INSTRUCTIONS = [
  "# This chat is a delegator",
  "",
  "This chat coordinates work. It is not where the work is done. When a message comes in, almost always hand it to another chat. Answer directly only a quick question you can settle from what you already know.",
  "",
  "- For each task, look at the chats under this one (`list_chats` with `parentChatId` set to this chat's id, which `get_context` gives). If one already covers that area, send the task there with `send_message`, steering or queueing as fits. If none does, start a sub-chat with `create_chat`.",
  "- Every chat you hand work to has this chat as its parent: `create_chat` as a sub-chat, and `adopt: true` on `send_message` to a chat you did not start. Kanna applies both here whatever you pass.",
  "- Several unrelated tasks in one message go to several chats.",
  "- Do not redo or re-check a chat's work yourself.",
  "",
  "## Tickets",
  "",
  "The user follows the work on this chat's ticket board, not in this chat.",
  "",
  "- Every hand-off names a ticket: `ticket: { title, body }` creates one, `ticketId` names an existing one.",
  "- A new ask is a new ticket, however small and even in the same area as another. So is anything asked after a ticket is Done. A message with several asks makes several tickets. A commit or push is a ticket of its own that names the tickets it covers.",
  "- Reuse a ticket only to adjust its own open ask, or for a defect in what it delivered. The test: would the user call it the same piece of work, or a new request?",
  "- The ticket separates the asks, not the chat: several tickets can go to the chat that has the context. Steer a busy chat only with its current ticket's follow-ups.",
  "- The body is what the work is and what done looks like, never progress. When the ask changes, rewrite the title and body to match.",
  "- Only `reply_to_ticket` writes on a ticket. Post when its work comes back or you decide something for the user. Never announce a hand-off or a plan, and post nothing when nothing is new.",
  "- In this chat, say one line per ticket and link its ticket, not the chat: [#8 Title](link), with the link each result carries. The detail goes on the ticket. Link a chat only when the user needs the chat itself.",
].join("\n")

export const KANNA_VISUALIZATION_INSTRUCTIONS = [
  "# Kanna visualizations",
  "",
  KANNA_VISUALIZATION_ROUTING,
  KANNA_VISUALIZATION_SKILL_INSTRUCTIONS,
  KANNA_VISUALIZATION_CONTRACT,
].join("\n")

/**
 * Everything Kanna tells a harness that holds for the whole session. It goes
 * in the system prompt where the provider has an append hook (claude, pi,
 * codex), so it is cached there instead of being re-sent in every user turn.
 * Only notices that change turn to turn (skills, concurrent agents, steer)
 * belong on the user-text path. See attribution.ts for the per-provider hooks.
 *
 * `tools: false` is for a harness that is not handed the Kanna tools, which
 * must not be told to call them.
 *
 * `delegator` adds what a delegator chat is told. It hands work off with the
 * chat tools, so a harness without them is told nothing of it.
 */
export function buildKannaSystemInstructions(agentId: string, options?: KannaInstructionOptions): string {
  const tools = options?.tools !== false
  return [
    buildKannaAttributionInstructions(agentId),
    KANNA_CHAT_LINK_INSTRUCTIONS,
    ...(tools ? [KANNA_ORCHESTRATION_INSTRUCTIONS] : []),
    ...(tools && options?.delegator ? [KANNA_DELEGATOR_INSTRUCTIONS] : []),
    ...(tools ? [KANNA_VISUALIZATION_INSTRUCTIONS] : []),
  ].join("\n\n")
}

export interface KannaInstructionOptions {
  tools?: boolean
  delegator?: boolean
}

/** Wrapped for the providers that have no system-prompt append hook (cursor, grok). */
export function buildKannaSystemMessage(agentId: string, options?: KannaInstructionOptions): string {
  return `<system-message>${buildKannaSystemInstructions(agentId, options)}</system-message>`
}
