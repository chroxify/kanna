import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { SubagentActivity } from "../../../../shared/types"
import { TasksWidget, taskRowActions } from "./TasksWidget"

function task(overrides: Partial<SubagentActivity> = {}): SubagentActivity {
  return { id: "task-1", type: "subagent", label: "Explore", status: "completed", startedAt: 0, endedAt: 244_000, description: "Find every caller", ...overrides }
}

describe("taskRowActions", () => {
  test("a finished task that can be found in the chat keeps Show in Chat", () => {
    expect(taskRowActions(task(), { canJump: true, isStopping: false })).toEqual({ showInChat: true, stop: false })
  })

  test("a running, stoppable task offers both", () => {
    const running = task({ status: "running", endedAt: undefined, stoppable: true })
    expect(taskRowActions(running, { canJump: true, isStopping: false })).toEqual({ showInChat: true, stop: true })
  })

  test("Stop goes once it is asked to stop, Show in Chat stays", () => {
    const running = task({ status: "running", endedAt: undefined, stoppable: true })
    expect(taskRowActions(running, { canJump: true, isStopping: true })).toEqual({ showInChat: true, stop: false })
  })

  test("nothing to offer when it can't be found or stopped", () => {
    expect(taskRowActions(task({ status: "running", endedAt: undefined }), { canJump: false, isStopping: false })).toEqual({ showInChat: false, stop: false })
  })
})

describe("TasksWidget rows", () => {
  function render(tasks: SubagentActivity[], toolIds: Map<string, string>) {
    return renderToStaticMarkup(createElement(TasksWidget, {
      tasks,
      toolIds,
      entries: [],
      stopControl: { stopping: new Set(), stop: () => {}, error: null },
      onJumpToToolCall: () => {},
    }))
  }

  test("a finished task with a call to show gets a kebab, laid over its time", () => {
    const markup = render([task()], new Map([["task-1", "toolu_1"]]))
    expect(markup).toContain('aria-label="Agent actions"')
    expect(markup).toMatch(/data-row-trailing=""[^>]*>4m 4s</)
  })

  test("a finished task with nothing to offer gets none, and its time gives way to nothing", () => {
    const markup = render([task()], new Map())
    expect(markup).not.toContain("data-row-menu")
    expect(markup).not.toContain("data-row-trailing")
    expect(markup).toContain("4m 4s")
  })
})
