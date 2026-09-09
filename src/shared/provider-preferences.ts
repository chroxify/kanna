import {
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  DEFAULT_CURSOR_MODEL_OPTIONS,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  isGrokReasoningEffort,
  isPiReasoningEffort,
  normalizeClaudeContextWindow,
  normalizeClaudeFastMode,
  normalizeClaudeModelId,
  normalizeCodexModelId,
  normalizeCodexReasoningEffort,
  normalizeCursorModelId,
  normalizeGrokModelId,
  normalizeGrokReasoningEffort,
  normalizePiModelId,
  normalizePiReasoningEffort,
  supportsClaudeMaxReasoningEffort,
  type AgentProvider,
  type ChatProviderPreferences,
  type ClaudeModelOptions,
  type CodexModelOptions,
  type CursorModelOptions,
  type GrokModelOptions,
  type ModelDefaultsPatch,
  type PiModelOptions,
  type ProviderDefaultsPatch,
  type ProviderModelOptionsByProvider,
  type ProviderPreference,
} from "./types"

// The single home for provider-preference normalization, shared by the server
// (settings file JSON in app-settings.ts) and the client (persisted composer
// state in chatPreferencesStore.ts, optimistic patches in appSettingsStore.ts).

/**
 * Loose model-options shape accepted by the provider preference normalizers.
 * Fields are `unknown` because inputs range from typed ProviderPreference
 * values to raw JSON read off disk; each normalizer validates what it uses.
 */
export type ProviderModelOptionsInput = {
  reasoningEffort?: unknown
  contextWindow?: unknown
  fastMode?: unknown
}

/**
 * Loose provider preference shape accepted by the normalizers: current
 * ProviderPreference values, persisted composer states, legacy persisted
 * shapes (with a top-level `effort`), and untrusted settings-file JSON are
 * all assignable to it.
 */
export type ProviderPreferenceInput = {
  model?: unknown
  effort?: unknown
  modelOptions?: ProviderModelOptionsInput
  modelDefaults?: unknown
  planMode?: unknown
  autoPlan?: unknown
}

function modelIdFromInput(value?: ProviderPreferenceInput): string | undefined {
  return typeof value?.model === "string" ? value.model : undefined
}

// Model options are normalized *for a model id*: the same raw options mean
// different things on different models (Claude's "max" effort, the 200k/1m
// window, fast-mode support, each Codex model's own effort list). Splitting
// this out of the preference normalizers lets the per-model defaults map reuse
// exactly the same clamps, keyed by its own model id rather than the
// provider's default one.

export function normalizeClaudeModelOptions(
  model: string,
  value?: ProviderModelOptionsInput,
  legacyEffort?: unknown,
): ClaudeModelOptions {
  const reasoningEffort = value?.reasoningEffort
  const normalizedEffort = isClaudeReasoningEffort(reasoningEffort)
    ? reasoningEffort
    : isClaudeReasoningEffort(legacyEffort)
      ? legacyEffort
      : DEFAULT_CLAUDE_MODEL_OPTIONS.reasoningEffort

  return {
    reasoningEffort: !supportsClaudeMaxReasoningEffort(model) && normalizedEffort === "max" ? "high" : normalizedEffort,
    contextWindow: normalizeClaudeContextWindow(model, value?.contextWindow),
    fastMode: normalizeClaudeFastMode(model, value?.fastMode),
  }
}

export function normalizeCodexModelOptions(
  model: string,
  value?: ProviderModelOptionsInput,
  legacyEffort?: unknown,
): CodexModelOptions {
  const reasoningEffort = value?.reasoningEffort
  return {
    reasoningEffort: normalizeCodexReasoningEffort(
      model,
      isCodexReasoningEffort(reasoningEffort) ? reasoningEffort : legacyEffort,
    ),
    fastMode: typeof value?.fastMode === "boolean" ? value.fastMode : DEFAULT_CODEX_MODEL_OPTIONS.fastMode,
  }
}

