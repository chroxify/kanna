import { describe, expect, test } from "bun:test"
import { resolveViewerSplitMove, viewerCardEnters, viewerPaneState, type ViewerPaneState } from "./viewer-split"

const SAME = { samePane: true, reducedMotion: false }
const OTHER = { samePane: false, reducedMotion: false }
const REDUCED = { samePane: true, reducedMotion: true }

describe("the chat's width under the viewer", () => {
  test("a viewer is closed, docked beside the chat, or expanded over it", () => {
    expect(viewerPaneState(false, false)).toBe("closed")
    // What a closed viewer was last set to does not matter.
    expect(viewerPaneState(false, true)).toBe("closed")
    expect(viewerPaneState(true, false)).toBe("docked")
    expect(viewerPaneState(true, true)).toBe("expanded")
  })

  test("the chat makes room for a docked pane with a slide, and takes it back with one", () => {
    expect(resolveViewerSplitMove("closed", "docked", SAME)).toEqual({ to: "docked", animate: true })
    expect(resolveViewerSplitMove("docked", "closed", SAME)).toEqual({ to: "closed", animate: true })
  })

  test("an open pane keeps its width when what it shows changes", () => {
    // A chat picked from a list, a file over a chat, a review after a preview.
    expect(resolveViewerSplitMove("docked", "docked", SAME)).toEqual({ to: "hold", animate: false })
    // Reduced motion is about how a move is made, and this is not one.
    expect(resolveViewerSplitMove("docked", "docked", REDUCED)).toEqual({ to: "hold", animate: false })
  })

  test("nothing moves under a pane that covers the chat", () => {
    // Opened straight to expanded, a visualization's Expand: the chat keeps its width.
    expect(resolveViewerSplitMove("closed", "expanded", SAME)).toEqual({ to: "hold", animate: false })
    // Expanded from its pane: the chat stays as narrow as it was.
    expect(resolveViewerSplitMove("docked", "expanded", SAME)).toEqual({ to: "hold", animate: false })
    // Another item while expanded.
    expect(resolveViewerSplitMove("expanded", "expanded", SAME)).toEqual({ to: "hold", animate: false })
  })

  test("leaving expanded sets the chat's width once, behind the card", () => {
    expect(resolveViewerSplitMove("expanded", "closed", SAME)).toEqual({ to: "closed", animate: false })
    // Collapsed into its pane, or closed back onto a docked chat preview.
    expect(resolveViewerSplitMove("expanded", "docked", SAME)).toEqual({ to: "docked", animate: false })
  })

  test("another chat's pane, or a new split, takes its own layout without a slide", () => {
    expect(resolveViewerSplitMove("closed", "docked", OTHER)).toEqual({ to: "docked", animate: false })
    expect(resolveViewerSplitMove("docked", "closed", OTHER)).toEqual({ to: "closed", animate: false })
    // Both chats have a pane open, each at its own width: not a pane holding still.
    expect(resolveViewerSplitMove("docked", "docked", OTHER)).toEqual({ to: "docked", animate: false })
    // A reload onto an expanded item leaves the split where it starts, at the chat's full width.
    expect(resolveViewerSplitMove("closed", "expanded", OTHER)).toEqual({ to: "hold", animate: false })
  })

  test("reduced motion opens and closes the pane in one step", () => {
    expect(resolveViewerSplitMove("closed", "docked", REDUCED)).toEqual({ to: "docked", animate: false })
    expect(resolveViewerSplitMove("docked", "closed", REDUCED)).toEqual({ to: "closed", animate: false })
  })

  test("a closed viewer staying closed is not a move to animate", () => {
    expect(resolveViewerSplitMove("closed", "closed", SAME)).toEqual({ to: "closed", animate: false })
  })
})

describe("the viewer card's entrance", () => {
  const states: ViewerPaneState[] = ["closed", "docked", "expanded"]

  test("plays when the pane opens, docked or expanded", () => {
    expect(viewerCardEnters("closed", "docked")).toBe(true)
    expect(viewerCardEnters("closed", "expanded")).toBe(true)
  })

  test("does not play when an open pane changes what it shows, or how it is placed", () => {
    for (const previous of states) {
      for (const next of states) {
        if (previous === "closed" && next !== "closed") continue
        expect(viewerCardEnters(previous, next)).toBe(false)
      }
    }
  })
})
