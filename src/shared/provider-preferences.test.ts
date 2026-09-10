import { describe, expect, test } from "bun:test"
import {
  createDefaultProviderDefaults,
  getProviderModelDefault,
  mergeProviderDefaultsPatch,
  normalizeClaudePreference,
  normalizeCodexPreference,
  resolveProviderModelOptions,
} from "./provider-preferences"
import type { ChatProviderPreferences, ClaudeModelOptions, ProviderPreference } from "./types"

describe("per-model defaults normalization", () => {
  test("normalizes each entry against its own model, not the provider's default one", () => {
    const preference = normalizeClaudePreference({
      model: "sonnet",
      modelDefaults: {
        // Only the Opus family offers max effort; Sonnet's entry clamps to high
        // even though the raw value is identical.
        opus: { reasoningEffort: "max" },
        sonnet: { reasoningEffort: "max" },
      },
    })

    expect(preference.modelDefaults.opus?.reasoningEffort).toBe("max")
    expect(preference.modelDefaults.sonnet?.reasoningEffort).toBe("high")
  })

  test("fills options a stored entry is missing", () => {
    const preference = normalizeClaudePreference({
      modelDefaults: { opus: { reasoningEffort: "low" } },
    })

    expect(preference.modelDefaults.opus).toEqual({
      reasoningEffort: "low",
      contextWindow: "1m",
      fastMode: false,
    })
  })

  test("clamps a Codex entry to the effort list of that model", () => {
    const preference = normalizeCodexPreference({
      model: "gpt-5.6-sol",
      modelDefaults: {
        // gpt-5.3-codex tops out at xhigh, so ultra snaps to its nearest.
        "gpt-5.3-codex": { reasoningEffort: "ultra" },
        "gpt-5.6-sol": { reasoningEffort: "ultra" },
      },
    })

    expect(preference.modelDefaults["gpt-5.3-codex"]?.reasoningEffort).toBe("xhigh")
    expect(preference.modelDefaults["gpt-5.6-sol"]?.reasoningEffort).toBe("ultra")
  })

  test("drops entries from settings JSON that are not model options", () => {
    const preference = normalizeClaudePreference({
      modelDefaults: {
        "  ": { reasoningEffort: "low" },
        opus: null,
        sonnet: "high",
        haiku: { reasoningEffort: "low" },
      },
    })

    expect(Object.keys(preference.modelDefaults)).toEqual(["haiku"])
  })

  test("defaults to no per-model entries", () => {
    expect(createDefaultProviderDefaults().claude.modelDefaults).toEqual({})
  })
})

describe("resolveProviderModelOptions", () => {
  test("prefers a model's own saved options", () => {
    const preference = normalizeClaudePreference({
      model: "sonnet",
      modelOptions: { reasoningEffort: "high" },
      modelDefaults: { opus: { reasoningEffort: "medium" } },
    })

    expect(resolveProviderModelOptions("claude", preference, "opus").reasoningEffort).toBe("medium")
  })

  test("falls back to the provider defaults, re-normalized for the model", () => {
    const preference = normalizeClaudePreference({
      model: "opus",
      modelOptions: { reasoningEffort: "max" },
    })

    expect(resolveProviderModelOptions("claude", preference, "opus").reasoningEffort).toBe("max")
    // Sonnet has no entry and no max effort, so it lands on the clamped fallback.
    expect(resolveProviderModelOptions("claude", preference, "sonnet").reasoningEffort).toBe("high")
  })

  test("tolerates a preference from a server that predates per-model defaults", () => {
    const legacy = {
      model: "opus",
      modelOptions: { reasoningEffort: "high", contextWindow: "1m", fastMode: false },
      planMode: false,
      autoPlan: false,
    } as unknown as ProviderPreference<ClaudeModelOptions>

    expect(getProviderModelDefault(legacy, "opus")).toBeUndefined()
    expect(resolveProviderModelOptions("claude", legacy, "opus").reasoningEffort).toBe("high")
  })
})

describe("mergeProviderDefaultsPatch model defaults", () => {
  function baseDefaults(): ChatProviderPreferences {
    return {
      ...createDefaultProviderDefaults(),
      claude: normalizeClaudePreference({
        model: "sonnet",
        modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
        modelDefaults: { opus: { reasoningEffort: "medium", contextWindow: "200k" } },
      }),
    }
  }

  test("a new model's entry starts from the provider defaults", () => {
    const merged = mergeProviderDefaultsPatch(baseDefaults(), {
      claude: { modelDefaults: { haiku: { reasoningEffort: "low" } } },
    })

    expect(merged.claude.modelDefaults.haiku).toEqual({
      reasoningEffort: "low",
      contextWindow: "200k",
      fastMode: false,
    })
  })

  test("patches an existing entry field by field and leaves other models alone", () => {
    const merged = mergeProviderDefaultsPatch(baseDefaults(), {
      claude: { modelDefaults: { opus: { fastMode: true } } },
    })

    expect(merged.claude.modelDefaults.opus).toEqual({
      reasoningEffort: "medium",
      contextWindow: "200k",
      fastMode: true,
    })
    expect(merged.claude.model).toBe("sonnet")
  })

  test("null clears a model so it follows the provider defaults again", () => {
    const merged = mergeProviderDefaultsPatch(baseDefaults(), {
      claude: { modelDefaults: { opus: null } },
    })

    expect(merged.claude.modelDefaults).toEqual({})
    expect(resolveProviderModelOptions("claude", merged.claude, "opus").reasoningEffort).toBe("high")
  })

  test("a patch without modelDefaults keeps the saved entries", () => {
    const merged = mergeProviderDefaultsPatch(baseDefaults(), {
      claude: { modelOptions: { reasoningEffort: "low" } },
    })

    expect(merged.claude.modelDefaults.opus?.reasoningEffort).toBe("medium")
  })
})