export function normalizeCursorModelOptions(_model: string, value?: ProviderModelOptionsInput): CursorModelOptions {
  return {
    fastMode: typeof value?.fastMode === "boolean" ? value.fastMode : DEFAULT_CURSOR_MODEL_OPTIONS.fastMode,
  }
}

export function normalizePiModelOptions(
  _model: string,
  value?: ProviderModelOptionsInput,
  legacyEffort?: unknown,
): PiModelOptions {
  const reasoningEffort = value?.reasoningEffort
  return {
    reasoningEffort: normalizePiReasoningEffort(
      isPiReasoningEffort(reasoningEffort) ? reasoningEffort : legacyEffort,
    ),
  }
}

export function normalizeGrokModelOptions(
  _model: string,
  value?: ProviderModelOptionsInput,
  legacyEffort?: unknown,
): GrokModelOptions {
  const reasoningEffort = value?.reasoningEffort
  return {
    reasoningEffort: normalizeGrokReasoningEffort(
      isGrokReasoningEffort(reasoningEffort) ? reasoningEffort : legacyEffort,
    ),
  }
}

/**
 * Per-provider model-options normalizers, keyed by provider so a new provider
 * has to declare one instead of silently reusing another's clamps.
 */
export const PROVIDER_MODEL_OPTIONS_NORMALIZERS: {
  [TProvider in AgentProvider]: (
    model: string,
    value?: ProviderModelOptionsInput,
    legacyEffort?: unknown,
  ) => ProviderModelOptionsByProvider[TProvider]
} = {
  claude: normalizeClaudeModelOptions,
  codex: normalizeCodexModelOptions,
  cursor: normalizeCursorModelOptions,
  grok: normalizeGrokModelOptions,
  pi: normalizePiModelOptions,
}

export function normalizeProviderModelOptions<TProvider extends AgentProvider>(
  provider: TProvider,
  model: string,
  value?: ProviderModelOptionsInput,
): ProviderModelOptionsByProvider[TProvider] {
  return PROVIDER_MODEL_OPTIONS_NORMALIZERS[provider](model, value)
}

/**
 * Normalizes the per-model defaults map: untrusted JSON keys become model ids,
 * each value is normalized against *its own* model. Entries with a blank id or
 * a non-object value are dropped.
 */
function normalizeModelDefaults<TProvider extends AgentProvider>(
  provider: TProvider,
  value: unknown,
): Record<string, ProviderModelOptionsByProvider[TProvider]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  const entries: Array<[string, ProviderModelOptionsByProvider[TProvider]]> = []
  for (const [modelId, options] of Object.entries(value as Record<string, unknown>)) {
    const trimmed = modelId.trim()
    if (!trimmed) continue
    if (!options || typeof options !== "object" || Array.isArray(options)) continue
    entries.push([trimmed, normalizeProviderModelOptions(provider, trimmed, options as ProviderModelOptionsInput)])
  }
  return Object.fromEntries(entries)
}

export function normalizeClaudePreference(value?: ProviderPreferenceInput): ProviderPreference<ClaudeModelOptions> {
  const model = normalizeClaudeModelId(modelIdFromInput(value))

  return {
    model,
    modelOptions: normalizeClaudeModelOptions(model, value?.modelOptions, value?.effort),
    modelDefaults: normalizeModelDefaults("claude", value?.modelDefaults),
    planMode: value?.planMode === true,
    // Absent (older settings files / persisted composer state) means Full
    // Access, which is the intended default — nobody is silently left in the
    // legacy Auto Plan behaviour.
    autoPlan: value?.autoPlan === true,
  }
}

export function normalizeCodexPreference(value?: ProviderPreferenceInput): ProviderPreference<CodexModelOptions> {
  const model = normalizeCodexModelId(modelIdFromInput(value))
  return {
    model,
    modelOptions: normalizeCodexModelOptions(model, value?.modelOptions, value?.effort),
    modelDefaults: normalizeModelDefaults("codex", value?.modelDefaults),
    planMode: value?.planMode === true,
    autoPlan: false,
  }
}

