import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  UsageLimitsManager,
  mergeClaudeRateLimitPush,
  mergeCodexRateLimitPush,
  normalizeClaudeUsage,
  normalizeCodexRateLimits,
  normalizeGrokAccountUsage,
} from "./usage-limits"

const NOW = "2026-07-22T10:00:00.000Z"

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

async function createTempFilePath() {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-usage-"))
  tempDirs.push(dir)
  return path.join(dir, "usage-limits.json")
}

describe("normalizeClaudeUsage", () => {
  test("maps windows, extra usage, and plan from a get_usage response", () => {
    const snapshot = normalizeClaudeUsage(
      {
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 42, resets_at: "2026-07-22T14:00:00Z" },
          seven_day: { utilization: 7.4, resets_at: "2026-07-28T08:00:00Z" },
          seven_day_opus: { utilization: null, resets_at: null },
          // Amounts are minor units (cents): 1250 → $12.50, 5000 → $50.00.
          extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1250, utilization: 25, currency: "USD", decimal_places: 2 },
        },
      },
      NOW,
    )

    expect(snapshot.status).toBe("ok")
    expect(snapshot.plan).toBe("max")
    expect(snapshot.windows.map((w) => w.id)).toEqual(["five_hour", "seven_day", "seven_day_opus"])
    expect(snapshot.windows[0]).toMatchObject({
      label: "Current session (5-hour)",
      usedPercent: 42,
      resetsAt: "2026-07-22T14:00:00Z",
      recordedAt: NOW,
      source: "on_demand",
    })
    expect(snapshot.windows[2]?.usedPercent).toBeNull()
    expect(snapshot.credits).toMatchObject({
      label: "Extra usage",
      usedPercent: 25,
      usedAmount: 12.5,
      limitAmount: 50,
      currency: "USD",
      detail: null,
    })
    expect(snapshot.updatedAt).toBe(NOW)
  })

  test("skips non-window keys and scales extra usage amounts (real response shape)", () => {
    const snapshot = normalizeClaudeUsage(
      {
        subscription_type: "team",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 2, resets_at: "2026-07-22T15:59:59+00:00" },
          seven_day: { utilization: 19, resets_at: "2026-07-27T16:59:59+00:00" },
          seven_day_opus: null,
          extra_usage: {
            is_enabled: true,
            monthly_limit: null,
            used_credits: 705180,
            utilization: null,
            currency: "USD",
            decimal_places: 2,
          },
          limits: [{ kind: "session", percent: 2 }],
          spend: { used: { amount_minor: 705180 }, percent: 0, enabled: true },
          member_dashboard_available: false,
        },
      },
      NOW,
    )

    expect(snapshot.windows.map((w) => w.id)).toEqual(["five_hour", "seven_day"])
    // 705180 raw minor units → $7,051.80 (matches the claude.ai dashboard).
    expect(snapshot.credits?.usedAmount).toBeCloseTo(7051.8)
    expect(snapshot.credits?.limitAmount).toBeNull()
    expect(snapshot.credits?.currency).toBe("USD")
  })

  test("unknown window keys are still rendered (dynamic model buckets)", () => {
    const snapshot = normalizeClaudeUsage(
      { rate_limits_available: true, rate_limits: { seven_day_fable: { utilization: 12 } } },
      NOW,
    )
    expect(snapshot.windows).toHaveLength(1)
    expect(snapshot.windows[0]?.label).toBe("Seven Day Fable")
  })

  test("API-key sessions come back unavailable", () => {
    const snapshot = normalizeClaudeUsage({ rate_limits_available: false, rate_limits: null }, NOW)
    expect(snapshot.status).toBe("unavailable")
    expect(snapshot.windows).toHaveLength(0)
  })

  // The model-scoped weekly window (e.g. Fable) exists *only* in the `limits`
  // array: its keyed entry is either null (seven_day_opus) or a rotating
  // codename with no model attached (nimbus_quill).
  test("surfaces the model-scoped window from the limits array", () => {
    const snapshot = normalizeClaudeUsage(
      {
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 13, resets_at: "2026-07-22T14:00:00Z" },
          seven_day: { utilization: 70, resets_at: "2026-07-28T08:00:00Z" },
          seven_day_opus: null,
          nimbus_quill: { utilization: 0, resets_at: null },
          limits: [
            { kind: "session", group: "session", percent: 13, resets_at: "2026-07-22T14:00:00Z" },
            { kind: "weekly_all", group: "weekly", percent: 70, resets_at: "2026-07-28T08:00:00Z" },
            {
              kind: "weekly_scoped",
              group: "weekly",
              percent: 100,
              severity: "critical",
              resets_at: "2026-07-28T08:00:00Z",
              scope: { model: { id: null, display_name: "Fable" }, surface: null },
              is_active: true,
            },
          ],
        },
      },
      NOW,
    )

    expect(snapshot.windows.map((w) => w.id)).toEqual(["five_hour", "seven_day", "weekly_scoped:fable"])
    expect(snapshot.windows[2]).toMatchObject({
      label: "Weekly · Fable",
      usedPercent: 100,
      resetsAt: "2026-07-28T08:00:00Z",
      recordedAt: NOW,
      source: "on_demand",
    })
    // Codename leftovers are dropped; the keyed session/weekly entries the
    // array already covers are not duplicated.
    expect(snapshot.windows.map((w) => w.label)).not.toContain("Nimbus Quill")
  })

  test("keeps a populated keyed window the limits array omits", () => {
    const snapshot = normalizeClaudeUsage(
      {
        rate_limits_available: true,
        rate_limits: {
          seven_day_opus: { utilization: 30, resets_at: null },
          nimbus_quill: { utilization: 0, resets_at: null },
          limits: [{ kind: "weekly_all", group: "weekly", percent: 70 }],
        },
      },
      NOW,
    )

    expect(snapshot.windows.map((w) => w.id)).toEqual(["seven_day", "seven_day_opus"])
  })

  test("scoped entries with nothing to scope to are dropped", () => {
    const snapshot = normalizeClaudeUsage(
      {
        rate_limits_available: true,
        rate_limits: {
          limits: [
            { kind: "weekly_all", group: "weekly", percent: 70 },
            { kind: "weekly_scoped", group: "weekly", percent: 100, scope: { model: null, surface: null } },
          ],
        },
      },
      NOW,
    )

    expect(snapshot.windows.map((w) => w.id)).toEqual(["seven_day"])
  })

  test("labels a surface-scoped window when there is no model", () => {
    const snapshot = normalizeClaudeUsage(
      {
        rate_limits_available: true,
        rate_limits: {
          limits: [
            { kind: "weekly_scoped", group: "weekly", percent: 5, scope: { surface: "oauth_apps" } },
          ],
        },
      },
      NOW,
    )

    expect(snapshot.windows[0]).toMatchObject({ id: "weekly_scoped:oauth_apps", label: "Weekly · Oauth Apps" })
  })

  test("falls back to keyed windows when there is no limits array", () => {
    const snapshot = normalizeClaudeUsage(
      { rate_limits_available: true, rate_limits: { five_hour: { utilization: 42 }, seven_day_fable: { utilization: 12 } } },
      NOW,
    )

    expect(snapshot.windows.map((w) => w.label)).toEqual(["Current session (5-hour)", "Seven Day Fable"])
  })
})

