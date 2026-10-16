import { createContext, useContext, useMemo, useRef, type ReactNode } from "react"
import { repeatHandoffIds, type HandoffCandidate } from "../../lib/tickets"

/**
 * What a transcript's rows need to draw a delegator's hand-offs as its
 * tickets: whose board they are on, and which hand-offs repeat a ticket
 * already carded higher up. Given by the transcript, which has every row,
 * so a row drawing itself does not have to look at the others.
 *
 * On an ordinary chat there is nothing to find: no hand-off carries a ticket.
 */
export interface TicketTranscriptValue {
  /** The chat whose transcript this is: the delegator, for one that has a board. */
  chatId: string | null
  repeats: ReadonlySet<string>
}

const NO_REPEATS: ReadonlySet<string> = new Set()
const TicketTranscriptContext = createContext<TicketTranscriptValue>({ chatId: null, repeats: NO_REPEATS })

export function TicketTranscriptProvider({ chatId, messages, children }: {
  chatId: string | null
  messages: readonly unknown[]
  children: ReactNode
}) {
  // Rows of every kind go in; only a hand-off naming a ticket counts. The
  // same set is kept while it says the same, so a streaming turn does not
  // redraw every card in the transcript on each push.
  const previous = useRef<ReadonlySet<string>>(NO_REPEATS)
  const repeats = useMemo(() => {
    const next = repeatHandoffIds(messages as readonly HandoffCandidate[])
    const kept = previous.current
    if (next.size === kept.size && [...next].every((id) => kept.has(id))) return kept
    previous.current = next
    return next
  }, [messages])
  const value = useMemo(() => ({ chatId, repeats }), [chatId, repeats])
  return <TicketTranscriptContext.Provider value={value}>{children}</TicketTranscriptContext.Provider>
}

export function useTicketTranscript(): TicketTranscriptValue {
  return useContext(TicketTranscriptContext)
}