export function normalizeCursorPreference(value?: ProviderPreferenceInput): ProviderPreference<CursorModelOptions> {
  const model = normalizeCursorModelId(modelIdFromInput(value))
  return {
    model,
    modelOptions: normalizeCursorModelOptions(model, value?.modelOptions),
    modelDefaults: normalizeModelDefaults("cursor", value?.modelDefaults),
    planMode: false,
    autoPlan: false,
  }
}

export function normalizePiPreference(value?: ProviderPreferenceInput): ProviderPreference<PiModelOptions> {
  const model = normalizePiModelId(value?.model)
  return {
    model,
    modelOptions: normalizePiModelOptions(model, value?.modelOptions, value?.effort),
    modelDefaults: normalizeModelDefaults("pi", value?.modelDefaults),
    planMode: false,
    autoPlan: false,
  }
}

export function normalizeGrokPreference(value?: ProviderPreferenceInput): ProviderPreference<GrokModelOptions> {
  const model = normalizeGrokModelId(modelIdFromInput(value))
  return {
    model,
    modelOptions: normalizeGrokModelOptions(model, value?.modelOptions, value?.effort),
    modelDefaults: normalizeModelDefaults("grok", value?.modelDefaults),
    planMode: value?.planMode === true,
    autoPlan: false,
  }
}

// Exhaustive provider dispatch: the record is keyed by AgentProvider, so adding a
// provider to AgentProvider forces a new entry here instead of silently falling
// through to one provider's branch.
export const PROVIDER_NORMALIZERS: {
  [TProvider in AgentProvider]: (value?: ProviderPreferenceInput) => ChatProviderPreferences[TProvider]
} = {
  claude: normalizeClaudePreference,
  codex: normalizeCodexPreference,
  cursor: normalizeCursorPreference,
  grok: normalizeGrokPreference,
  pi: normalizePiPreference,
}

export function normalizeProviderPreference<TProvider extends AgentProvider>(
  provider: TProvider,
  value?: ProviderPreferenceInput
): ChatProviderPreferences[TProvider] {
  return PROVIDER_NORMALIZERS[provider](value)
}

export function normalizeProviderDefaults(
  value?: Partial<Record<AgentProvider, ProviderPreferenceInput | undefined>>
): ChatProviderPreferences {
  return {
    claude: normalizeClaudePreference(value?.claude),
    codex: normalizeCodexPreference(value?.codex),
    cursor: normalizeCursorPreference(value?.cursor),
    grok: normalizeGrokPreference(value?.grok),
    pi: normalizePiPreference(value?.pi),
  }
}

/**
 * The per-model defaults map, tolerating preferences that predate it. The
 * field is required in the type, but preferences also arrive as JSON — from an
 * app-settings snapshot pushed by an older server, or persisted composer state
 * written by an older client — where it is simply absent.
 */
export function getModelDefaults(
  // Deliberately structural and non-generic: callers hold a preference for a
  // provider they only know at runtime (a union), which no single type
  // parameter can be inferred from.
  preference: { modelDefaults?: Record<string, unknown> }
): Record<string, unknown> {
  return preference.modelDefaults ?? {}
}

/**
 * The saved per-model default for `model`, or undefined when the user has not
 * configured that model. Callers that must not disturb a chat's current
 * options unless a model was explicitly configured (switching models in the
 * composer) use this; callers materializing options from scratch (seeding a
 * chat) use {@link resolveProviderModelOptions}.
 */
export function getProviderModelDefault<TProvider extends AgentProvider>(
  preference: ProviderPreference<ProviderModelOptionsByProvider[TProvider]>,
  model: string,
): ProviderModelOptionsByProvider[TProvider] | undefined {
  return getModelDefaults(preference)[model] as ProviderModelOptionsByProvider[TProvider] | undefined
}

