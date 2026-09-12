import { describe, expect, test } from "bun:test"
import { resolveSubmitIntent, shouldSteerSubmit } from "./submit-mode"

describe("shouldSteerSubmit", () => {
  test("queues on a bare Enter and steers with the modifier", () => {
    expect(shouldSteerSubmit("queue", false)).toBe(false)
    expect(shouldSteerSubmit("queue", true)).toBe(true)
  })

  test("inverts once the default is steer", () => {
    // The point of the setting: whichever action you use most is the bare
    // keystroke, and the other stays reachable rather than disappearing.
    expect(shouldSteerSubmit("steer", false)).toBe(true)
    expect(shouldSteerSubmit("steer", true)).toBe(false)
  })
})

describe("resolveSubmitIntent", () => {
  const intent = (
    mode: "queue" | "steer",
    groupQueue: "modifier" | "primary",
    withModifier: boolean,
    withShift: boolean
  ) => resolveSubmitIntent({ mode, groupQueue, withModifier, withShift })

  test("the ⌘⇧Enter chord groups, the bare keystroke queues", () => {
    expect(intent("queue", "modifier", false, false)).toBe("queue")
    expect(intent("queue", "modifier", true, true)).toBe("group")
  })

  test("the binding swaps which of the two groups", () => {
    expect(intent("queue", "primary", false, false)).toBe("group")
    expect(intent("queue", "primary", true, true)).toBe("queue")
  })

  test("the chord is the same in both modes, unlike steer", () => {
    // Enter steers here, so ⌘Enter is the one that queues — but ⌘⇧Enter groups
    // either way, so it stays one thing to remember.
    expect(intent("steer", "modifier", false, false)).toBe("steer")
    expect(intent("steer", "modifier", true, false)).toBe("queue")
    expect(intent("steer", "modifier", true, true)).toBe("group")
  })

  test("shift never turns a send into a steer", () => {
    // ⌘Enter steers when Enter queues; adding ⇧ takes it to the queue instead.
    expect(intent("queue", "modifier", true, false)).toBe("steer")
    expect(intent("queue", "modifier", true, true)).toBe("group")
  })
})
