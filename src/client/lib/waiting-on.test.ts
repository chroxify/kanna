import { describe, expect, test } from "bun:test"
import { waitingOnLabel } from "./waiting-on"

describe("waitingOnLabel", () => {
  test("counts chats, with one chat in the singular", () => {
    expect(waitingOnLabel({ chats: 1, agents: 0 })).toBe("Waiting on 1 chat")
    expect(waitingOnLabel({ chats: 2, agents: 0 })).toBe("Waiting on 2 chats")
    expect(waitingOnLabel({ chats: 12, agents: 0 })).toBe("Waiting on 12 chats")
  })

  test("calls a provider's own agent an agent, not a chat", () => {
    expect(waitingOnLabel({ chats: 0, agents: 1 })).toBe("Waiting on 1 agent")
    expect(waitingOnLabel({ chats: 0, agents: 3 })).toBe("Waiting on 3 agents")
  })

  test("names both when it is waiting on both, chats first", () => {
    expect(waitingOnLabel({ chats: 2, agents: 1 })).toBe("Waiting on 2 chats and 1 agent")
    expect(waitingOnLabel({ chats: 1, agents: 4 })).toBe("Waiting on 1 chat and 4 agents")
  })

  test("names no number when it has none to go on", () => {
    for (const unknown of [undefined, null, { chats: 0, agents: 0 }]) {
      expect(waitingOnLabel(unknown)).toBe("Waiting on chats")
    }
  })
})