/**
 * The options a model should start from: its own saved defaults when it has
 * them, otherwise the provider-wide defaults re-normalized for that model
 * (which is what every model did before per-model defaults existed).
 */
export function resolveProviderModelOptions<TProvider extends AgentProvider>(
  provider: TProvider,
  preference: ProviderPreference<ProviderModelOptionsByProvider[TProvider]>,
  model: string,
): ProviderModelOptionsByProvider[TProvider] {
  return getProviderModelDefault<TProvider>(preference, model)
    ?? normalizeProviderModelOptions(provider, model, preference.modelOptions as ProviderModelOptionsInput)
}

export function createDefaultProviderDefaults(): ChatProviderPreferences {
  // Normalizing an empty preference yields each provider's default model/options.
  return normalizeProviderDefaults()
}

/**
 * Merges a per-model defaults patch: each entry lands on top of that model's
 * current options, a model with no entry yet starts from the provider-wide
 * defaults (so setting one option doesn't blank the rest), and `null` clears
 * the model so it follows the provider defaults again. Models the patch
 * doesn't mention are left alone.
 */
function mergeModelDefaultsPatch<TModelOptions>(
  current: Record<string, TModelOptions>,
  providerModelOptions: TModelOptions,
  patch: ModelDefaultsPatch<TModelOptions> | undefined
): Record<string, TModelOptions> {
  if (!patch) return current

  const next = { ...current }
  for (const [model, options] of Object.entries(patch)) {
    if (options === null) {
      delete next[model]
      continue
    }
    next[model] = { ...(next[model] ?? providerModelOptions), ...options }
  }
  return next
}

/**
 * Deep-merges a providerDefaults patch over current preferences (per provider,
 * per modelOptions field, per model in modelDefaults). Used by the server's
 * settings applyPatch and the client's optimistic patch so both sides merge
 * identically.
 */
export function mergeProviderDefaultsPatch(
  current: ChatProviderPreferences,
  patch: ProviderDefaultsPatch | undefined
): ChatProviderPreferences {
  return {
    claude: {
      ...current.claude,
      ...patch?.claude,
      modelOptions: {
        ...current.claude.modelOptions,
        ...patch?.claude?.modelOptions,
      },
      modelDefaults: mergeModelDefaultsPatch(
        current.claude.modelDefaults ?? {},
        current.claude.modelOptions,
        patch?.claude?.modelDefaults
      ),
    },
    codex: {
      ...current.codex,
      ...patch?.codex,
      modelOptions: {
        ...current.codex.modelOptions,
        ...patch?.codex?.modelOptions,
      },
      modelDefaults: mergeModelDefaultsPatch(
        current.codex.modelDefaults ?? {},
        current.codex.modelOptions,
        patch?.codex?.modelDefaults
      ),
    },
    cursor: {
      ...current.cursor,
      ...patch?.cursor,
      modelOptions: {
        ...current.cursor.modelOptions,
        ...patch?.cursor?.modelOptions,
      },
      modelDefaults: mergeModelDefaultsPatch(
        current.cursor.modelDefaults ?? {},
        current.cursor.modelOptions,
        patch?.cursor?.modelDefaults
      ),
    },
    grok: {
      ...current.grok,
      ...patch?.grok,
      modelOptions: {
        ...current.grok.modelOptions,
        ...patch?.grok?.modelOptions,
      },
      modelDefaults: mergeModelDefaultsPatch(
        current.grok.modelDefaults ?? {},
        current.grok.modelOptions,
        patch?.grok?.modelDefaults
      ),
    },
    pi: {
      ...current.pi,
      ...patch?.pi,
      modelOptions: {
        ...current.pi.modelOptions,
        ...patch?.pi?.modelOptions,
      },
      modelDefaults: mergeModelDefaultsPatch(
        current.pi.modelDefaults ?? {},
        current.pi.modelOptions,
        patch?.pi?.modelDefaults
      ),
    },
  }
}
