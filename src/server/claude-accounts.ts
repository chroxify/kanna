import { randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, readFile, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { LOG_PREFIX } from "../shared/branding"
import type { AuthServiceStatus, ClaudeAccountSwitch, ProviderUsageSnapshot } from "../shared/types"
import { isHarnessExhausted } from "../shared/usage-availability"

/**
 * Several Claude subscriptions on one machine.
 *
 * Claude Code keys everything it stores — the OAuth login included — on its
 * config directory: `CLAUDE_CONFIG_DIR` (default `~/.claude`), with the macOS
 * Keychain entry named after a hash of that path and the Linux credentials
 * file living inside it. So an account here is just a config directory, and a
 * session runs on an account by starting with that directory in its env.
 *
 * The default account is Claude Code's own directory, untouched. Every other
 * account gets a directory under Kanna's data dir whose entries are symlinks
 * back into the default one — settings, CLAUDE.md, skills, plugins, hooks and,
 * crucially, `projects/`, where session transcripts live. Only the login and
 * `.claude.json` (which holds the signed-in account) are the account's own.
 * Sharing `projects/` is what lets a chat resume its session after it moves to
 * another account.
 */

export const DEFAULT_CLAUDE_ACCOUNT_ID = "default"

/** Entries of the shared config dir that belong to one login and are never linked. */
const ACCOUNT_OWNED_ENTRIES = new Set([
  ".claude.json",
  ".config.json",
  ".credentials.json",
  "backups",
  "statsig",
  "stats-cache.json",
  ".DS_Store",
])

/**
 * Keys copied from the shared `.claude.json` into a new account's own. A
 * whitelist, because the file mixes user config with the signed-in account
 * (`oauthAccount`) and dozens of per-account caches.
 */
const SEEDED_GLOBAL_CONFIG_KEYS = [
  "mcpServers",
  "projects",
  "theme",
  "autoUpdates",
  "installMethod",
  "hasCompletedOnboarding",
  "lastOnboardingVersion",
  "githubRepoPaths",
] as const

export interface ClaudeAccountRecord {
  id: string
  /** null for the default account: Claude Code's own config dir. */
  configDir: string | null
  createdAt: number
}

interface ClaudeAccountsFile {
  version?: number
  activeAccountId?: unknown
  autoSwitch?: unknown
  accounts?: unknown
}

export interface ClaudeAccountStoreOptions {
  /** Where the registry lives (`claude-accounts.json`). */
  filePath: string
  /** Parent of the per-account config dirs. */
  accountsDir: string
  /** The config dir Claude Code uses without Kanna: `$CLAUDE_CONFIG_DIR` or `~/.claude`. */
  sharedConfigDir?: string
  /** The shared `.claude.json`. */
  sharedGlobalConfigPath?: string
  now?: () => number
}

export function defaultSharedClaudeConfigDir(env: NodeJS.ProcessEnv = process.env) {
  return env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), ".claude")
}

export function defaultSharedClaudeGlobalConfigPath(env: NodeJS.ProcessEnv = process.env) {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim()
  return configDir ? path.join(configDir, ".claude.json") : path.join(homedir(), ".claude.json")
}

export class ClaudeAccountStore {
  private readonly options: Required<Omit<ClaudeAccountStoreOptions, "now">> & { now: () => number }
  private accounts: ClaudeAccountRecord[] = [defaultRecord()]
  private activeAccountId = DEFAULT_CLAUDE_ACCOUNT_ID
  private autoSwitch = true
  private lastSwitch: ClaudeAccountSwitch | null = null
  private readonly listeners = new Set<() => void>()
  private persistChain: Promise<void> = Promise.resolve()

  constructor(options: ClaudeAccountStoreOptions) {
    this.options = {
      sharedConfigDir: defaultSharedClaudeConfigDir(),
      sharedGlobalConfigPath: defaultSharedClaudeGlobalConfigPath(),
      now: Date.now,
      ...options,
    }
  }

