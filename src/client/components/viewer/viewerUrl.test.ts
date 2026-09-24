import { describe, expect, test } from "bun:test"
import { readViewerParams, writeViewerParams } from "./viewerUrl"

describe("viewer address", () => {
  test("a diff round-trips as the file's path, in the page's project", () => {
    const params = new URLSearchParams("tab=1")
    writeViewerParams(params, { kind: "diff", projectId: "p1", path: "src/app.ts" })
    expect(params.get("viewer")).toBe("diff")
    expect(params.get("tab")).toBe("1")
    expect(readViewerParams(params, "p1")).toEqual({ kind: "diff", projectId: "p1", path: "src/app.ts" })
    // Until the project is known there's nothing to open it in.
    expect(readViewerParams(params, null)).toBeNull()
  })

  test("a project file round-trips with its line, and without one", () => {
    const params = new URLSearchParams()
    writeViewerParams(params, { kind: "file", projectId: "p1", path: "src/app.ts", line: 12 })
    expect(params.get("viewer")).toBe("file")
    expect(readViewerParams(params, "p1")).toEqual({ kind: "file", projectId: "p1", path: "src/app.ts", line: 12 })
    writeViewerParams(params, { kind: "file", projectId: "p1", path: "README.md" })
    expect(params.has("line")).toBe(false)
    expect(readViewerParams(params, "p1")).toEqual({ kind: "file", projectId: "p1", path: "README.md" })
  })

  test("an attachment round-trips with its name, type and size", () => {
    const attachment = { url: "/api/chats/c1/media/data.csv", name: "data.csv", mimeType: "text/csv", size: 317_000 }
    const params = new URLSearchParams()
    writeViewerParams(params, { kind: "attachment", attachment })
    expect(readViewerParams(params, "p1")).toEqual({ kind: "attachment", attachment })
  })

  test("charts and browser-only files stay out, and closing clears the viewer's keys only", () => {
    const params = new URLSearchParams("viewer=diff&file=a.ts&keep=yes")
    writeViewerParams(params, { kind: "chart", payload: { title: "x", type: "bar", data: [] } })
    expect(params.toString()).toBe("keep=yes")
    writeViewerParams(params, { kind: "attachment", attachment: { url: "blob:abc", name: "a.png", mimeType: "image/png", size: 1 } })
    expect(params.has("viewer")).toBe(false)
    writeViewerParams(params, null)
    expect(params.toString()).toBe("keep=yes")
  })
})
