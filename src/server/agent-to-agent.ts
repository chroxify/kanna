import type { AgentProvider } from "../shared/types"

/**
 * What a chat is told when the message that starts its turn came from
 * another chat's agent and not from a person.
 *
 * The trouble it prevents: a chat that stops to ask the user something is
 * `needs_input`, which sends no report (`maybeReport` in the orchestrator).
 * The chat that handed it the work cannot answer, and goes on waiting. A chat
 * started as a sub-chat is in no list either, so nobody may ever see the
 * question. The sender is an agent, so the answer is not to ask.
 *
 * This is the one list of the tools that stop a turn for the user. Every
 * such stop goes through `AgentCoordinator.requestToolInput`, and these are
 * the calls that reach it, by the name the provider's own model knows:
 *
 * - claude: `canUseTool` in `agent.ts` holds `AskUserQuestion` and
 *   `ExitPlanMode` for the user. `EnterPlanMode` does not stop the turn, but
 *   the only way out of the mode it enters is `ExitPlanMode`.
 * - codex: `item/tool/requestUserInput` in `codex-app-server.ts`, which is
 *   its `request_user_input` tool. Its plan approval is not a tool: Kanna
 *   raises it when a plan-mode turn ends with a plan, so no instruction can
 *   stop it, and `skipPlanApproval` on the turn does (`startTurn` there).
 * - grok: its `AskUserQuestion` and `ExitPlanMode`, and only in plan mode.
 *   Outside it the headless CLI answers its own call and the turn goes on
 *   (`deferToUser` in `grok-cli.ts`).
 * - cursor, pi: none. Neither has a call that reaches the user.
 *
 * A permission prompt is not here because none can happen: Claude's
 * `canUseTool` allows every other tool, Codex runs with `approvalPolicy:
 * "never"`, Cursor with `--force`, Grok with `--always-approve` or in its
 * read-only mode, and Pi asks for nothing.
 *
 * A provider that gains a tool like these needs a line here, or its chats
 * can stall the chats that hand them work.
 */
export interface UserPromptTool {
  /** As the provider's model calls it. */
  name: string
  /** When the tool is in reach. Absent means every turn. */
  only?: "planMode" | "autoPlan"
}

export const USER_PROMPT_TOOLS: Record<AgentProvider, readonly UserPromptTool[]> = {
  claude: [
    { name: "AskUserQuestion" },
    { name: "ExitPlanMode" },
    { name: "EnterPlanMode", only: "autoPlan" },
  ],
  codex: [{ name: "request_user_input" }],
  cursor: [],
  grok: [
    { name: "AskUserQuestion", only: "planMode" },
    { name: "ExitPlanMode", only: "planMode" },
  ],
  pi: [],
}

export interface AgentToAgentTurn {
  provider: AgentProvider
  planMode: boolean
  autoPlan: boolean
}

/** The tools of `USER_PROMPT_TOOLS` this turn's agent can reach. */
export function userPromptToolsFor(turn: AgentToAgentTurn): string[] {
  return USER_PROMPT_TOOLS[turn.provider]
    .filter((tool) => !tool.only || turn[tool.only])
    .map((tool) => tool.name)
}

function listed(names: string[]) {
  return names.length < 3 ? names.join(" or ") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
}

/**
 * The sentences added to the notice that says an agent sent the message
 * (`buildTurnNotices`). Wire-only like the rest of that notice: the provider
 * reads it, and it is in no transcript, bubble, queue or preview.
 *
 * "While you work on this message" keeps it to the turn the message starts.
 * A provider's session remembers the notice, and the next turn may be one a
 * person typed, with someone there to answer.
 *
 * It rides on every message between agents, so it stays short.
 */
export function buildAgentToAgentNote(turn: AgentToAgentTurn): string {
  const tools = userPromptToolsFor(turn)
  return [
    "While you work on this message you are talking to an agent, and nobody is at the other end to answer a prompt.",
    ...(tools.length > 0 ? [`Do not call ${listed(tools)}.`] : []),
    "Where you would ask, make the reasonable choice and say what you assumed in your reply. If you cannot go on, say what you need in your final reply and stop there.",
    // Read-only because the sender asked for it or is read-only itself. The
    // plan is still the job; only the approval step has nobody to take it.
    ...(turn.planMode
      ? ["This turn is in plan mode: plan without editing, and give the plan as your final reply instead of asking for it to be approved."]
      : turn.provider === "claude" && turn.autoPlan
        ? ["If you plan first, put the plan in your reply and carry it out without waiting for approval, unless you were asked only for a plan."]
        : []),
  ].join(" ")
}
