import { ArrowRightLeft, UserRound } from "lucide-react"
import type { ProcessedAccountInfoMessage } from "./types"
import { MetaRow, MetaLabel, ExpandableRow, VerticalLineContainer } from "./shared"

interface Props {
  message: ProcessedAccountInfoMessage
  /**
   * This read reports a different login than the chat's previous one: the
   * account was swapped under the chat (claude-swap, a re-login) and the new
   * process picked it up. Drawn as a visible marker; a plain first read stays
   * out of the way.
   */
  accountChanged?: boolean
}

export function AccountInfoMessage({ message, accountChanged = false }: Props) {
  const raw = (
    <VerticalLineContainer className="my-4 text-xs">
      <pre className="font-mono whitespace-pre-wrap break-all bg-muted border border-border rounded-lg p-2 max-h-64 overflow-auto">
        {JSON.stringify(message.accountInfo, null, 2)}
      </pre>
    </VerticalLineContainer>
  )

  if (accountChanged) {
    return (
      <MetaRow>
        <ExpandableRow expandedContent={raw}>
          <ArrowRightLeft className="h-5 w-5 p-0.5 text-logo" />
          <MetaLabel>
            Account Switched
            {message.accountInfo.email && (
              <span className="ml-1.5 opacity-50 tracking-normal">{message.accountInfo.email}</span>
            )}
          </MetaLabel>
        </ExpandableRow>
      </MetaRow>
    )
  }

  return (
    <MetaRow className="hidden">
      <ExpandableRow expandedContent={raw}>
        <div className="size-5 flex justify-center items-center ">
          <UserRound className="h-4 w-4 text-muted-foreground" />
        </div>
        <MetaLabel>Account</MetaLabel>
      </ExpandableRow>
    </MetaRow>
  )
}