  async initialize() {
    try {
      const text = await readFile(this.options.filePath, "utf8")
      if (!text.trim()) return
      const parsed = JSON.parse(text) as ClaudeAccountsFile
      const records = Array.isArray(parsed.accounts) ? parsed.accounts.flatMap(parseRecord) : []
      this.accounts = [defaultRecord(), ...records.filter((record) => record.id !== DEFAULT_CLAUDE_ACCOUNT_ID)]
      if (typeof parsed.activeAccountId === "string" && this.find(parsed.activeAccountId)) {
        this.activeAccountId = parsed.activeAccountId
      }
      if (typeof parsed.autoSwitch === "boolean") this.autoSwitch = parsed.autoSwitch
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        console.warn(`${LOG_PREFIX} Failed to load Claude accounts:`, error)
      }
    }
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  list(): readonly ClaudeAccountRecord[] {
    return this.accounts
  }

  find(accountId: string): ClaudeAccountRecord | null {
    return this.accounts.find((account) => account.id === accountId) ?? null
  }

  getActive(): ClaudeAccountRecord {
    return this.find(this.activeAccountId) ?? this.accounts[0]!
  }

  getAutoSwitch() {
    return this.autoSwitch
  }

  getLastSwitch() {
    return this.lastSwitch
  }

  /** Env overrides that put a Claude Code process on this account. */
  envFor(accountId: string): Record<string, string> {
    const account = this.find(accountId)
    return account?.configDir ? { CLAUDE_CONFIG_DIR: account.configDir } : {}
  }

  async add(): Promise<ClaudeAccountRecord> {
    const id = randomUUID().slice(0, 8)
    const record: ClaudeAccountRecord = {
      id,
      configDir: path.join(this.options.accountsDir, id),
      createdAt: this.options.now(),
    }
    await mkdir(record.configDir!, { recursive: true })
    await this.seedGlobalConfig(record.configDir!)
    await this.linkSharedEntries(record)
    this.accounts = [...this.accounts, record]
    this.changed()
    return record
  }

  async remove(accountId: string) {
    if (accountId === DEFAULT_CLAUDE_ACCOUNT_ID) {
      throw new Error("The default Claude account can't be removed.")
    }
    const record = this.find(accountId)
    if (!record) return
    this.accounts = this.accounts.filter((account) => account.id !== accountId)
    if (this.activeAccountId === accountId) this.activeAccountId = DEFAULT_CLAUDE_ACCOUNT_ID
    this.changed()
    if (record.configDir) await removeAccountDir(record.configDir)
  }

  setActive(accountId: string, reason: ClaudeAccountSwitch["reason"] = "manual") {
    if (!this.find(accountId)) throw new Error("Unknown Claude account.")
    if (this.activeAccountId === accountId) return
    this.lastSwitch = { fromAccountId: this.activeAccountId, toAccountId: accountId, reason, at: this.options.now() }
    this.activeAccountId = accountId
    this.changed()
  }

  setAutoSwitch(enabled: boolean) {
    if (this.autoSwitch === enabled) return
    this.autoSwitch = enabled
    this.changed()
  }

  /**
   * Link whatever the shared config dir has gained since the account was
   * created (a new skills folder, a first `plugins/`). Cheap enough to run
   * before every session start on a non-default account.
   */
  async linkSharedEntries(record: ClaudeAccountRecord) {
    if (!record.configDir) return
    let entries: string[]
    try {
      entries = await readdir(this.options.sharedConfigDir)
    } catch {
      return
    }
    await Promise.all(entries.map(async (entry) => {
      if (ACCOUNT_OWNED_ENTRIES.has(entry)) return
      const linkPath = path.join(record.configDir!, entry)
      try {
        await lstat(linkPath)
        return
      } catch {
        // Not there yet: link it.
      }
      try {
        await symlink(path.join(this.options.sharedConfigDir, entry), linkPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
          console.warn(`${LOG_PREFIX} Failed to link ${entry} into Claude account ${record.id}:`, error)
        }
      }
    }))
  }

