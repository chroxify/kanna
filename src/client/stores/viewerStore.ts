import { create } from "zustand"
import type { ChartToolPayload, DisplayAttachment } from "../../shared/display-tools"
import type { ChatAttachment } from "../../shared/types"

/**
 * The one viewer: what the elevated card over the chat is showing, if
 * anything. A changed file's diff, an attachment, or a chart at full size all
 * open here, so they share one surface, one chrome and one set of keys, and
 * nothing else in the app keeps a modal of its own for them.
 *
 * Not persisted: a view is something you're doing, not a place to come back
 * to after a reload.
 */

/** An attachment from anywhere (the composer, a prompt, an agent's send), in one shape. */
export interface ViewerAttachment {
  url: string
  name: string
  mimeType: string
  size: number | null
}

export type ViewerItem =
  | { kind: "diff"; projectId: string; path: string }
  /** A file in the project, as it is on disk: `path` relative to the project, `line` to jump to. */
  | { kind: "file"; projectId: string; path: string; line?: number }
  | { kind: "attachment"; attachment: ViewerAttachment }
  | { kind: "chart"; payload: ChartToolPayload }

interface ViewerState {
  item: ViewerItem | null
  /**
   * Counts opens, so opening the same file again (a click on the Changes row
   * you already opened, after scrolling away from it) still jumps back to it.
   */
  openCount: number
  /**
   * The file the diff list is scrolled to, which the Changes card lights.
   * Apart from `item`, which is the file that was opened: that one decides
   * where the list jumps and what the address names, and scrolling mustn't
   * move either.
   */
  scrolledDiffPath: string | null
  open: (item: ViewerItem) => void
  close: () => void
  setScrolledDiffPath: (path: string | null) => void
}

export const useViewerStore = create<ViewerState>()((set) => ({
  item: null,
  openCount: 0,
  scrolledDiffPath: null,
  open: (item) => set((state) => ({ item, openCount: state.openCount + 1, scrolledDiffPath: null })),
  close: () => set({ item: null, scrolledDiffPath: null }),
  setScrolledDiffPath: (path) => set((state) => (state.scrolledDiffPath === path ? state : { scrolledDiffPath: path })),
}))

export function openViewer(item: ViewerItem) {
  useViewerStore.getState().open(item)
}

export function viewerAttachmentFromChat(attachment: ChatAttachment): ViewerAttachment {
  return { url: attachment.contentUrl, name: attachment.displayName, mimeType: attachment.mimeType, size: attachment.size }
}

export function viewerAttachmentFromDisplay(attachment: DisplayAttachment): ViewerAttachment {
  return { url: attachment.url, name: attachment.name, mimeType: attachment.mimeType, size: attachment.size }
}

/**
 * The file the viewer's diff list is on, in this project, or null: the one
 * scrolled to, else the one opened. The Changes card lights it, so the two
 * move together.
 */
export function useReviewedPath(projectId: string | null) {
  return useViewerStore((store) => (
    projectId && store.item?.kind === "diff" && store.item.projectId === projectId
      ? store.scrolledDiffPath ?? store.item.path
      : null
  ))
}
