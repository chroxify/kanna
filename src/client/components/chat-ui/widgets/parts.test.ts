import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { WidgetMoreRow, WidgetRow, widgetRowTrailing } from "./parts"

describe("WidgetRow's trailing slot", () => {
  const menu = createElement("span", null, "Stop")

  test("the kebab is laid over the time, not given a slot of its own", () => {
    const markup = renderToStaticMarkup(createElement(WidgetRow, { title: "Survey", meta: "4m 4s", menu }))
    expect(markup).toContain("data-row-menu")
    // The time is what gives way to it...
    expect(markup).toMatch(/data-row-trailing=""[^>]*>4m 4s</)
    // ...and the kebab sits over the row's trailing corner, out of the flow.
    expect(markup).toContain("absolute right-[5px] top-1.5")
  })

  test("in tabular figures, so a ticking time holds still", () => {
    const markup = renderToStaticMarkup(createElement(WidgetRow, { title: "Survey", meta: "4m 4s" }))
    expect(markup).toContain("tabular-nums")
  })

  test("without a menu, no kebab and nothing gives way", () => {
    const markup = renderToStaticMarkup(createElement(WidgetRow, { title: "Survey", meta: "4m 4s" }))
    expect(markup).not.toContain("data-row-menu")
    expect(markup).not.toContain("data-row-trailing")
  })

  test("an idle glyph gives way and the meta stays", () => {
    const markup = renderToStaticMarkup(createElement(WidgetRow, { title: "parts.tsx", meta: "+3", menuIdle: "M", menu }))
    expect(markup).toMatch(/data-row-trailing=""[^>]*>M</)
    expect(markup).not.toMatch(/data-row-trailing=""[^>]*>\+3</)
  })

  test("with nothing trailing, the title's end gives way", () => {
    const markup = renderToStaticMarkup(createElement(WidgetRow, { title: "bun run dev", menu }))
    expect(markup).toMatch(/data-row-trailing=""[^>]*>bun run dev</)
  })

  test("widgetRowTrailing picks the idle glyph, then the meta, then the title", () => {
    expect(widgetRowTrailing({ hasMenu: false, meta: "1s" })).toBeNull()
    expect(widgetRowTrailing({ hasMenu: true, meta: "1s", menuIdle: "M" })).toBe("idle")
    expect(widgetRowTrailing({ hasMenu: true, meta: "1s" })).toBe("meta")
    expect(widgetRowTrailing({ hasMenu: true })).toBe("title")
  })
})

describe("WidgetMoreRow", () => {
  test("reveals in place with a verb and a count, then offers to fold back", () => {
    const more = renderToStaticMarkup(createElement(WidgetMoreRow, { count: 4 }))
    expect(more).toContain("Show 4 more")
    expect(more).toContain('aria-expanded="false"')
    const less = renderToStaticMarkup(createElement(WidgetMoreRow, { count: 4, shown: true }))
    expect(less).toContain("Show less")
    expect(less).toContain('aria-expanded="true"')
  })

  test("says when a click only shows a page, and how much remains", () => {
    const markup = renderToStaticMarkup(createElement(WidgetMoreRow, { count: 200, detail: "1,240 left" }))
    expect(markup).toContain("Show 200 more")
    expect(markup).toContain("1,240 left")
  })

  test("says it leaves for GitHub, with the page's full count", () => {
    const markup = renderToStaticMarkup(createElement(WidgetMoreRow, { count: 33, total: 38, href: "https://github.com/acme/repo/pulls" }))
    expect(markup).toContain("All 38 on GitHub")
    expect(markup).not.toContain("aria-expanded")
  })

  test("is not a row: no icon column, text only", () => {
    const markup = renderToStaticMarkup(createElement(WidgetMoreRow, { count: 4 }))
    expect(markup).not.toContain("h-5 w-4")
  })
})