describe("mergeClaudeRateLimitPush", () => {
  test("scales the 0-1 fraction and only touches the binding window", () => {
    const prev = normalizeClaudeUsage(
      {
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 40, resets_at: "2026-07-22T14:00:00Z" },
          seven_day: { utilization: 10, resets_at: "2026-07-28T08:00:00Z" },
        },
      },
      "2026-07-22T09:00:00.000Z",
    )

    const merged = mergeClaudeRateLimitPush(
      prev,
      { status: "allowed", rateLimitType: "five_hour", utilization: 0.55, resetsAt: 1784736000 },
      NOW,
    )

    const fiveHour = merged.windows.find((w) => w.id === "five_hour")
    expect(fiveHour?.usedPercent).toBeCloseTo(55)
    expect(fiveHour?.recordedAt).toBe(NOW)
    expect(fiveHour?.source).toBe("turn_push")
    // Untouched window keeps its older recordedAt (honest staleness).
    const sevenDay = merged.windows.find((w) => w.id === "seven_day")
    expect(sevenDay?.usedPercent).toBe(10)
    expect(sevenDay?.recordedAt).toBe("2026-07-22T09:00:00.000Z")
    expect(merged.updatedAt).toBe(NOW)
  })

  test("creates the window when there is no previous snapshot", () => {
    const merged = mergeClaudeRateLimitPush(null, { rateLimitType: "seven_day", utilization: 0.2 }, NOW)
    expect(merged.windows).toHaveLength(1)
    expect(merged.windows[0]).toMatchObject({ id: "seven_day", usedPercent: 20 })
  })

  test("ignores overage-only pushes", () => {
    const merged = mergeClaudeRateLimitPush(null, { rateLimitType: "overage", utilization: 0.5 }, NOW)
    expect(merged.windows).toHaveLength(0)
  })

  test("ignores a push for a window the full read drops (rotating codename)", () => {
    const prev = normalizeClaudeUsage(
      {
        rate_limits_available: true,
        rate_limits: { limits: [{ kind: "weekly_all", group: "weekly", percent: 70 }] },
      },
      NOW,
    )

    const merged = mergeClaudeRateLimitPush(
      prev,
      { rateLimitType: "nimbus_quill" as never, utilization: 0.4 },
      "2026-07-22T11:00:00.000Z",
    )

    expect(merged.windows.map((w) => w.id)).toEqual(["seven_day"])
  })

  test("still merges a push for a window already on the snapshot", () => {
    const prev = normalizeClaudeUsage(
      {
        rate_limits_available: true,
        rate_limits: { limits: [{ kind: "weekly_all", group: "weekly", percent: 70 }] },
      },
      NOW,
    )

    const merged = mergeClaudeRateLimitPush(
      prev,
      { rateLimitType: "seven_day", utilization: 0.85 },
      "2026-07-22T11:00:00.000Z",
    )

    expect(merged.windows[0]).toMatchObject({ id: "seven_day", usedPercent: 85, source: "turn_push" })
  })
})

