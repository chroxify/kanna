import { describe, expect, test } from "bun:test"
import {
  deriveProviderAvailability,
  isWindowExhausted,
  resolveAvailableComposerTarget,
  windowModelId,
} from "./usage-availability"
import { PROVIDERS, type AgentProvider, type ProviderUsageSnapshot, type UsageLimitsSnapshot } from "./types"

const NOW = Date.parse("2026-09-10T12:00:00.000Z")
const RECORDED = "2026-09-10T11:00:00.000Z"
const FUTURE = "2026-09-14T05:00:00.000Z"

function window(id: string, usedPercent: number | null, resetsAt: string | null = FUTURE) {
  return { id, label: id, usedPercent, resetsAt, recordedAt: RECORDED, source: "on_demand" as const }
}

function usageFor(
  entries: Partial<Record<AgentProvider, { status?: ProviderUsageSnapshot["status"]; windows: ReturnType<typeof window>[] }>>
): UsageLimitsSnapshot {
  const providers: ProviderUsageSnapshot[] = (Object.keys(entries) as AgentProvider[]).map((provider) => ({
    provider,
    status: entries[provider]?.status ?? "ok",
    plan: null,
    windows: entries[provider]?.windows ?? [],
    credits: null,
    detail: null,
    updatedAt: RECORDED,
  }))
  return { providers }
}

const claudeEntry = PROVIDERS.find((p) => p.id === "claude")!

describe("isWindowExhausted", () => {
  test("100% counts as spent", () => {
    expect(isWindowExhausted(window("seven_day", 100), NOW)).toBe(true)
  })

  test("below 100% does not", () => {
    expect(isWindowExhausted(window("seven_day", 99.4), NOW)).toBe(false)
    expect(isWindowExhausted(window("seven_day", null), NOW)).toBe(false)
  })

  test("a stale 100% whose reset has passed is not spent", () => {
    expect(isWindowExhausted(window("seven_day", 100, "2026-09-09T00:00:00.000Z"), NOW)).toBe(false)
  })

  test("a 100% with no reset time stays spent", () => {
    expect(isWindowExhausted(window("seven_day", 100, null), NOW)).toBe(true)
  })
})

describe("windowModelId", () => {
  test("maps a Claude scoped window to its catalog model", () => {
    expect(windowModelId("claude", "weekly_scoped:fable", claudeEntry.models)).toBe("fable")
    expect(windowModelId("claude", "seven_day_opus", claudeEntry.models)).toBe("opus")
  })

  test("returns null for harness-wide and non-model scopes", () => {
    expect(windowModelId("claude", "five_hour", claudeEntry.models)).toBeNull()
    expect(windowModelId("claude", "seven_day", claudeEntry.models)).toBeNull()
    // A surface scope names no model, so it must not block one.
    expect(windowModelId("claude", "weekly_scoped:oauth_apps", claudeEntry.models)).toBeNull()
  })

  test("maps a Codex model lane by its limit id", () => {
    const codex = PROVIDERS.find((p) => p.id === "codex")!
    expect(windowModelId("codex", "gpt-5.3-codex-spark:primary", codex.models)).toBe("gpt-5.3-codex-spark")
    expect(windowModelId("codex", "codex:primary", codex.models)).toBeNull()
  })
})

describe("deriveProviderAvailability", () => {
  test("separates harness-wide from model-scoped exhaustion", () => {
    const availability = deriveProviderAvailability(
      claudeEntry,
      usageFor({ claude: { windows: [window("five_hour", 13), window("seven_day", 70), window("weekly_scoped:fable", 100)] } }),
      NOW,
    )
    expect(availability.harnessExhausted).toBe(false)
    expect([...availability.exhaustedModels]).toEqual(["fable"])
  })

  test("a spent 5-hour window exhausts the harness", () => {
    const availability = deriveProviderAvailability(
      claudeEntry,
      usageFor({ claude: { windows: [window("five_hour", 100)] } }),
      NOW,
    )
    expect(availability.harnessExhausted).toBe(true)
  })

  test("a read that is not ok never blocks", () => {
    const availability = deriveProviderAvailability(
      claudeEntry,
      usageFor({ claude: { status: "unavailable", windows: [window("five_hour", 100)] } }),
      NOW,
    )
    expect(availability.harnessExhausted).toBe(false)
    expect(availability.exhaustedModels.size).toBe(0)
  })
})

describe("resolveAvailableComposerTarget", () => {
  const base = { providers: PROVIDERS, now: NOW }

  test("leaves an unaffected default alone", () => {
    const target = resolveAvailableComposerTarget({
      ...base,
      provider: "claude",
      model: "fable",
      usage: usageFor({ claude: { windows: [window("seven_day", 70)] } }),
    })
    expect(target).toMatchObject({ provider: "claude", model: "fable", redirectedBy: null })
  })

  test("a spent model moves to the next model on the same harness", () => {
    const target = resolveAvailableComposerTarget({
      ...base,
      provider: "claude",
      model: "fable",
      usage: usageFor({ claude: { windows: [window("weekly_scoped:fable", 100)] } }),
    })
    expect(target).toMatchObject({
      provider: "claude",
      model: "opus",
      redirectedBy: "model_limit",
      requested: { provider: "claude", model: "fable" },
    })
  })

  test("a spent harness moves to the next harness", () => {
    const target = resolveAvailableComposerTarget({
      ...base,
      provider: "claude",
      model: "fable",
      usage: usageFor({ claude: { windows: [window("five_hour", 100)] } }),
    })
    expect(target).toMatchObject({
      provider: "codex",
      model: PROVIDERS.find((p) => p.id === "codex")!.defaultModel,
      redirectedBy: "harness_limit",
      requested: { provider: "claude", model: "fable" },
    })
  })

  test("skips a harness that is spent and one that is not signed in", () => {
    const target = resolveAvailableComposerTarget({
      ...base,
      provider: "claude",
      model: "fable",
      usage: usageFor({
        claude: { windows: [window("seven_day", 100)] },
        codex: { windows: [window("codex:primary", 100)] },
      }),
      unavailableProviders: new Set<AgentProvider>(["cursor"]),
    })
    expect(target.provider).toBe("grok")
    expect(target.redirectedBy).toBe("harness_limit")
  })

  test("falls back to the request when everything is spent", () => {
    const target = resolveAvailableComposerTarget({
      ...base,
      provider: "claude",
      model: "fable",
      usage: usageFor({
        claude: { windows: [window("five_hour", 100)] },
        codex: { windows: [window("codex:primary", 100)] },
        grok: { windows: [window("credits", 100)] },
      }),
      unavailableProviders: new Set<AgentProvider>(["cursor", "pi"]),
    })
    expect(target).toMatchObject({ provider: "claude", model: "fable", redirectedBy: null })
  })

  test("never skips the requested harness merely for being unauthenticated", () => {
    const target = resolveAvailableComposerTarget({
      ...base,
      provider: "claude",
      model: "fable",
      usage: null,
      unavailableProviders: new Set<AgentProvider>(["claude"]),
    })
    expect(target).toMatchObject({ provider: "claude", model: "fable", redirectedBy: null })
  })

  test("no usage data changes nothing", () => {
    const target = resolveAvailableComposerTarget({ ...base, provider: "claude", model: "fable", usage: null })
    expect(target.redirectedBy).toBeNull()
  })
})
