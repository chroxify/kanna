import { create } from "zustand"
import type { ProviderCatalogEntry, UsageLimitsSnapshot } from "../../shared/types"

/**
 * What a new chat needs in order to avoid starting on a rate-limited harness
 * or model: the usage snapshot and the live provider catalog.
 *
 * It lives in its own store because the decision happens inside the chat
 * preferences store, which materializes a new chat's composer state and has no
 * access to the app's derived catalog or subscription state. Both fields are
 * pushed in by the app; consumers read them synchronously at seeding time.
 */
interface ComposerAvailabilityState {
  usage: UsageLimitsSnapshot | null
  /**
   * The out-of-chat catalog (`fallbackProviders` in useKannaState) — the same
   * list the new-chat composer's pickers show, including runtime-discovered
   * models. Empty until the app syncs it, which disables the fallback rather
   * than guessing from the static catalog.
   */
  providers: ProviderCatalogEntry[]
  setUsage: (usage: UsageLimitsSnapshot | null) => void
  setProviders: (providers: ProviderCatalogEntry[]) => void
}

export const useComposerAvailabilityStore = create<ComposerAvailabilityState>()((set) => ({
  usage: null,
  providers: [],
  setUsage: (usage) => set({ usage }),
  setProviders: (providers) => set({ providers }),
}))
