import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useViewerStore, type ViewerItem } from "../../stores/viewerStore"

/*
 * What's open in the viewer, in the address, so a refresh (or a link) comes
 * back to it. `?viewer=diff&file=src/app.ts`, `?viewer=file&file=src/app.ts&line=12`, or
 * `?viewer=attachment&url=…&name=…&type=…&size=…`.
 *
 * Not everything can live there. A chart is data from the transcript, not
 * something a URL can name, and a file that only exists in this browser (a
 * `blob:` preview) would be gone after the refresh anyway. Those stay out.
 */

const PARAM_KEYS = ["viewer", "file", "line", "url", "name", "type", "size"] as const

/** The viewer's part of a query string, or null when there's nothing to restore. */
export function writeViewerParams(params: URLSearchParams, item: ViewerItem | null) {
  for (const key of PARAM_KEYS) params.delete(key)
  if (!item) return
  if (item.kind === "diff") {
    params.set("viewer", "diff")
    params.set("file", item.path)
  } else if (item.kind === "file") {
    params.set("viewer", "file")
    params.set("file", item.path)
    if (item.line !== undefined) params.set("line", String(item.line))
  } else if (item.kind === "attachment" && !item.attachment.url.startsWith("blob:")) {
    params.set("viewer", "attachment")
    params.set("url", item.attachment.url)
    params.set("name", item.attachment.name)
    params.set("type", item.attachment.mimeType)
    if (item.attachment.size !== null) params.set("size", String(item.attachment.size))
  }
}

/** The item a query string names, for this page's project; null when it names none. */
export function readViewerParams(params: URLSearchParams, projectId: string | null): ViewerItem | null {
  const viewer = params.get("viewer")
  if (viewer === "diff") {
    const path = params.get("file")
    return path && projectId ? { kind: "diff", projectId, path } : null
  }
  if (viewer === "file") {
    const path = params.get("file")
    if (!path || !projectId) return null
    const line = Number(params.get("line"))
    return { kind: "file", projectId, path, ...(Number.isInteger(line) && line > 0 ? { line } : {}) }
  }
  if (viewer === "attachment") {
    const url = params.get("url")
    if (!url) return null
    const size = Number(params.get("size"))
    return {
      kind: "attachment",
      attachment: {
        url,
        name: params.get("name") || url.split("/").pop() || "Attachment",
        mimeType: params.get("type") || "application/octet-stream",
        size: params.has("size") && Number.isFinite(size) ? size : null,
      },
    }
  }
  return null
}

/**
 * What the address records for what's open. For the diff list that's the
 * file it's scrolled to, not the one that was opened, so a reload comes back
 * where you were reading.
 */
function recordedItem(item: ViewerItem | null, scrolledDiffPath: string | null): ViewerItem | null {
  return item?.kind === "diff" && scrolledDiffPath ? { ...item, path: scrolledDiffPath } : item
}

function itemKey(item: ViewerItem | null) {
  const params = new URLSearchParams()
  writeViewerParams(params, item)
  return params.toString()
}

function sameItem(left: ViewerItem | null, right: ViewerItem | null) {
  if (left === right) return true
  if (!left || !right || left.kind !== right.kind) return false
  if (left.kind === "diff" && right.kind === "diff") return left.projectId === right.projectId && left.path === right.path
  if (left.kind === "file" && right.kind === "file") {
    return left.projectId === right.projectId && left.path === right.path && left.line === right.line
  }
  if (left.kind === "attachment" && right.kind === "attachment") return left.attachment.url === right.attachment.url
  return false
}

/**
 * Keeps the viewer and the address in step, for a page with a router (the
 * chat page; the export viewer has no address to keep).
 *
 * The store stays what the UI reads; the address is its record. Opening
 * writes it, closing clears it (both replacing the history entry, so the
 * back button isn't a list of every file you looked at), and a changed
 * address, a load or a refresh reads it back. Leaving for another chat drops
 * the parameters, which closes the viewer there too.
 */
export function useViewerUrlSync(projectId: string | null) {
  const location = useLocation()
  const navigate = useNavigate()
  const item = useViewerStore((store) => store.item)
  const scrolledDiffPath = useViewerStore((store) => store.scrolledDiffPath)
  const recorded = recordedItem(item, scrolledDiffPath)
  const recordedKey = itemKey(recorded)
  const previousKeyRef = useRef(recordedKey)

  // Address → viewer. The address naming the file the list is scrolled to
  // is this hook's own record of it, not a request to open that file.
  useEffect(() => {
    const named = readViewerParams(new URLSearchParams(location.search), projectId)
    const { item: current, scrolledDiffPath: scrolled, open, close } = useViewerStore.getState()
    if (sameItem(named, recordedItem(current, scrolled)) || sameItem(named, current)) return
    if (named) {
      open(named)
    } else if (current && current.kind !== "chart" && !(current.kind === "attachment" && current.attachment.url.startsWith("blob:"))) {
      // What's open was never in the address (a chart, a blob) and stays;
      // anything else left the address, so it closes.
      close()
    }
  }, [location.search, projectId])

  // Viewer → address. Not on the first run: a refresh starts with nothing
  // open and the address still naming the file, and writing then would erase
  // it before the project has loaded to open it.
  useEffect(() => {
    if (previousKeyRef.current === recordedKey) return
    previousKeyRef.current = recordedKey
    const params = new URLSearchParams(location.search)
    writeViewerParams(params, recorded)
    const search = params.toString()
    if (`?${search}` === location.search || (search === "" && location.search === "")) return
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true, state: location.state })
  }, [location.pathname, location.search, location.state, navigate, recorded, recordedKey])
}
