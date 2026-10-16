import { Check, Plus, SquarePen } from "lucide-react"
import type { ReactNode } from "react"
import type { AgentProvider } from "../../../shared/types"
import { delegatedAttentionCount, delegatorDisplayTitle } from "../../lib/delegators"
import type { SidebarThread } from "../../lib/thread-sections"
import { useSidebarStore } from "../../stores/sidebarStore"
import { InputPopover, PopoverMenuItem } from "./ChatPreferenceControls"
import { DelegatorIcon } from "./delegator-icon"

/**
 * What the new chat page's composer is told when the project has a
 * delegator: the control to draw first in its options row, and the
 * delegator the message goes to, if it is going to one.
 */
export interface ComposerDelegate {
  control: ReactNode
  /**
   * The delegator this message goes to, or null while not delegating.
   * `provider` is null for one that has never run: it has no settings of its
   * own yet, so the composer's stay its to choose and are sent with the message.
   */
  target: { chatId: string; title: string; provider: AgentProvider | null } | null
}

/**
 * The first option under the new chat page's input: whether this message
 * starts a chat or goes to a delegator, and to which.
 *
 * Off, it reads "Delegate" and looks like the options beside it. On, it
 * names the delegator in the brand colour: the one option in the row that
 * changes where the message goes, and so the one that must not be missed.
 * Its menu holds the project's delegators, the way to stop delegating, and
 * the way to make a new one.
 */
export function DelegateControl({ delegators, target, projectName, onPick, onCreate }: {
  /** The project's delegators, most recently active first. Never empty: with none, the control is not drawn. */
  delegators: readonly SidebarThread[]
  target: SidebarThread | null
  projectName: string
  /** Delegate to this one, or with null, stop delegating. */
  onPick: (chatId: string | null) => void
  onCreate: () => void
}) {
  return (
    <InputPopover
      trigger={(
        <>
          <DelegatorIcon className="h-3.5 w-3.5" />
          <span className="max-w-[16ch] truncate">{target ? delegatorDisplayTitle(target.title) : "Delegate"}</span>
        </>
      )}
      triggerClassName={target ? "text-logo" : undefined}
    >
      {(close) => (
        <>
          {delegators.map((delegator) => (
            <DelegatorMenuItem
              key={delegator.chatId}
              delegator={delegator}
              selected={delegator.chatId === target?.chatId}
              onPick={() => {
                onPick(delegator.chatId)
                close()
              }}
            />
          ))}
          <PopoverMenuItem
            onClick={() => {
              onPick(null)
              close()
            }}
            selected={false}
            icon={<SquarePen className="h-4 w-4 text-muted-foreground" />}
            label="Don't Delegate"
            description={`Start a new chat in ${projectName}`}
            trailing={target ? undefined : <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          />
          <PopoverMenuItem
            onClick={() => {
              close()
              onCreate()
            }}
            selected={false}
            icon={<Plus className="h-4 w-4 text-muted-foreground" />}
            label="New Delegator…"
            description="A chat that hands work to the chats under it"
          />
        </>
      )}
    </InputPopover>
  )
}

/** One delegator in the menu: its name, and how many chats are under it and want you. */
function DelegatorMenuItem({ delegator, selected, onPick }: {
  delegator: SidebarThread
  selected: boolean
  onPick: () => void
}) {
  // As a string, so the item re-renders when what it says changes and not
  // for every push of the sidebar.
  const summary = useSidebarStore((state) => {
    let chats = 0
    let wanting = 0
    for (const group of state.data.projectGroups) {
      for (const chat of group.chats) if (chat.parentChatId === delegator.chatId) chats += 1
      wanting += delegatedAttentionCount(group.chats, delegator.chatId)
    }
    if (chats === 0) return "No chats yet"
    const total = `${chats} ${chats === 1 ? "chat" : "chats"}`
    return wanting > 0 ? `${total}, ${wanting} ${wanting === 1 ? "wants" : "want"} you` : total
  })
  return (
    <PopoverMenuItem
      onClick={onPick}
      selected={false}
      icon={<DelegatorIcon className="h-4 w-4 text-muted-foreground" />}
      label={delegatorDisplayTitle(delegator.title)}
      description={summary}
      trailing={selected ? <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : undefined}
    />
  )
}
