import type { GroupQueueBinding, SubmitWhileRunning } from "./types"

/**
 * Whether a send should interrupt the running turn rather than queue behind it.
 *
 * The setting decides what a bare Enter does, and the modifier (⌘/Ctrl+Enter,
 * or a modified click on the send button) always asks for the other one — so
 * whichever way the default is set, both actions stay one keystroke away and
 * neither becomes unreachable.
 */
export function shouldSteerSubmit(mode: SubmitWhileRunning, withModifier: boolean) {
  return (mode === "steer") !== withModifier
}

/** What a send does to a turn that is already running. */
export type SubmitIntent = "steer" | "queue" | "group"

/**
 * Resolves the three things a send can mean while a turn runs.
 *
 * ⌘/Ctrl+⇧+Enter is the queue's second flavour, and it is that same chord in
 * both modes — unlike steer, which rides whichever keystroke the setting did
 * not take. `groupQueue` then says which of the two queueing keystrokes merges
 * into the last queued message and which opens a slot of its own.
 *
 * The chord takes ⇧ rather than ⇧Enter alone because ⇧Enter is the composer's
 * newline, and a key that sends the message sometimes and breaks the line the
 * rest of the time is the kind of thing you find out about by losing a draft.
 */
export function resolveSubmitIntent(options: {
  mode: SubmitWhileRunning
  groupQueue: GroupQueueBinding
  withModifier: boolean
  withShift: boolean
}): SubmitIntent {
  const groupsOnChord = options.groupQueue !== "primary"
  // ⇧ only ever picks between queue flavours; it never reaches a steer.
  if (options.withModifier && options.withShift) return groupsOnChord ? "group" : "queue"
  if (shouldSteerSubmit(options.mode, options.withModifier)) return "steer"
  return groupsOnChord ? "queue" : "group"
}
