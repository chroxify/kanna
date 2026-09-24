import { describe, expect, test } from "bun:test"
import { normalizeToolCall } from "../../../../shared/tools"
import type { SubagentActivity, TranscriptEntry } from "../../../../shared/types"
import { deriveSentAttachments, deriveSubagentDetails, deriveSubagentToolIds } from "./derive"

let nextId = 0
function toolCall(toolName: string, toolId: string, input: Record<string, unknown>): TranscriptEntry {
  return { _id: `e${nextId++}`, createdAt: 0, kind: "tool_call", tool: normalizeToolCall({ toolName, toolId, input }) } as TranscriptEntry
}
function toolResult(toolId: string, content: unknown, isError = false): TranscriptEntry {
  return { _id: `e${nextId++}`, createdAt: 0, kind: "tool_result", toolId, content, isError } as TranscriptEntry
}
const file = (name: string, kind: "image" | "file" = "image") =>
  ({ type: "attachment", url: `/api/chats/c1/media/${name}`, name, kind, mimeType: kind === "image" ? "image/png" : "text/plain", size: 1 })

describe("deriveSentAttachments", () => {
  test("collects send_attachments and generate_images results, newest first", () => {
    const entries = [
      toolCall("send_attachments", "s1", { attachments: [] }),
      toolResult("s1", [file("one.png"), file("notes.txt", "file")]),
      toolCall("generate_images", "g1", { images: [] }),
      toolResult("g1", [file("two.png")]),
    ]
    expect(deriveSentAttachments(entries).map((attachment) => attachment.name)).toEqual(["two.png", "notes.txt", "one.png"])
  })

  test("skips failed calls, other tools, and results with no usable attachments", () => {
    const entries = [
      toolCall("send_attachments", "s1", {}),
      toolResult("s1", "File not found", true),
      toolCall("show_chart", "c1", { data: [] }),
      toolResult("c1", [file("chart.png")]),
      toolCall("send_attachments", "s2", {}),
      toolResult("s2", [{ type: "attachment", url: "file:///etc/passwd", name: "x", kind: "file" }]),
    ]
    expect(deriveSentAttachments(entries)).toEqual([])
  })

  test("keys are stable per result and index", () => {
    const entries = [toolCall("send_attachments", "s1", {}), toolResult("s1", [file("a.png"), file("b.png")])]
    const keys = deriveSentAttachments(entries).map((attachment) => attachment.key)
    expect(new Set(keys).size).toBe(2)
    expect(deriveSentAttachments(entries).map((attachment) => attachment.key)).toEqual(keys)
  })
})

describe("deriveSubagentToolIds", () => {
  const agent = (id: string, label: string, type = "subagent"): SubagentActivity =>
    ({ id, type, label, status: "running", startedAt: 0 })
  const spawn = (toolId: string, subagentType: string) =>
    toolCall("Agent", toolId, { subagent_type: subagentType, description: "d", prompt: "p" })

  test("an agent keyed by its spawn call's id maps to that call", () => {
    const toolIds = deriveSubagentToolIds([spawn("call-1", "Explore")], [agent("call-1", "Explore")])
    expect(toolIds.get("call-1")).toBe("call-1")
  })

  test("agents keyed by agent_id pair with the latest calls of their type, in order", () => {
    const entries = [spawn("old", "Explore"), spawn("a", "Explore"), spawn("p", "Plan"), spawn("b", "Explore")]
    const toolIds = deriveSubagentToolIds(entries, [agent("x1", "Explore"), agent("x2", "Explore"), agent("y1", "Plan")])
    expect(Object.fromEntries(toolIds)).toEqual({ x1: "a", x2: "b", y1: "p" })
  })

  test("calls outside the loaded window leave the older agents unmapped", () => {
    const toolIds = deriveSubagentToolIds([spawn("b", "Explore")], [agent("x1", "Explore"), agent("x2", "Explore")])
    expect(Object.fromEntries(toolIds)).toEqual({ x2: "b" })
  })

  test("background shells have no spawn call", () => {
    const toolIds = deriveSubagentToolIds([toolCall("Bash", "sh", { command: "sleep 9" })], [agent("task-1", "sleep 9", "shell")])
    expect(toolIds.size).toBe(0)
  })
})

describe("deriveSubagentDetails", () => {
  test("reads the task off the spawn call and counts the agent's own steps", () => {
    const child = (entry: TranscriptEntry, parent: string): TranscriptEntry => ({ ...entry, parentToolUseId: parent })
    const entries: TranscriptEntry[] = [
      toolCall("Agent", "call-1", { subagent_type: "general-purpose", description: "Audit durable.ts turn engine", prompt: "Read CLAUDE.md first." }),
      child(toolCall("Read", "r1", { file_path: "/repo/src/worker/durable.ts" }), "call-1"),
      child({ _id: "t1", createdAt: 3, kind: "assistant_text", text: "Looking at runTurn." }, "call-1"),
      child(toolCall("Grep", "g1", { pattern: "alarm" }), "call-1"),
      // The main thread's own call isn't the agent's.
      toolCall("Bash", "b1", { command: "ls" }),
    ]
    const details = deriveSubagentDetails(entries, new Map([["agent-a", "call-1"]])).get("agent-a")
    expect(details?.description).toBe("Audit durable.ts turn engine")
    expect(details?.subagentType).toBe("general-purpose")
    expect(details?.prompt).toBe("Read CLAUDE.md first.")
    expect(details?.toolCalls).toBe(2)
    expect(details?.messages).toBe(1)
    expect(details?.latestTool?.toolKind).toBe("grep")
  })
})
