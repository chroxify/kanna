import { modelIdFamily, type AgentProvider, type ProviderCatalogEntry, type UsageLimitWindow, type UsageLimitsSnapshot } from "./types"

/**
 * Which harnesses and models a new chat can actually start on, derived from the
 * usage snapshot.
 *
 * The rule this encodes: a spent *harness-wide* window (Claude's 5-hour, its
 * weekly-all, Codex's default bucket) means nothing on that harness will run,
 * so a new chat moves to the next harness. A spent *model-scoped* window
 * (Claude's "Weekly · Fable", a Codex model lane) means only that model is
 * spent, so a new chat moves to the next model on the same harness.
 *
 * It deliberately fails open. Only window ids we recognize as harness-wide can
 * block a harness, and only windows that match a catalog model can block a
 * model; anything unrecognized (a surface-scoped window like
 * `seven_day_oauth_apps`, a future window id) is ignored rather than guessed
 * at. Blocking the wrong thing is worse than not blocking.
 */

/** Window ids that gate the whole harness. Everything else gates at most one model. */
const HARNESS_WIDE_WINDOW_IDS: Record<AgentProvider, readonly string[]> = {
  claude: ["five_hour", "seven_day"],
  codex: ["codex:primary", "codex:secondary"],
  cursor: [],
  // Grok's product windows are per *product*, not per model, so only the
  // account-wide credit window gates the harness.
  grok: ["credits"],
  pi: [],
}

/** A window is spent once it reports 100%, unless it has since reset. */
export function isWindowExhausted(window: UsageLimitWindow, now: number): boolean {
  if (window.usedPercent == null || window.usedPercent < 100) return false
  // A cached 100% from before the reset must not pin the user off a model
  // forever — the reset time is the API's own statement that it lapsed.
  if (window.resetsAt) {
    const resetsAt = Date.parse(window.resetsAt)
    if (Number.isFinite(resetsAt) && resetsAt <= now) return false
  }
  return true
}

/**
 * The catalog model a window is scoped to, or null when it is not model-scoped.
 *
 * Claude scopes by a slug appended to the window kind (`weekly_scoped:fable`)
 * and, historically, by a `seven_day_<family>` suffix. Codex names a model lane
 * by its limit id (`gpt-5.3-codex-spark:primary`). Both are matched against the
 * live catalog so a slug that names no model (a surface, a codename) resolves
 * to null instead of blocking something arbitrary.
 */
export function windowModelId(
  provider: AgentProvider,
  windowId: string,
  models: ReadonlyArray<{ id: string }>,
): string | null {
  const candidates: string[] = []
  if (provider === "codex") {
    const [limitId] = windowId.split(":")
    if (limitId) candidates.push(limitId)
  } else {
    const colonIndex = windowId.indexOf(":")
    if (colonIndex >= 0) candidates.push(windowId.slice(colonIndex + 1))
    if (windowId.startsWith("seven_day_")) candidates.push(windowId.slice("seven_day_".length))
  }

  for (const candidate of candidates) {
    if (!candidate) continue
    const match = models.find((model) => (
      model.id === candidate
      // Claude catalog ids are family aliases and the scope slug is the model's
      // display name lowercased ("Fable" → "fable"), so a family comparison
      // bridges a version-pinned id. It stays Claude-only: elsewhere whole
      // families share a prefix ("gpt-6-astra", "gpt-5.6-sol") and matching on
      // it would pin the wrong model.
      || (provider === "claude" && modelIdFamily(model.id) === modelIdFamily(candidate))
    ))
    if (match) return match.id
  }
  return null
}

export interface ProviderAvailability {
  /** A harness-wide window is spent; nothing on this harness will run. */
  harnessExhausted: boolean
  /** Catalog model ids whose own window is spent. */
  exhaustedModels: ReadonlySet<string>
}

export function deriveProviderAvailability(
  provider: ProviderCatalogEntry,
  usage: UsageLimitsSnapshot | null,
  now: number,
): ProviderAvailability {
  const snapshot = usage?.providers.find((candidate) => candidate.provider === provider.id)
  // Only a good read can block: "unknown"/"unavailable" means we don't know,
  // and a harness must never be skipped on missing information.
  if (!snapshot || snapshot.status !== "ok") {
    return { harnessExhausted: false, exhaustedModels: new Set() }
  }

  const harnessWide = HARNESS_WIDE_WINDOW_IDS[provider.id]
  let harnessExhausted = false
  const exhaustedModels = new Set<string>()

  for (const window of snapshot.windows) {
    if (!isWindowExhausted(window, now)) continue
    if (harnessWide.includes(window.id)) {
      harnessExhausted = true
      continue
    }
    const modelId = windowModelId(provider.id, window.id, provider.models)
    if (modelId) exhaustedModels.add(modelId)
  }

  return { harnessExhausted, exhaustedModels }
}

export interface ComposerTarget {
  provider: AgentProvider
  model: string
}

export interface ResolvedComposerTarget extends ComposerTarget {
  /**
   * Why the target moved off what was asked for, or null when it didn't.
   * `model_limit`: the preferred model was spent, another on the same harness
   * was picked. `harness_limit`: the whole harness was spent.
   */
  redirectedBy: "model_limit" | "harness_limit" | null
  /** What was originally asked for, when it was redirected. */
  requested: ComposerTarget | null
}

/**
 * Where a new chat should actually start, given what the defaults ask for.
 *
 * Tries the requested harness first, then the rest of the catalog in order,
 * skipping harnesses that are rate-limited or not signed in. Within a harness
 * the requested model is tried first, then the rest of its catalog in order.
 * Falls back to the original request when nothing is available, so a fully
 * spent account still opens a usable composer rather than nothing.
 */
export function resolveAvailableComposerTarget(args: {
  provider: AgentProvider
  model: string
  providers: ReadonlyArray<ProviderCatalogEntry>
  usage: UsageLimitsSnapshot | null
  /** Harnesses that can't be used regardless of limits (not signed in). */
  unavailableProviders?: ReadonlySet<AgentProvider>
  now?: number
}): ResolvedComposerTarget {
  const { provider, model, providers, usage } = args
  const now = args.now ?? Date.now()
  const unavailable = args.unavailableProviders ?? new Set<AgentProvider>()
  const requested: ComposerTarget = { provider, model }
  const unchanged: ResolvedComposerTarget = { ...requested, redirectedBy: null, requested: null }

  const requestedEntry = providers.find((candidate) => candidate.id === provider)
  if (!requestedEntry) return unchanged

  // The requested harness first, then the rest in catalog order.
  const ordered = [requestedEntry, ...providers.filter((candidate) => candidate.id !== provider)]

  for (const entry of ordered) {
    const isRequestedProvider = entry.id === provider
    // A harness the user can't sign into is no better than a spent one, but
    // never skip the one they explicitly defaulted to on that basis alone.
    if (!isRequestedProvider && unavailable.has(entry.id)) continue

    const availability = deriveProviderAvailability(entry, usage, now)
    if (availability.harnessExhausted) continue

    // Prefer the requested model on the requested harness; on any other
    // harness, its own default model.
    const preferred = isRequestedProvider ? model : entry.defaultModel
    const candidates = [preferred, ...entry.models.map((candidate) => candidate.id)]
    for (const candidate of candidates) {
      if (!candidate || availability.exhaustedModels.has(candidate)) continue
      if (isRequestedProvider && candidate === model) return unchanged
      return {
        provider: entry.id,
        model: candidate,
        redirectedBy: isRequestedProvider ? "model_limit" : "harness_limit",
        requested,
      }
    }
  }

  return unchanged
}
