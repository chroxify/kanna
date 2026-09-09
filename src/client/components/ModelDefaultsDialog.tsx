import { RotateCcw } from "lucide-react"
import { getModelDefaults, resolveProviderModelOptions } from "../../shared/provider-preferences"
import {
  resolveModelLabel,
  type AgentProvider,
  type ChatProviderPreferences,
  type ProviderCatalogEntry,
  type ProviderModelOptionsByProvider,
} from "../../shared/types"
import { deriveComposerOptionControls } from "../lib/composer"
import type { ComposerState } from "../stores/chatPreferencesStore"
import {
  ChatPreferenceControls,
  modelOptionChangePatch,
  type ModelOptionChange,
} from "./chat-ui/ChatPreferenceControls"
import { PROVIDER_ICONS } from "./provider-icons"
import { Button } from "./ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogTitle } from "./ui/dialog"

/**
 * Per-model defaults: "Opus always medium, Fable always high".
 *
 * Every model of every connected harness gets a row. A row starts out
 * following the provider-wide defaults (set in the provider's Defaults row);
 * touching any control pins that model's options, and Reset unpins it. The
 * pinned options are what a new chat on that model opens with, and what the
 * composer switches to when you pick that model mid-chat.
 *
 * Rows reuse ChatPreferenceControls with the provider and model pickers
 * hidden, so which options a model even has (Claude's context window, fast
 * mode, each Codex model's own effort list) stays decided in one place.
 */
export function ModelDefaultsDialog({
  open,
  onOpenChange,
  availableProviders,
  providerDefaults,
  onSetModelDefault,
  onClearModelDefault,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableProviders: ProviderCatalogEntry[]
  providerDefaults: ChatProviderPreferences
  onSetModelDefault: <TProvider extends AgentProvider>(
    provider: TProvider,
    model: string,
    modelOptions: Partial<ProviderModelOptionsByProvider[TProvider]>
  ) => void
  onClearModelDefault: (provider: AgentProvider, model: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogBody className="space-y-4">
          <DialogTitle>Per-Model Defaults</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Options a model always starts with, whatever the previous model used. Models left untouched follow their harness defaults.
          </p>
          <div className="max-h-[55vh] space-y-4 overflow-y-auto">
            {availableProviders.map((provider) => {
              const preference = providerDefaults[provider.id]
              const ProviderIcon = PROVIDER_ICONS[provider.id]
              return (
                <section key={provider.id}>
                  <div className="flex items-center gap-2 px-1 pb-1.5 text-sm font-medium">
                    <ProviderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{provider.label}</span>
                  </div>
                  <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-background">
                    {provider.models.map((model) => {
                      const pinned = getModelDefaults(preference)[model.id]
                      const modelOptions = resolveProviderModelOptions(provider.id, preference, model.id)
                      const controls = deriveComposerOptionControls(
                        { provider: provider.id, model: model.id, modelOptions, planMode: false, autoPlan: false } as ComposerState,
                        provider
                      )
                      const hasOptions = Boolean(controls.reasoning ?? controls.contextWindow ?? controls.fastMode)

                      return (
                        <div key={model.id} className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
                          <div className="min-w-0 flex-1 truncate text-sm">
                            {resolveModelLabel(provider.models, model.id)}
                          </div>
                          {hasOptions ? (
                            <ChatPreferenceControls
                              availableProviders={availableProviders}
                              selectedProvider={provider.id}
                              showProviderPicker={false}
                              showModelPicker={false}
                              providerLocked
                              model={model.id}
                              modelOptions={modelOptions}
                              onModelChange={() => undefined}
                              onModelOptionChange={(change: ModelOptionChange) => {
                                onSetModelDefault(
                                  provider.id,
                                  model.id,
                                  modelOptionChangePatch(change) as Partial<ProviderModelOptionsByProvider[typeof provider.id]>
                                )
                              }}
                              includeMode={false}
                              className="justify-end"
                            />
                          ) : (
                            <span className="px-2 text-sm text-muted-foreground">No options</span>
                          )}
                          <button
                            type="button"
                            aria-label={`Reset ${model.label} defaults`}
                            title="Follow harness defaults"
                            disabled={!pinned}
                            onClick={() => onClearModelDefault(provider.id, model.id)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
