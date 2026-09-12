import { afterEach, describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AuthServiceStatus, ProviderUsageSnapshot } from "../shared/types"
import { ClaudeAccountStore, DEFAULT_CLAUDE_ACCOUNT_ID, pickClaudeFailoverAccount } from "./claude-accounts"

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "kanna-claude-accounts-"))
  tempDirs.push(root)
  const sharedConfigDir = path.join(root, "home", ".claude")
  await mkdir(path.join(sharedConfigDir, "projects", "-repo"), { recursive: true })
  await mkdir(path.join(sharedConfigDir, "skills"), { recursive: true })
  await mkdir(path.join(sharedConfigDir, "backups"), { recursive: true })
  await writeFile(path.join(sharedConfigDir, "settings.json"), "{}")
  await writeFile(path.join(sharedConfigDir, ".credentials.json"), "{\"secret\":true}")
  await writeFile(path.join(sharedConfigDir, "projects", "-repo", "session.jsonl"), "{}\n")
  const sharedGlobalConfigPath = path.join(root, "home", ".claude.json")
  await writeFile(sharedGlobalConfigPath, JSON.stringify({
    mcpServers: { linear: { type: "http", url: "https://mcp.linear.app" } },
    hasCompletedOnboarding: true,
    oauthAccount: { emailAddress: "first@example.com" },
    cachedGrowthBookFeatures: { flag: true },
  }))
  const options = {
    filePath: path.join(root, "data", "claude-accounts.json"),
    accountsDir: path.join(root, "data", "claude-accounts"),
    sharedConfigDir,
    sharedGlobalConfigPath,
    now: () => 1_000,
  }
  return { root, sharedConfigDir, options }
}

function usage(windows: Array<{ id: string; usedPercent: number }>): ProviderUsageSnapshot {
  return {
    provider: "claude",
    status: "ok",
    plan: "max",
    windows: windows.map((window) => ({
      ...window,
      label: window.id,
      resetsAt: null,
      recordedAt: "2026-09-12T10:00:00.000Z",
      source: "on_demand" as const,
    })),
    credits: null,
    detail: null,
    updatedAt: null,
  }
}

