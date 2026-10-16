import { describe, expect, test } from "bun:test"
import { stripSystemMessages, toMessagePreview } from "../shared/message-preview"
import { splitReportSections } from "../shared/report-sections"
import { claudeToolset } from "./agent"
import { buildAgentToAgentNote, USER_PROMPT_TOOLS, userPromptToolsFor } from "./agent-to-agent"
import { SERVER_PROVIDERS } from "./provider-catalog"

const DEFAULT = { planMode: false, autoPlan: false }

describe("the tools that stop a turn for the user", () => {
  test("every provider is accounted for, with none for the ones that cannot ask", () => {
    expect(Object.keys(USER_PROMPT_TOOLS).sort()).toEqual(SERVER_PROVIDERS.map((entry) => entry.id).sort())
    expect(userPromptToolsFor({ provider: "claude", ...DEFAULT })).toEqual(["AskUserQuestion", "ExitPlanMode"])
    expect(userPromptToolsFor({ provider: "codex", ...DEFAULT })).toEqual(["request_user_input"])
    expect(userPromptToolsFor({ provider: "cursor", ...DEFAULT })).toEqual([])
    expect(userPromptToolsFor({ provider: "pi", ...DEFAULT })).toEqual([])
    // Headless Grok answers its own question outside plan mode, so nothing waits.
    expect(userPromptToolsFor({ provider: "grok", ...DEFAULT })).toEqual([])
    expect(userPromptToolsFor({ provider: "grok", planMode: true, autoPlan: false })).toEqual(["AskUserQuestion", "ExitPlanMode"])
  })

  test("Claude's are named as its toolset names them, and only when the session has them", () => {
    for (const autoPlan of [false, true]) {
      const named = userPromptToolsFor({ provider: "claude", planMode: false, autoPlan })
      for (const name of named) expect(claudeToolset(autoPlan)).toContain(name)
      expect(named.includes("EnterPlanMode")).toBe(autoPlan)
    }
  })
})

describe("buildAgentToAgentNote", () => {
  test("says nobody is there, names the recipient's own tools, and says what to do instead", () => {
    expect(buildAgentToAgentNote({ provider: "claude", ...DEFAULT })).toBe(
      "While you work on this message you are talking to an agent, and nobody is at the other end to answer a prompt. "
      + "Do not call AskUserQuestion or ExitPlanMode. "
      + "Where you would ask, make the reasonable choice and say what you assumed in your reply. "
      + "If you cannot go on, say what you need in your final reply and stop there.",
    )
    expect(buildAgentToAgentNote({ provider: "codex", ...DEFAULT })).toBe(
      "While you work on this message you are talking to an agent, and nobody is at the other end to answer a prompt. "
      + "Do not call request_user_input. "
      + "Where you would ask, make the reasonable choice and say what you assumed in your reply. "
      + "If you cannot go on, say what you need in your final reply and stop there.",
    )
    // A provider is not told about tools it does not have.
    for (const provider of ["cursor", "pi", "grok"] as const) {
      const note = buildAgentToAgentNote({ provider, ...DEFAULT })
      expect(note).not.toContain("Do not call")
      expect(note).toContain("nobody is at the other end")
      expect(note).toContain("say what you assumed")
    }
    expect(buildAgentToAgentNote({ provider: "codex", ...DEFAULT })).not.toContain("AskUserQuestion")
  })

  test("a turn in plan mode still plans, and returns the plan instead of asking for approval", () => {
    const claude = buildAgentToAgentNote({ provider: "claude", planMode: true, autoPlan: false })
    expect(claude).toContain("Do not call AskUserQuestion or ExitPlanMode.")
    expect(claude).toEndWith("This turn is in plan mode: plan without editing, and give the plan as your final reply instead of asking for it to be approved.")
    expect(buildAgentToAgentNote({ provider: "codex", planMode: true, autoPlan: false })).toContain("give the plan as your final reply")
    expect(buildAgentToAgentNote({ provider: "grok", planMode: true, autoPlan: false })).toContain("Do not call AskUserQuestion or ExitPlanMode.")

    // Auto Plan lets Claude put itself in plan mode, where approval is the only way out.
    const auto = buildAgentToAgentNote({ provider: "claude", planMode: false, autoPlan: true })
    expect(auto).toContain("Do not call AskUserQuestion, ExitPlanMode or EnterPlanMode.")
    expect(auto).toEndWith("If you plan first, put the plan in your reply and carry it out without waiting for approval, unless you were asked only for a plan.")
    expect(buildAgentToAgentNote({ provider: "claude", ...DEFAULT })).not.toContain("plan")
  })

  test("it is short, since every message between agents carries it", () => {
    expect(buildAgentToAgentNote({ provider: "claude", ...DEFAULT }).length).toBeLessThan(340)
    expect(buildAgentToAgentNote({ provider: "claude", planMode: true, autoPlan: true }).length).toBeLessThan(500)
  })

  test("in the notice's block it is hidden wherever a message is shown, and is no report header", () => {
    const note = buildAgentToAgentNote({ provider: "claude", planMode: true, autoPlan: true })
    const notice = `<system-message>This message was sent by the agent in Kanna chat "Release train" (chat id sender-1), not typed by the user. It started this chat, and your final reply is sent back to it when you finish. ${note}</system-message>`
    expect(note).not.toContain("<")
    expect(stripSystemMessages(`audit the parser\n\n${notice}`)).toBe("audit the parser")
    expect(toMessagePreview(`audit the parser\n\n${notice}`)).toBe("audit the parser")
    // Next to a report, it adds no part and takes no words from one.
    const report = `<system-message>\nSub-chat completed: [Audit](/chat/child-1) (chat id child-1)\n</system-message>\n\nFound two bugs.\n\n${notice}`
    expect(splitReportSections(report, ["child-1"])).toEqual([{ chatId: "child-1", status: "completed", body: "Found two bugs." }])
    // Even were the sender one of the report's chats, the notice reads as no status and no adoption.
    expect(splitReportSections(`${notice}\n\nhello`, ["sender-1"])).toEqual([{ chatId: "sender-1", status: null, body: "hello" }])
  })
})
