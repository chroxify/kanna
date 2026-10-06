import { describe, expect, test } from "bun:test"
import { createClaudeSwapRotator, isClaudeRateLimitMessage } from "./claude-swap"

function fakeRunner(responses: {
  status?: Record<string, unknown>
  switch?: Record<string, unknown>
}) {
  const calls: string[][] = []
  return {
    calls,
    run: async (_binary: string, args: string[]) => {
      calls.push(args)
      const payload = args[0] === "status" ? responses.status : responses.switch
      return { ok: payload !== undefined, payload: payload ?? null, stderr: "" }
    },
  }
}

describe("createClaudeSwapRotator", () => {
  test("is a no-op when claude-swap is not installed", async () => {
    const runner = fakeRunner({})
    const rotate = createClaudeSwapRotator({ resolveBinary: () => null, run: runner.run })
    expect(await rotate({ rejectedEmail: "a@example.com" })).toBeNull()
    expect(runner.calls).toEqual([])
  })

  test("does not switch when the login already moved off the rejected account", async () => {
    const runner = fakeRunner({
      status: { active: { number: 2, email: "b@example.com" } },
      switch: { switched: true, to: { number: 3, email: "c@example.com" } },
    })
    const rotate = createClaudeSwapRotator({ resolveBinary: () => "/bin/claude-swap", run: runner.run })
    const rotation = await rotate({ rejectedEmail: "a@example.com" })
    expect(rotation).toMatchObject({
      switched: false,
      alreadySwitched: true,
      to: { number: 2, email: "b@example.com" },
    })
    expect(runner.calls).toEqual([["status"]])
  })

  test("switches to the account with the most headroom, once per burst", async () => {
    let now = 1_000
    let active = { number: 1, email: "a@example.com" }
    const calls: string[][] = []
    const rotate = createClaudeSwapRotator({
      resolveBinary: () => "/bin/claude-swap",
      run: async (_binary, args) => {
        calls.push(args)
        if (args[0] === "status") return { ok: true, payload: { active }, stderr: "" }
        const from = active
        active = { number: from.number + 1, email: `${String.fromCharCode(97 + from.number)}@example.com` }
        return {
          ok: true,
          payload: { switched: true, from, to: active, message: `Switched to Account-${active.number}` },
          stderr: "",
        }
      },
      now: () => now,
      log: () => {},
    })
    const runner = { calls }

    const first = await rotate({ rejectedEmail: "a@example.com" })
    expect(first).toMatchObject({ switched: true, to: { email: "b@example.com" } })
    expect(runner.calls).toEqual([["status"], ["switch", "--strategy", "best"]])

    // Seven more chats on the spent account report in seconds later: told
    // where the login went, no second switch.
    now += 5_000
    const second = await rotate({ rejectedEmail: "a@example.com" })
    expect(second).toMatchObject({ switched: false, alreadySwitched: true, to: { email: "b@example.com" } })
    expect(runner.calls).toHaveLength(2)

    // The account it landed on is itself rejected: that is a new switch.
    now += 5_000
    await rotate({ rejectedEmail: "b@example.com" })
    expect(runner.calls).toHaveLength(4)
  })

  test("shares one in-flight switch between concurrent rejections", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: string[][] = []
    const rotate = createClaudeSwapRotator({
      resolveBinary: () => "/bin/claude-swap",
      run: async (_binary, args) => {
        calls.push(args)
        if (args[0] === "status") {
          return { ok: true, payload: { active: { number: 1, email: "a@example.com" } }, stderr: "" }
        }
        await gate
        return { ok: true, payload: { switched: true, to: { number: 2, email: "b@example.com" } }, stderr: "" }
      },
    })
    const pending = Promise.all([
      rotate({ rejectedEmail: "a@example.com" }),
      rotate({ rejectedEmail: "a@example.com" }),
      rotate({ rejectedEmail: "a@example.com" }),
    ])
    await Promise.resolve()
    release()
    const results = await pending
    expect(results.every((result) => result?.switched)).toBe(true)
    expect(calls.filter((args) => args[0] === "switch")).toHaveLength(1)
  })

  test("reports a failed switch as no rotation", async () => {
    const rotate = createClaudeSwapRotator({
      resolveBinary: () => "/bin/claude-swap",
      run: async (_binary, args) => args[0] === "status"
        ? { ok: true, payload: { active: { number: 1, email: "a@example.com" } }, stderr: "" }
        : { ok: false, payload: null, stderr: "No account has headroom" },
      log: () => {},
    })
    expect(await rotate({ rejectedEmail: "a@example.com" })).toBeNull()
  })
})

describe("isClaudeRateLimitMessage", () => {
  test("matches the CLI's limit wording", () => {
    expect(isClaudeRateLimitMessage("You've hit your session limit · resets 10:20pm (Europe/Berlin)")).toBe(true)
    expect(isClaudeRateLimitMessage("You've hit your limit · resets 3pm")).toBe(true)
    expect(isClaudeRateLimitMessage("You've hit your weekly limit")).toBe(true)
    expect(isClaudeRateLimitMessage("Usage limit reached")).toBe(true)
  })

  test("ignores other errors", () => {
    expect(isClaudeRateLimitMessage("An unknown error occurred.")).toBe(false)
    expect(isClaudeRateLimitMessage("")).toBe(false)
    expect(isClaudeRateLimitMessage(null)).toBe(false)
  })
})
