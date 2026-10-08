import { describe, expect, test } from "bun:test"
import { KANNA_CHAT_LINK_INSTRUCTIONS } from "../shared/chat-links"
import { buildKannaAgentTrailer } from "./attribution"
import { buildKannaSystemInstructions, buildKannaSystemMessage, KANNA_ORCHESTRATION_INSTRUCTIONS, KANNA_VISUALIZATION_INSTRUCTIONS } from "./harness-instructions"
import { KANNA_TOOL_DESCRIPTION_LIMIT, KANNA_TOOL_NAMES, kannaToolSpecs } from "./kanna-tools"
import { SHOW_VISUALIZATION_TOOL } from "./kanna-visualization-tool"
import { KANNA_VISUALIZATION_CONTRACT, KANNA_VISUALIZATION_SKILL_INSTRUCTIONS } from "./visualization-instructions"
import { VISUALIZATION_EXPAND_BUTTON, VISUALIZATION_MAX_HEIGHT } from "../shared/visualization"

const AGENT_ID = "claude/claude-opus-5"

describe("buildKannaSystemInstructions", () => {
  test("carries the attribution and the chat-link rules", () => {
    const instructions = buildKannaSystemInstructions(AGENT_ID)
    expect(instructions).toContain(buildKannaAgentTrailer(AGENT_ID))
    expect(instructions).toContain(KANNA_CHAT_LINK_INSTRUCTIONS)
  })

  test("explains the chat tools only to a harness that has them", () => {
    expect(buildKannaSystemInstructions(AGENT_ID)).toContain(KANNA_ORCHESTRATION_INSTRUCTIONS)
    expect(buildKannaSystemInstructions(AGENT_ID, { tools: false })).not.toContain("create_chat")
    expect(buildKannaSystemMessage(AGENT_ID, { tools: false })).not.toContain("create_chat")
  })

  test("names only tools that exist", () => {
    const named = [...KANNA_ORCHESTRATION_INSTRUCTIONS.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]!)
    expect(named.length).toBeGreaterThan(0)
    for (const name of named) {
      if (name === "kanna" || name.startsWith("mcp__")) continue
      expect(KANNA_TOOL_NAMES).toContain(name)
    }
  })
})

describe("buildKannaSystemMessage", () => {
  test("wraps the instructions for the no-append-hook providers", () => {
    const message = buildKannaSystemMessage(AGENT_ID)
    expect(message.startsWith("<system-message>")).toBe(true)
    expect(message.endsWith("</system-message>")).toBe(true)
    expect(message).toContain(buildKannaSystemInstructions(AGENT_ID))
  })
})


test("visualization instructions reach tool-enabled harnesses and prefer native inline results", () => {
  const instructions = buildKannaSystemInstructions(AGENT_ID)
  expect(instructions).toContain(KANNA_VISUALIZATION_INSTRUCTIONS)
  expect(instructions).toContain("# Kanna visualizations")
  expect(instructions).toContain(KANNA_VISUALIZATION_SKILL_INSTRUCTIONS)
  expect(instructions).toContain(KANNA_VISUALIZATION_CONTRACT)
  expect(instructions).toContain("show_chart tool is retired")
  expect(buildKannaSystemMessage(AGENT_ID)).toContain(KANNA_VISUALIZATION_INSTRUCTIONS)
  expect(buildKannaSystemInstructions(AGENT_ID, { tools: false })).not.toContain("show_visualization")
})

