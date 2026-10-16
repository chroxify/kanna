import { useEffect, useState } from "react"

/** How often a ticket's time is brought up to date. It reads to the minute. */
const TICKET_CLOCK_TICK_MS = 60_000

/** Now, to the minute, for the times on rows, cards and activity lines. */
export function useTicketClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICKET_CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
