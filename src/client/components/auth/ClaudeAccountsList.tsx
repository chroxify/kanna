import { Loader2, Plus } from "lucide-react"
import { useState } from "react"
import type { ClaudeAccountSnapshot, ClaudeAccountsSnapshot } from "../../../shared/types"
import type { KannaSocket } from "../../app/socket"
import { cn } from "../../lib/utils"

/** "max" → "Max"; the CLI reports subscription types lowercase. */
function displayPlan(plan: string | null) {
  if (!plan) return null
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

export function claudeAccountName(account: ClaudeAccountSnapshot | undefined) {
  if (!account) return "a removed account"
  if (account.email) return account.email
  return account.isDefault ? "Default account" : "New account"
}

function RowAction({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  )
}

/**
 * The Claude accounts under the Claude Code card: which one new turns run on,
 * each one's sign-in, and adding another. The active account is the one the
 * card's header describes.
 */
export function ClaudeAccountsList({
  accounts,
  loginActive,
  socket,
}: {
  accounts: ClaudeAccountsSnapshot
  /** A sign-in flow is running; starting another would supersede it. */
  loginActive: boolean
  socket: KannaSocket
}) {
  const [adding, setAdding] = useState(false)
  const byId = new Map(accounts.accounts.map((account) => [account.id, account]))
  const lastSwitch = accounts.lastSwitch?.reason === "limit" ? accounts.lastSwitch : null

  const run = (command: Parameters<KannaSocket["command"]>[0]) => {
    void socket.command(command).catch(() => undefined)
  }
  const addAccount = async () => {
    if (adding) return
    setAdding(true)
    try {
      await socket.command({ type: "claudeAccounts.add" })
    } catch {
      // The card's login state carries any failure.
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {accounts.accounts.length > 1
        ? accounts.accounts.map((account) => {
          const signedIn = account.authStatus === "signed_in"
          const signingIn = loginActive && accounts.loginAccountId === account.id
          return (
            <div key={account.id} className="flex items-center gap-2.5">
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  account.active ? "bg-emerald-500" : "bg-muted-foreground/30"
                )}
              />
              <span className={cn("min-w-0 truncate text-sm", account.active ? "text-foreground" : "text-muted-foreground")}>
                {claudeAccountName(account)}
              </span>
              {displayPlan(account.plan) ? (
                <span className="shrink-0 text-xs text-muted-foreground">{displayPlan(account.plan)}</span>
              ) : null}
              <span className="flex-1" />
              {signingIn ? (
                <span className="shrink-0 text-xs text-muted-foreground">Signing in…</span>
              ) : account.authStatus === "unknown" ? (
                <span className="shrink-0 text-xs text-muted-foreground">Checking…</span>
              ) : !signedIn ? (
                <RowAction
                  disabled={loginActive}
                  onClick={() => run({ type: "auth.login.start", service: "claude", accountId: account.id })}
                >
                  Log In
                </RowAction>
              ) : account.active ? (
                <span className="shrink-0 text-xs text-muted-foreground">Active</span>
              ) : (
                <RowAction onClick={() => run({ type: "claudeAccounts.setActive", accountId: account.id })}>
                  Use
                </RowAction>
              )}
              {!account.isDefault && !signingIn ? (
                <RowAction onClick={() => run({ type: "claudeAccounts.remove", accountId: account.id })}>
                  Remove
                </RowAction>
              ) : null}
            </div>
          )
        })
        : null}
      {lastSwitch ? (
        <div className="text-xs text-muted-foreground">
          Switched to {claudeAccountName(byId.get(lastSwitch.toAccountId))} after{" "}
          {claudeAccountName(byId.get(lastSwitch.fromAccountId))} hit its limit.
        </div>
      ) : null}
      <button
        type="button"
        disabled={adding || loginActive}
        onClick={() => void addAccount()}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Add Account
      </button>
    </div>
  )
}