test("the tool is reached for by situation, for a diagram and a prototype as much as a chart", () => {
  const instructions = buildKannaSystemInstructions(AGENT_ID)
  const description = SHOW_VISUALIZATION_TOOL.description
  // Both say when, and what it takes the place of, before any rule for drawing.
  for (const text of [instructions, description]) {
    expect(text).toContain("how something works")
    expect(text).toContain("could look like")
    expect(text).toMatch(/ASCII art/)
    expect(text).toMatch(/Mermaid/)
    expect(text).toMatch(/a diagram/)
    expect(text).toMatch(/a prototype/)
    expect(text).toMatch(/a chart or (a )?table/)
  }
  expect(instructions).toContain("Not a PNG or screenshot sent with send_attachments")
  expect(description.startsWith("Show something inline in the conversation")).toBe(true)
  expect(description.indexOf("a diagram")).toBeLessThan(description.indexOf("- Inline all CSS"))
  expect(description).toContain('under "Kanna visualizations"')
  expect(description).not.toContain(KANNA_VISUALIZATION_SKILL_INSTRUCTIONS)

  // The contract is by kind, so a prototype is not held to a chart's rules.
  const section = (heading: string) => {
    const from = KANNA_VISUALIZATION_CONTRACT.indexOf(`## ${heading}`)
    const next = KANNA_VISUALIZATION_CONTRACT.indexOf("\n## ", from + 1)
    expect(from).toBeGreaterThanOrEqual(0)
    return KANNA_VISUALIZATION_CONTRACT.slice(from, next === -1 ? undefined : next)
  }
  const every = section("Every kind"), charts = section("Charts and tables"), diagrams = section("Diagrams"), prototypes = section("Prototypes")
  for (const chartRule of ["One chart per visualization", "kanna-tooltip", "Axis ticks", "window.kanna.download", "Do not build a dashboard because the data allows one", "small multiples", "Never a readout in a fixed line of text", "keyboard focus on the marks"]) {
    expect(charts).toContain(chartRule)
    expect(every).not.toContain(chartRule)
    expect(prototypes).not.toContain(chartRule)
  }
  // A header is a chart's and a diagram's. A prototype has none: the stage is the design.
  expect(charts).toContain('an h3 title that names what is shown and a p class="text-muted" subtitle')
  expect(diagrams).toContain("an h3 title")
  expect(prototypes).toContain("No title or subtitle")
  expect(prototypes).not.toContain("<h3>")
  expect(description).toContain("A prototype has no heading")
  // Diagrams have guidance of their own.
  for (const rule of ["inline SVG", "no library", "320px", "arrowheads", "--border", `${VISUALIZATION_MAX_HEIGHT}px`, "visible at rest"]) expect(diagrams).toContain(rule)
  // And a prototype says when to step through directions and when to lay them side by side.
  expect(prototypes).toContain("kanna-segmented picker")
  expect(prototypes).toContain("side by side")
  expect(prototypes).toContain("wait for that choice")
  expect(prototypes).toContain('<section id="stage" style="height:40px">')
})

test("what holds for every kind is in the description and the session instructions alike", () => {
  const instructions = buildKannaSystemInstructions(AGENT_ID)
  const description = SHOW_VISUALIZATION_TOOL.description
  // The corner the prompt keeps clear is the expand button's own, with a margin.
  const { size, inset, clear } = VISUALIZATION_EXPAND_BUTTON
  expect(clear).toBeGreaterThan(size + inset)
  for (const text of [instructions, description]) {
    expect(text).toContain(`Keep the top-right ${clear}px by ${clear}px clear`)
    expect(text).toContain("kanna-segmented")
    expect(text).toContain("kanna-tabs")
    expect(text).toContain("16px")
    expect(text).toContain(`up to ${VISUALIZATION_MAX_HEIGHT}px`)
    expect(text).toContain("iOS")
    expect(text).toContain("One subject per visualization")
    // Stated in both, strictly: nothing a reader does may move the conversation.
    expect(text).toContain("must never change after")
    expect(text).toContain("tallest state")
  }
  // The rest is only in the session instructions, which no harness cuts short.
  expect(instructions).toContain(`${size}px expand button`)
  expect(instructions).toContain("No interaction may grow or shrink it")
  expect(instructions).toContain("kanna:themechange")
  expect(instructions).toContain("touch-action: none")
  expect(instructions).not.toContain("<select aria-label")
})

// Claude Code cuts an MCP tool's description at this length and ends it
// "[truncated]". An 8,000-character description reached Claude as its first
// quarter, and an agent went and read the rest out of the installed bundle.
test("no tool's description is longer than the shortest a harness keeps", () => {
  expect(KANNA_TOOL_DESCRIPTION_LIMIT).toBe(2048)
  for (const tool of kannaToolSpecs()) {
    expect(`${tool.name}: ${tool.description.length}`).toBe(`${tool.name}: ${Math.min(tool.description.length, KANNA_TOOL_DESCRIPTION_LIMIT)}`)
  }
})