describe("normalizeCodexRateLimits", () => {
  test("maps primary/secondary windows, credits, and plan", () => {
    const snapshot = normalizeCodexRateLimits(
      {
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1784736000 },
          secondary: { usedPercent: 61.5, windowDurationMins: 10080, resetsAt: 1785168000 },
          credits: { hasCredits: true, unlimited: false, balance: "$4.20" },
          planType: "pro",
        },
      },
      NOW,
    )

    expect(snapshot.status).toBe("ok")
    expect(snapshot.plan).toBe("pro")
    expect(snapshot.windows).toHaveLength(2)
    expect(snapshot.windows[0]).toMatchObject({
      id: "codex:primary",
      label: "5-hour",
      usedPercent: 28,
      resetsAt: new Date(1784736000 * 1000).toISOString(),
    })
    expect(snapshot.windows[1]).toMatchObject({ id: "codex:secondary", label: "Weekly", usedPercent: 61.5 })
    expect(snapshot.credits).toMatchObject({ label: "Credits", detail: "$4.20" })
  })

  test("multiple limit buckets get suffixed labels", () => {
    const snapshot = normalizeCodexRateLimits(
      {
        rateLimitsByLimitId: {
          codex: { primary: { usedPercent: 10, windowDurationMins: 300 } },
          spark: { limitName: "Fast lane", primary: { usedPercent: 90, windowDurationMins: 300 } },
        },
      },
      NOW,
    )
    expect(snapshot.windows.map((w) => w.label)).toEqual(["5-hour · All models", "5-hour · Fast lane"])
  })

  test("model-id limit names run through the shared model-label formatter", () => {
    const snapshot = normalizeCodexRateLimits(
      {
        rateLimitsByLimitId: {
          codex: { primary: { usedPercent: 0, windowDurationMins: 10080 } },
          codex_bengalfox: { limitName: "GPT-5.3-Codex-Spark", primary: { usedPercent: 0, windowDurationMins: 10080 } },
        },
      },
      NOW,
    )
    expect(snapshot.windows.map((w) => w.label)).toEqual([
      "Weekly · All models",
      "Weekly · GPT 5.3 Codex Spark",
    ])
  })

  test("empty response is unavailable", () => {
    expect(normalizeCodexRateLimits({}, NOW).status).toBe("unavailable")
    expect(normalizeCodexRateLimits(null, NOW).status).toBe("unavailable")
  })
})

