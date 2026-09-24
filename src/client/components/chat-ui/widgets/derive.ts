import { ATTACHMENT_TOOL_NAMES, displayAttachments, type DisplayAttachment } from "../../../../shared/display-tools"
import type { NormalizedToolCall, SubagentActivity, ToolCallEntry, TranscriptEntry } from "../../../../shared/types"

/**
 * What the widgets read out of the transcript. Kept pure (entries in, data
 * out) so they are cheap to memo on the transcript and easy to test.
 *
 * They only see the loaded window of the transcript. That is the recent end,
 * which is what a sidebar about the current work wants anyway.
 */

export interface WidgetAttachment extends DisplayAttachment {
  /** The tool result it came from, plus its index: stable across pushes. */
  key: string
}

/**
 * Every file the agent sent with send_attachments or generate_images, newest
 * first. Results travel inline with the transcript (display is an inline tool
 * kind), so nothing has to be fetched. A result that failed, or that an older
 * client cache holds trimmed, contributes nothing.
 */
export function deriveSentAttachments(entries: readonly TranscriptEntry[]): WidgetAttachment[] {
  const attachmentToolIds = new Set<string>()
  const attachments: WidgetAttachment[] = []
  for (const entry of entries) {
    if (entry.kind === "tool_call" && entry.tool.toolKind === "display" && ATTACHMENT_TOOL_NAMES.includes(entry.tool.toolName)) {
      attachmentToolIds.add(entry.tool.toolId)
      continue
    }
    if (entry.kind !== "tool_result" || entry.isError || !attachmentToolIds.has(entry.toolId)) continue
    displayAttachments(entry.content).forEach((attachment, index) => {
      attachments.push({ ...attachment, key: `${entry._id}:${index}` })
    })
  }
  return attachments.reverse()
}

/**
 * The tool call that spawned each subagent, so its row in the Agents widget can
 * jump to it. Keyed by subagent id; an agent missing here has no call in the
 * loaded window and its row stays static.
 *
 * Codex and Grok key a subagent by its tool call id, so the id is the answer.
 * Claude keys it by the SDK's `agent_id`, which no transcript entry carries.
 * Its spawn calls are matched by type instead: the latest calls for a
 * subagent type pair, in order, with this turn's agents of that type. A turn's
 * agents are the latest spawned, so the tail of the calls is theirs.
 * Background shells and monitors have no spawn call to find.
 */
export function deriveSubagentToolIds(
  entries: readonly TranscriptEntry[],
  subagents: readonly SubagentActivity[],
): Map<string, string> {
  const callIdsByLabel = new Map<string, string[]>()
  const callIds = new Set<string>()
  for (const entry of entries) {
    if (entry.kind !== "tool_call" || entry.tool.toolKind !== "subagent_task") continue
    callIds.add(entry.tool.toolId)
    const label = entry.tool.input.subagentType || entry.tool.input.description
    if (!label) continue
    const ids = callIdsByLabel.get(label) ?? []
    ids.push(entry.tool.toolId)
    callIdsByLabel.set(label, ids)
  }

  const toolIds = new Map<string, string>()
  const unmatchedByLabel = new Map<string, SubagentActivity[]>()
  for (const agent of subagents) {
    if (callIds.has(agent.id)) {
      toolIds.set(agent.id, agent.id)
    } else if (agent.type === "subagent") {
      const agents = unmatchedByLabel.get(agent.label) ?? []
      agents.push(agent)
      unmatchedByLabel.set(agent.label, agents)
    }
  }
  for (const [label, agents] of unmatchedByLabel) {
    const calls = callIdsByLabel.get(label) ?? []
    const tail = calls.slice(-agents.length)
    // Fewer calls than agents means the older ones are outside the window:
    // the calls still loaded belong to the newest agents.
    const offset = agents.length - tail.length
    tail.forEach((toolId, index) => toolIds.set(agents[offset + index]!.id, toolId))
  }
  return toolIds
}

/** What an Agents row and its card know about one subagent, from the transcript. */
export interface SubagentDetails {
  /** The call that spawned it: its entry, for fetching a prompt left in the sidecar. */
  spawn: ToolCallEntry
  /** The short task the caller gave it ("Audit durable.ts turn engine"). */
  description?: string
  /** "general-purpose", "Explore", … */
  subagentType?: string
  /** The full task text, when the transcript carries it inline. */
  prompt?: string
  /** Tool calls it has made so far. */
  toolCalls: number
  /** Messages it has written so far (its text, not its tool calls). */
  messages: number
  /** Its latest tool call: what it's doing now, or did last. */
  latestTool?: NormalizedToolCall
}

/**
 * Each subagent's spawn call and what it has done since, keyed by subagent
 * id. Its work is every entry whose `parentToolUseId` is the spawn call:
 * providers that don't stream a subagent's steps give zeros, not a guess.
 */
export function deriveSubagentDetails(
  entries: readonly TranscriptEntry[],
  toolIds: ReadonlyMap<string, string>,
): Map<string, SubagentDetails> {
  const byToolId = new Map<string, SubagentDetails>()
  const wanted = new Set(toolIds.values())
  for (const entry of entries) {
    if (entry.kind === "tool_call" && entry.tool.toolKind === "subagent_task" && wanted.has(entry.tool.toolId)) {
      byToolId.set(entry.tool.toolId, {
        spawn: entry,
        description: entry.tool.input.description || undefined,
        subagentType: entry.tool.input.subagentType || undefined,
        prompt: entry.tool.input.prompt || undefined,
        toolCalls: 0,
        messages: 0,
      })
      continue
    }
    const parent = entry.parentToolUseId ? byToolId.get(entry.parentToolUseId) : undefined
    if (!parent) continue
    if (entry.kind === "tool_call") {
      parent.toolCalls += 1
      parent.latestTool = entry.tool
    } else if (entry.kind === "assistant_text" && entry.text.trim()) {
      parent.messages += 1
    }
  }
  const details = new Map<string, SubagentDetails>()
  for (const [agentId, toolId] of toolIds) {
    const found = byToolId.get(toolId)
    if (found) details.set(agentId, found)
  }
  return details
}
