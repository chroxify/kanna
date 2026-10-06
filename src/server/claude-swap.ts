/**
 * claude-swap integration: rotate the Claude Code login when a chat's agent
 * is rejected by a subscription rate limit.
 *
 * Why this exists. Each Claude chat runs a long-lived `claude` child that
 * reads the OAuth login once, at spawn, and keeps the token in memory. When
 * claude-swap (https://github.com/realiti4/claude-swap) moves the login to
 * another account — by hand, from its menu bar, or by its own auto-switcher —
 * every child that is already running keeps using the account it started
 * on, so it hits that account's limit anyway and the chat stalls with
 * "You've hit your session limit" until someone restarts it.
 *
 * The coordinator fixes the restart half itself (a rejected session is
 * recreated on the next prompt, resuming by session token). This module
 * covers the other half: if claude-swap is installed, ask it for the account
 * with the most headroom so the recreated session lands on one that works.
 *
 * Shape of the exchange, from claude-swap's `--json` output:
 *   status --json                 -> { active: { number, email, ... } }
 *   switch --strategy best --json -> { switched, from: {number,email}, to: {number,email}, message }
 */

import { resolveCommandPath } from "./process-utils"

export interface ClaudeAccountRef {
  number: number | null
  email: string
}

export interface ClaudeAccountRotation {
  /** The login changed accounts as a result of this call. */
  switched: boolean
  /**
   * The login is already on an account other than the one that was rejected
   * (someone switched before we got here), so a fresh session will land on it
   * without a switch. A reason to retry just like `switched`.
   */
  alreadySwitched: boolean
  from: ClaudeAccountRef | null
  to: ClaudeAccountRef | null
  message: string
}

export type RotateClaudeAccount = (args: {
  /** Email of the account the rejected session was running on, when known. */
  rejectedEmail: string | null
}) => Promise<ClaudeAccountRotation | null>

const CLAUDE_SWAP_COMMANDS = ["claude-swap", "cswap"] as const
const COMMAND_TIMEOUT_MS = 30_000
/**
 * A switch that just landed serves every rejection arriving on its heels: a
 * project with eight chats hits the limit eight times in the same minute, and
 * only the first should rotate. Within this window the later ones are told
 * about the account the first one chose.
 */
const SWITCH_REUSE_MS = 60_000

interface RunResult {
  ok: boolean
  payload: Record<string, unknown> | null
  stderr: string
}

async function runClaudeSwap(binary: string, args: string[]): Promise<RunResult> {
  const child = Bun.spawn([binary, ...args, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: process.env,
  })
  const timer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    let payload: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(stdout) as unknown
      if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>
    } catch {
      payload = null
    }
    return { ok: exitCode === 0, payload, stderr: stderr.trim() }
  } finally {
    clearTimeout(timer)
  }
}

function accountRef(value: unknown): ClaudeAccountRef | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const email = typeof record.email === "string" ? record.email : ""
  if (!email) return null
  return { number: typeof record.number === "number" ? record.number : null, email }
}

function sameAccount(a: string | null, b: string | null) {
  return Boolean(a && b) && a!.toLowerCase() === b!.toLowerCase()
}

/**
 * The real rotator. Resolves `claude-swap` lazily on first use, so a server
 * started before the tool was installed still finds it.
 */
export function createClaudeSwapRotator(deps?: {
  resolveBinary?: () => string | null
  run?: (binary: string, args: string[]) => Promise<RunResult>
  now?: () => number
  log?: (message: string) => void
}): RotateClaudeAccount {
  const resolveBinary = deps?.resolveBinary ?? (() => {
    for (const command of CLAUDE_SWAP_COMMANDS) {
      const found = resolveCommandPath(command)
      if (found) return found
    }
    return null
  })
  const run = deps?.run ?? runClaudeSwap
  const now = deps?.now ?? Date.now
  const log = deps?.log ?? ((message: string) => console.warn(`[claude-swap] ${message}`))

  let inFlight: Promise<ClaudeAccountRotation | null> | null = null
  let lastSwitch: { at: number; rotation: ClaudeAccountRotation } | null = null

  async function rotate(rejectedEmail: string | null): Promise<ClaudeAccountRotation | null> {
    const binary = resolveBinary()
    if (!binary) return null

    // A switch that just happened covers this rejection too — unless it was
    // onto the very account that is now rejecting, in which case it did not.
    if (lastSwitch && now() - lastSwitch.at < SWITCH_REUSE_MS) {
      const landedOn = lastSwitch.rotation.to?.email ?? null
      if (!sameAccount(landedOn, rejectedEmail)) {
        return { ...lastSwitch.rotation, switched: false, alreadySwitched: true }
      }
    }

    const status = await run(binary, ["status"])
    const active = accountRef(status.payload?.active)
    if (status.ok && active && rejectedEmail && !sameAccount(active.email, rejectedEmail)) {
      return {
        switched: false,
        alreadySwitched: true,
        from: { number: null, email: rejectedEmail },
        to: active,
        message: `Claude login is already on ${active.email}`,
      }
    }

    const result = await run(binary, ["switch", "--strategy", "best"])
    if (!result.ok || !result.payload) {
      log(`switch failed${result.stderr ? `: ${result.stderr}` : ""}`)
      return null
    }
    const rotation: ClaudeAccountRotation = {
      switched: Boolean(result.payload.switched),
      alreadySwitched: false,
      from: accountRef(result.payload.from),
      to: accountRef(result.payload.to),
      message: typeof result.payload.message === "string" ? result.payload.message : "",
    }
    if (rotation.switched) lastSwitch = { at: now(), rotation }
    return rotation
  }

  return async ({ rejectedEmail }) => {
    if (inFlight) return await inFlight
    inFlight = rotate(rejectedEmail)
      .catch((error) => {
        log(error instanceof Error ? error.message : String(error))
        return null
      })
      .finally(() => {
        inFlight = null
      })
    return await inFlight
  }
}

/**
 * The CLI's own wording for a subscription limit, as it lands in the error
 * result (and the synthetic assistant message before it): "You've hit your
 * session limit · resets 10:20pm", "You've hit your usage limit", and the
 * weekly variants.
 */
export function isClaudeRateLimitMessage(text: string | null | undefined): boolean {
  if (!text) return false
  return /\bhit your (?:\w+ )?limit\b|\busage limit\b|\brate limit(?:ed)?\b/i.test(text)
}