describe("mergeCodexRateLimitPush", () => {
  test("overlays pushed windows onto the previous full read", () => {
    const prev = normalizeCodexRateLimits(
      {
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1784736000 },
          secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 1785168000 },
        },
      },
      "2026-07-22T09:00:00.000Z",
    )
    const merged = mergeCodexRateLimitPush(
      prev,
      { limitId: "codex", primary: { usedPercent: 33, windowDurationMins: 300, resetsAt: 1784736000 } },
      NOW,
    )
    const primary = merged.windows.find((w) => w.id === "codex:primary")
    expect(primary?.usedPercent).toBe(33)
    expect(primary?.source).toBe("turn_push")
    // Secondary omitted from the push keeps the older read.
    const secondary = merged.windows.find((w) => w.id === "codex:secondary")
    expect(secondary?.usedPercent).toBe(5)
    expect(secondary?.recordedAt).toBe("2026-07-22T09:00:00.000Z")
  })
})

describe("normalizeGrokAccountUsage", () => {
  test("maps weekly product lanes and subscription tier", () => {
    const snapshot = normalizeGrokAccountUsage(
      {
        user: { subscriptionTier: "XPremiumPlus", email: "a@b.com" },
        billing: {
          config: {
            currentPeriod: { end: "2026-09-12T00:00:00Z" },
            creditUsagePercent: 6,
            productUsage: [
              { product: "GrokBuild", usagePercent: 4 },
              { product: "GrokChat", usagePercent: 1 },
            ],
            onDemandCap: { val: 0 },
            onDemandUsed: { val: 0 },
            prepaidBalance: { val: 0 },
          },
        },
      },
      NOW,
    )
    expect(snapshot.status).toBe("ok")
    expect(snapshot.plan).toBe("XPremiumPlus")
    expect(snapshot.windows.map((window) => window.id)).toEqual(["credits", "GrokBuild", "GrokChat"])
    expect(snapshot.windows[1]).toMatchObject({
      label: "Weekly · Grok Build",
      usedPercent: 4,
      resetsAt: "2026-09-12T00:00:00Z",
    })
    expect(snapshot.credits).toBeNull()
  })
})

