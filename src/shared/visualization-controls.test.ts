import { describe, expect, test } from "bun:test"
import { VISUALIZATION_CONTROLS_CSS, VISUALIZATION_CONTROLS_GEOMETRY, VISUALIZATION_CONTROLS_SCRIPT } from "./visualization-controls"

interface Edge { more: boolean, arrow: boolean, fade: number }
// The very source the script ships with, run on its own.
const { centredScrollLeft, overflowEdges } = new Function(`${VISUALIZATION_CONTROLS_GEOMETRY}; return { centredScrollLeft, overflowEdges }`)() as {
  centredScrollLeft: (rowWidth: number, optionOffset: number, optionWidth: number, scrollRange: number) => number
  overflowEdges: (scrollLeft: number, scrollRange: number, finePointer: boolean) => { start: Edge, end: Edge }
}

describe("centredScrollLeft", () => {
  // A 300px row over 900px of options: it scrolls 0 to 600.
  test("puts an option in the middle of the row", () => {
    // 400 to 480: its middle, 440, lands at 150, the row's middle.
    expect(centredScrollLeft(300, 400, 80, 600)).toBe(290)
  })

  test("stops at the start for the first options", () => {
    expect(centredScrollLeft(300, 20, 80, 600)).toBe(0)
  })

  test("stops at the end for the last options", () => {
    expect(centredScrollLeft(300, 820, 80, 600)).toBe(600)
  })

  test("leaves a row that fits where it is", () => {
    expect(centredScrollLeft(300, 200, 80, 0)).toBe(0)
    expect(centredScrollLeft(300, 200, 80, -4)).toBe(0)
  })
})

describe("overflowEdges", () => {
  test("fades only an edge with more beyond it", () => {
    expect(overflowEdges(0, 600, false)).toEqual({ start: { more: false, arrow: false, fade: 0 }, end: { more: true, arrow: false, fade: 24 } })
    expect(overflowEdges(300, 600, false)).toEqual({ start: { more: true, arrow: false, fade: 24 }, end: { more: true, arrow: false, fade: 24 } })
    expect(overflowEdges(600, 600, false)).toEqual({ start: { more: true, arrow: false, fade: 24 }, end: { more: false, arrow: false, fade: 0 } })
    expect(overflowEdges(0, 0, true)).toEqual({ start: { more: false, arrow: false, fade: 0 }, end: { more: false, arrow: false, fade: 0 } })
  })

  test("shows a mouse an arrow, and fades further to make room for it", () => {
    expect(overflowEdges(300, 600, true)).toEqual({ start: { more: true, arrow: true, fade: 44 }, end: { more: true, arrow: true, fade: 44 } })
    expect(overflowEdges(0, 600, true).start).toEqual({ more: false, arrow: false, fade: 0 })
  })

  test("takes a fractional scroll at either end for the end", () => {
    expect(overflowEdges(0.5, 600, false).start.more).toBe(false)
    expect(overflowEdges(599.5, 600, false).end.more).toBe(false)
  })
})

describe("the controls script", () => {
  test("parses, and stands down for a copy that ran first", () => {
    expect(() => new Function(VISUALIZATION_CONTROLS_SCRIPT)).not.toThrow()
    expect(VISUALIZATION_CONTROLS_SCRIPT.startsWith("(() => {\n  if (window.__kannaControls) return;")).toBe(true)
  })

  test("can sit in a script element and a Swift raw string", () => {
    expect(VISUALIZATION_CONTROLS_SCRIPT).not.toContain("</script")
    expect(VISUALIZATION_CONTROLS_SCRIPT).not.toContain('"""')
  })

  test("reads the selection and never sets it", () => {
    // The page's own handler selects; a key press clicks.
    expect(VISUALIZATION_CONTROLS_SCRIPT).not.toMatch(/setAttribute\('aria-/)
    expect(VISUALIZATION_CONTROLS_SCRIPT).toContain("all[to].click()")
  })

  test("animates a click, never a key press, and nothing under reduced motion", () => {
    expect(VISUALIZATION_CONTROLS_SCRIPT).toContain("const instant = how === 'key' || how === 'initial' || how === 'layout' || !state.settled || !loaded || reduced.matches;")
    expect(VISUALIZATION_CONTROLS_SCRIPT).toContain("transition:transform 200ms cubic-bezier(0.23,1,0.32,1)")
    expect(VISUALIZATION_CONTROLS_SCRIPT).toContain("@media (prefers-reduced-motion:reduce){.track.settled,.indicator.slide,.arrow{transition:none}}")
  })

  test("shows arrows to a mouse only", () => {
    expect(VISUALIZATION_CONTROLS_SCRIPT).toContain("matchMedia('(hover: hover) and (pointer: fine)')")
    expect(VISUALIZATION_CONTROLS_SCRIPT).toContain("@media (hover:hover) and (pointer:fine){.arrow{display:grid}}")
  })
})

describe("the controls stylesheet", () => {
  const rule = (selector: string) => new RegExp(`(?:^|\\})${selector.replace(/[.>[\]()=,:]/g, "\\$&")}\\{([^}]*)\\}`).exec(VISUALIZATION_CONTROLS_CSS)?.[1] ?? ""

  test("a tabs row is as tall once the script takes it on as before", () => {
    // It keeps its baseline border and its tabs' margins; the track reaches
    // 1px over the border and pads the pixel back.
    expect(rule(".kanna-tabs")).toContain("border-bottom:1px solid var(--border)")
    expect(rule(".kanna-tabs[data-kanna-row]")).toBe("overflow:visible;min-width:0")
    expect(VISUALIZATION_CONTROLS_SCRIPT).toContain(":host(.kanna-tabs) .track{margin-bottom:-1px;padding-bottom:1px}")
    // The selected tab's own border gives way to the sliding underline.
    expect(rule(".kanna-tabs[data-kanna-row]>:is([aria-checked=true],[aria-selected=true],[aria-pressed=true])")).toBe("border-bottom-color:transparent")
  })

  test("registers the fades' widths so they ease in", () => {
    expect(VISUALIZATION_CONTROLS_CSS).toContain("@property --kanna-fade-start{syntax:'<length>';inherits:false;initial-value:0px}")
    expect(VISUALIZATION_CONTROLS_CSS).toContain("@property --kanna-fade-end{syntax:'<length>';inherits:false;initial-value:0px}")
  })
})