  private async seedGlobalConfig(configDir: string) {
    let shared: Record<string, unknown> = {}
    try {
      shared = JSON.parse(await readFile(this.options.sharedGlobalConfigPath, "utf8")) as Record<string, unknown>
    } catch {
      // No shared config yet: the account starts with Claude Code's defaults.
    }
    const seeded: Record<string, unknown> = {}
    for (const key of SEEDED_GLOBAL_CONFIG_KEYS) {
      if (shared[key] !== undefined) seeded[key] = shared[key]
    }
    await writeFile(path.join(configDir, ".claude.json"), `${JSON.stringify(seeded, null, 2)}\n`, { flag: "wx" })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error
      })
  }

  private changed() {
    this.persistChain = this.persistChain.then(() => this.persist())
    for (const listener of this.listeners) listener()
  }

  /** Resolves once every change so far is on disk. */
  flush() {
    return this.persistChain
  }

  private async persist() {
    const file = {
      version: 1,
      activeAccountId: this.activeAccountId,
      autoSwitch: this.autoSwitch,
      accounts: this.accounts.filter((account) => account.id !== DEFAULT_CLAUDE_ACCOUNT_ID),
    }
    try {
      await mkdir(path.dirname(this.options.filePath), { recursive: true })
      await writeFile(this.options.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8")
    } catch (error) {
      console.warn(`${LOG_PREFIX} Failed to persist Claude accounts:`, error)
    }
  }
}

/**
 * The account to fall over to when the active one has spent a harness-wide
 * window, or null to stay put. Candidates are tried in registry order starting
 * after the active account, and must be signed in and not spent themselves.
 * An account whose usage has never been read counts as available: it fails
 * open, like the rest of the availability rules, and the switch's own read
 * settles it.
 */
export function pickClaudeFailoverAccount(args: {
  accountIds: readonly string[]
  activeAccountId: string
  authStatus: (accountId: string) => AuthServiceStatus
  usage: (accountId: string) => ProviderUsageSnapshot | null
  now: number
}): string | null {
  const { accountIds, activeAccountId, now } = args
  if (!isHarnessExhausted("claude", args.usage(activeAccountId), now)) return null
  const start = accountIds.indexOf(activeAccountId)
  for (let offset = 1; offset < accountIds.length; offset++) {
    const candidate = accountIds[(start + offset + accountIds.length) % accountIds.length]!
    if (candidate === activeAccountId) continue
    if (args.authStatus(candidate) !== "signed_in") continue
    if (isHarnessExhausted("claude", args.usage(candidate), now)) continue
    return candidate
  }
  return null
}

function defaultRecord(): ClaudeAccountRecord {
  return { id: DEFAULT_CLAUDE_ACCOUNT_ID, configDir: null, createdAt: 0 }
}

function parseRecord(value: unknown): ClaudeAccountRecord[] {
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string" || typeof record.configDir !== "string") return []
  return [{
    id: record.id,
    configDir: record.configDir,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
  }]
}

/**
 * Delete an account's config dir without ever following a link into the
 * shared one: links are unlinked first, and only then is what is left (the
 * account's own `.claude.json`, its backups) removed.
 */
async function removeAccountDir(configDir: string) {
  let entries: string[]
  try {
    entries = await readdir(configDir)
  } catch {
    return
  }
  for (const entry of entries) {
    const entryPath = path.join(configDir, entry)
    const info = await lstat(entryPath).catch(() => null)
    if (!info) continue
    if (info.isSymbolicLink()) {
      await unlink(entryPath)
    } else {
      await rm(entryPath, { recursive: true, force: true })
    }
  }
  await rmdir(configDir).catch(() => undefined)
}
