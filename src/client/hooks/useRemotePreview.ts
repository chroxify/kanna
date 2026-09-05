import { useCallback, useEffect, useMemo, useState } from "react"
import type { KannaSocket } from "../app/socket"
import { useConnectionStore } from "../stores/connectionStore"
import { parseLoopbackAddress, type LoopbackAddress } from "../../shared/remote-preview"

/**
 * What the browser panel's iframe should actually load. Locally, the address
 * as typed. Through kanna.sh, a loopback address is meaningless on this
 * device, so it is published on the machine's tailnet and the HTTPS tailnet
 * URL is loaded instead — the address bar keeps showing localhost.
 */
export type RemotePreviewState =
  | { kind: "direct"; src: string }
  | { kind: "resolving"; src: null; loopback: LoopbackAddress }
  | { kind: "remote"; src: string; loopback: LoopbackAddress }
  | { kind: "stopped"; src: null; loopback: LoopbackAddress }
  | { kind: "error"; src: null; loopback: LoopbackAddress; message: string }

export function useRemotePreview(socket: KannaSocket, address: string) {
  const mode = useConnectionStore((store) => store.mode)
  const loopback = useMemo(() => (mode === "cloud" ? parseLoopbackAddress(address) : null), [address, mode])
  const port = loopback?.port ?? null
  const [resolved, setResolved] = useState<{ port: number; url: string } | null>(null)
  const [error, setError] = useState<{ port: number; message: string } | null>(null)
  const [stoppedPort, setStoppedPort] = useState<number | null>(null)

  const expose = useCallback(async (targetPort: number) => {
    setStoppedPort(null)
    setError(null)
    // Asked fresh on every mount and address change, never cached across
    // them: the relay behind a URL lives only as long as the Kanna server,
    // and (re)publishing is idempotent and cheap.
    try {
      const { url } = await socket.command<{ url: string }>({ type: "preview.expose", port: targetPort })
      setResolved({ port: targetPort, url })
    } catch (caught) {
      setError({ port: targetPort, message: caught instanceof Error ? caught.message : String(caught) })
    }
  }, [socket])

  useEffect(() => {
    if (port === null || stoppedPort === port) return
    if (resolved?.port === port || error?.port === port) return
    void expose(port)
  }, [error?.port, expose, port, resolved?.port, stoppedPort])

  const stop = useCallback(async () => {
    if (port === null) return
    setResolved(null)
    setStoppedPort(port)
    try {
      await socket.command({ type: "preview.unexpose", port })
    } catch (caught) {
      setError({ port, message: caught instanceof Error ? caught.message : String(caught) })
    }
  }, [port, socket])

  const retry = useCallback(() => {
    if (port !== null) void expose(port)
  }, [expose, port])

  const state: RemotePreviewState = useMemo(() => {
    if (!loopback) return { kind: "direct", src: address }
    if (stoppedPort === loopback.port) return { kind: "stopped", src: null, loopback }
    if (error?.port === loopback.port) return { kind: "error", src: null, loopback, message: error.message }
    if (resolved?.port === loopback.port) {
      // Rebase the typed path onto the tailnet origin, so /docs?x=1 survives.
      const base = new URL(resolved.url)
      return { kind: "remote", src: `${base.origin}${loopback.pathAndQuery}`, loopback }
    }
    return { kind: "resolving", src: null, loopback }
  }, [address, error, loopback, resolved, stoppedPort])

  return { state, stop, retry }
}