describe("UsageLimitsManager", () => {
  test("refresh applies both providers, emits, and persists", async () => {
    const filePath = await createTempFilePath()
    const manager = new UsageLimitsManager(filePath, {
      now: () => new Date(NOW),
      fetchClaudeUsage: async () => ({
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: { five_hour: { utilization: 42, resets_at: "2026-07-22T14:00:00Z" } },
      }),
      fetchCodexRateLimits: async () => ({
        rateLimits: { limitId: "codex", primary: { usedPercent: 28, windowDurationMins: 300 } },
      }),
    })
    await manager.initialize()

    let emitted = 0
    manager.onChange(() => {
      emitted += 1
    })
    await manager.refresh()

    const snapshot = manager.getSnapshot()
    expect(snapshot.providers.map((p) => p.provider)).toEqual(["claude", "codex", "cursor", "grok", "pi"])
    expect(snapshot.providers[0]?.status).toBe("ok")
    expect(snapshot.providers[1]?.status).toBe("ok")
    expect(snapshot.providers[2]?.status).toBe("unavailable")
    expect(snapshot.providers[3]?.status).toBe("unknown")
    expect(snapshot.providers[4]?.status).toBe("not_applicable")
    expect(emitted).toBeGreaterThanOrEqual(2)

    const persisted = JSON.parse(await readFile(filePath, "utf8"))
    expect(persisted.providers.claude.windows).toHaveLength(1)
    manager.dispose()
  })

  test("initialize restores the persisted snapshot marked as cache", async () => {
    const filePath = await createTempFilePath()
    const writer = new UsageLimitsManager(filePath, {
      now: () => new Date(NOW),
      fetchClaudeUsage: async () => ({
        rate_limits_available: true,
        rate_limits: { five_hour: { utilization: 42, resets_at: "2026-07-22T14:00:00Z" } },
      }),
    })
    await writer.initialize()
    await writer.refresh()
    writer.dispose()

    const reader = new UsageLimitsManager(filePath)
    await reader.initialize()
    const claude = reader.getSnapshot().providers.find((p) => p.provider === "claude")
    expect(claude?.windows).toHaveLength(1)
    expect(claude?.windows[0]).toMatchObject({ usedPercent: 42, recordedAt: NOW, source: "cache" })
    reader.dispose()
  })

  test("a failed refresh keeps last-known windows instead of wiping them", async () => {
    const filePath = await createTempFilePath()
    let fail = false
    const manager = new UsageLimitsManager(filePath, {
      now: () => new Date(NOW),
      fetchClaudeUsage: async () => {
        if (fail) throw new Error("probe timed out")
        return {
          rate_limits_available: true,
          rate_limits: { five_hour: { utilization: 42, resets_at: "2026-07-22T14:00:00Z" } },
        }
      },
    })
    await manager.initialize()
    await manager.refresh()
    fail = true
    await manager.refresh({ force: true })

    const claude = manager.getSnapshot().providers.find((p) => p.provider === "claude")
    expect(claude?.windows).toHaveLength(1)
    expect(claude?.windows[0]?.usedPercent).toBe(42)
    expect(claude?.detail).toContain("probe timed out")
    manager.dispose()
  })

  test("non-forced refresh is throttled by TTL; force bypasses it", async () => {
    const filePath = await createTempFilePath()
    let fetches = 0
    const manager = new UsageLimitsManager(filePath, {
      now: () => new Date(NOW),
      fetchClaudeUsage: async () => {
        fetches += 1
        return { rate_limits_available: true, rate_limits: { five_hour: { utilization: 1 } } }
      },
    })
    await manager.initialize()

    await manager.refresh()
    await manager.refresh() // within TTL → skipped
    expect(fetches).toBe(1)
    await manager.refresh({ force: true })
    expect(fetches).toBe(2)
    manager.dispose()
  })

  test("pushed events update state without a prior full read", async () => {
    const filePath = await createTempFilePath()
    const manager = new UsageLimitsManager(filePath, { now: () => new Date(NOW) })
    await manager.initialize()

    manager.recordClaudeRateLimitPush({ rateLimitType: "five_hour", utilization: 0.42, resetsAt: 1784736000 })
    manager.recordCodexRateLimitPush({ limitId: "codex", primary: { usedPercent: 12, windowDurationMins: 300 } })

    const snapshot = manager.getSnapshot()
    const claude = snapshot.providers.find((p) => p.provider === "claude")
    const codex = snapshot.providers.find((p) => p.provider === "codex")
    expect(claude?.windows[0]).toMatchObject({ id: "five_hour", usedPercent: 42, source: "turn_push" })
    expect(codex?.windows[0]).toMatchObject({ id: "codex:primary", usedPercent: 12, source: "turn_push" })
    manager.dispose()
  })
})
