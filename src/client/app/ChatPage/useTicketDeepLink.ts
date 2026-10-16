import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { readTicketLinkParam, withoutTicketLinkParam } from "../../lib/tickets"
import { openViewer, useViewerStore } from "../../stores/viewerStore"

/**
 * A ticket's link (`/chat/<delegator>?ticket=tk_…`, the ••• menu's Copy
 * link): opens the ticket in the pane over the delegator's chat, then takes
 * the ticket out of the address. Spent once, so a reload or Back to the
 * page is the page as it was left, not the ticket opened again over it.
 *
 * `ready` once the page knows the chat is a delegator: a link to a chat that
 * is not one opens nothing, and its parameter is dropped all the same.
 */
export function useTicketDeepLink(chatId: string | null, ready: boolean, isDelegator: boolean) {
  const location = useLocation()
  const navigate = useNavigate()
  const ticketId = readTicketLinkParam(location.search)
  useEffect(() => {
    if (!ticketId || !chatId || !ready) return
    // The viewer is this chat's by now (the page sets it before effects run).
    if (isDelegator && useViewerStore.getState().chatKey === chatId) openViewer({ kind: "ticket", chatId, ticketId })
    navigate({ pathname: location.pathname, search: withoutTicketLinkParam(location.search), hash: location.hash }, { replace: true, state: location.state })
  }, [chatId, isDelegator, location.hash, location.pathname, location.search, location.state, navigate, ready, ticketId])
}
