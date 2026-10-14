/**
 * The delegator's mark: a compass, for the chat that sets the direction and
 * leaves the travelling to the chats under it. Defined here and nowhere
 * else, so every place a delegator is marked (its row, its tab, the navbar's
 * tag and button, the delegate control, the menu items, the pane's header,
 * the command palette) changes together. The iOS app draws the same symbol.
 *
 * Lucide's own, unaltered: drawn at 12px beside a row's age, 14px in the
 * delegate control and 16px in a row and the navbar, at the stroke those
 * places give their other icons.
 *
 * Not the Workflow tool's icon, which is Lucide's `Workflow` and stays so.
 */
export { Compass as DelegatorIcon } from "lucide-react"