describe("ClaudeAccountStore", () => {
  test("starts with only the default account, which uses Claude Code's own config dir", async () => {
    const { options } = await createFixture()
    const store = new ClaudeAccountStore(options)
    await store.initialize()

    expect(store.list()).toEqual([{ id: DEFAULT_CLAUDE_ACCOUNT_ID, configDir: null, createdAt: 0 }])
    expect(store.getActive().id).toBe(DEFAULT_CLAUDE_ACCOUNT_ID)
    expect(store.envFor(DEFAULT_CLAUDE_ACCOUNT_ID)).toEqual({})
  })

  test("a new account links the shared config but owns its login and .claude.json", async () => {
    const { sharedConfigDir, options } = await createFixture()
    const store = new ClaudeAccountStore(options)
    await store.initialize()

    const account = await store.add()
    const configDir = account.configDir!
    expect(store.envFor(account.id)).toEqual({ CLAUDE_CONFIG_DIR: configDir })

    const entries = (await readdir(configDir)).sort()
    expect(entries).toEqual([".claude.json", "projects", "settings.json", "skills"])
    expect(await readlink(path.join(configDir, "projects"))).toBe(path.join(sharedConfigDir, "projects"))
    // Resuming a session on another account reads the same transcript.
    expect(await readFile(path.join(configDir, "projects", "-repo", "session.jsonl"), "utf8")).toBe("{}\n")

    const seeded = JSON.parse(await readFile(path.join(configDir, ".claude.json"), "utf8"))
    expect(seeded).toEqual({
      mcpServers: { linear: { type: "http", url: "https://mcp.linear.app" } },
      hasCompletedOnboarding: true,
    })
  })

  test("links entries the shared config dir gains after the account was added", async () => {
    const { sharedConfigDir, options } = await createFixture()
    const store = new ClaudeAccountStore(options)
    const account = await store.add()

    await mkdir(path.join(sharedConfigDir, "plugins"))
    await store.linkSharedEntries(account)

    expect((await lstat(path.join(account.configDir!, "plugins"))).isSymbolicLink()).toBe(true)
  })

  test("persists accounts, the active one and auto-switch", async () => {
    const { options } = await createFixture()
    const store = new ClaudeAccountStore(options)
    const account = await store.add()
    store.setActive(account.id)
    store.setAutoSwitch(false)
    await store.flush()

    const reloaded = new ClaudeAccountStore(options)
    await reloaded.initialize()
    expect(reloaded.list().map((record) => record.id)).toEqual([DEFAULT_CLAUDE_ACCOUNT_ID, account.id])
    expect(reloaded.getActive().id).toBe(account.id)
    expect(reloaded.getAutoSwitch()).toBe(false)
  })

  test("records why the active account changed", async () => {
    const { options } = await createFixture()
    const store = new ClaudeAccountStore(options)
    const account = await store.add()
    let changes = 0
    store.onChange(() => changes++)

    store.setActive(account.id, "limit")
    store.setActive(account.id, "limit")

    expect(changes).toBe(1)
    expect(store.getLastSwitch()).toEqual({
      fromAccountId: DEFAULT_CLAUDE_ACCOUNT_ID,
      toAccountId: account.id,
      reason: "limit",
      at: 1_000,
    })
  })

  test("removing an account deletes its dir without touching what it linked to", async () => {
    const { sharedConfigDir, options } = await createFixture()
    const store = new ClaudeAccountStore(options)
    const account = await store.add()
    store.setActive(account.id)

    await store.remove(account.id)

    expect(store.getActive().id).toBe(DEFAULT_CLAUDE_ACCOUNT_ID)
    expect(store.list().map((record) => record.id)).toEqual([DEFAULT_CLAUDE_ACCOUNT_ID])
    await expect(lstat(account.configDir!)).rejects.toThrow()
    expect(await readFile(path.join(sharedConfigDir, "projects", "-repo", "session.jsonl"), "utf8")).toBe("{}\n")
    expect(await readFile(path.join(sharedConfigDir, "settings.json"), "utf8")).toBe("{}")
  })

  test("the default account can't be removed", async () => {
    const { options } = await createFixture()
    const store = new ClaudeAccountStore(options)
    await expect(store.remove(DEFAULT_CLAUDE_ACCOUNT_ID)).rejects.toThrow()
  })
})

describe("pickClaudeFailoverAccount", () => {
  const spent = usage([{ id: "five_hour", usedPercent: 100 }])
  const fresh = usage([{ id: "five_hour", usedPercent: 12 }])

  function pick(args: {
    activeAccountId?: string
    statuses?: Record<string, AuthServiceStatus>
    usage: Record<string, ProviderUsageSnapshot | null>
  }) {
    return pickClaudeFailoverAccount({
      accountIds: ["default", "b", "c"],
      activeAccountId: args.activeAccountId ?? "default",
      authStatus: (accountId) => args.statuses?.[accountId] ?? "signed_in",
      usage: (accountId) => args.usage[accountId] ?? null,
      now: Date.parse("2026-09-12T10:00:00.000Z"),
    })
  }

  test("stays on an active account that still has headroom", () => {
    expect(pick({ usage: { default: fresh, b: fresh } })).toBeNull()
  })

  test("moves to the next signed-in account that isn't spent", () => {
    expect(pick({ usage: { default: spent, b: spent, c: fresh } })).toBe("c")
    expect(pick({ statuses: { b: "signed_out" }, usage: { default: spent, b: fresh, c: fresh } })).toBe("c")
  })

  test("wraps around from the end of the list", () => {
    expect(pick({ activeAccountId: "c", usage: { c: spent, default: fresh } })).toBe("default")
  })

  test("treats an account with no usage read as available", () => {
    expect(pick({ usage: { default: spent } })).toBe("b")
  })

  test("stays put when every account is spent", () => {
    expect(pick({ usage: { default: spent, b: spent, c: spent } })).toBeNull()
  })

  test("a model-scoped window doesn't count as the account being spent", () => {
    expect(pick({ usage: { default: usage([{ id: "weekly_scoped:fable", usedPercent: 100 }]) } })).toBeNull()
  })
})
