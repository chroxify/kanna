import { describe, expect, test } from "bun:test"
import { fallbackTitleFromMessage } from "./generate-title"

describe("fallbackTitleFromMessage", () => {
  test("titles a message by what the user wrote, not by what Kanna added for the agent", () => {
    expect(fallbackTitleFromMessage("Fix login\n\n<system-message>for the agent</system-message>")).toBe("Fix login")
    expect(fallbackTitleFromMessage("<system-message>for the agent</system-message>\n\nShip it")).toBe("Ship it")
  })

  test("a message that is only for the agent has no title", () => {
    expect(fallbackTitleFromMessage("<system-message>for the agent</system-message>")).toBeNull()
  })
})
