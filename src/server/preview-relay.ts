/**
 * The hop between `tailscale serve` and a dev server (see tailscale-preview.ts).
 *
 * Tailscale forwards the browser's Host header untouched, and dev servers
 * refuse hosts they don't know: Vite's allowedHosts answers 403, Rails host
 * authorization likewise. Rather than asking every project for config, this
 * relay presents each request as if it came from localhost — Host and Origin
 * rewritten, the tailnet host kept in X-Forwarded-Host for apps that build
 * absolute URLs — and proxies WebSockets the same way, so HMR works too.
 *
 * One relay per published port, on 127.0.0.1, for as long as the server runs.
 */

const RELAY_HOST = "127.0.0.1"
/**
 * Preferred relay port for a target: stable across restarts, so a
 * `tailscale serve` handler left over from the last run still points at a
 * relay that comes back on the same port. Falls back to an ephemeral port
 * when the preferred one is taken.
 */
export function preferredRelayPort(targetPort: number) {
  return 43000 + (targetPort % 10000)
}

/** Request headers as the dev server should see them. Exported for tests. */
export function rewriteForwardedHeaders(incoming: Headers, targetPort: number): Headers {
  const headers = new Headers(incoming)
  const localOrigin = `localhost:${targetPort}`
  const forwardedHost = headers.get("host")
  headers.set("host", localOrigin)
  if (forwardedHost) {
    headers.set("x-forwarded-host", forwardedHost)
    headers.set("x-forwarded-proto", "https")
  }
  // Origin is what CORS and WebSocket-origin checks look at; the browser
  // sends the tailnet origin, the dev server expects its own.
  if (headers.has("origin")) headers.set("origin", `http://${localOrigin}`)
  // Let fetch negotiate encoding itself — a passthrough of the browser's
  // accept-encoding would hand us a compressed body we then re-serve
  // without the matching content-encoding.
  headers.delete("accept-encoding")
  return headers
}

/** Response headers as the browser should see them. Exported for tests. */
export function rewriteResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers(upstream)
  // fetch already decoded the body; these describe the wire form we no
  // longer have, and Bun sets its own framing.
  headers.delete("content-encoding")
  headers.delete("content-length")
  headers.delete("transfer-encoding")
  return headers
}

export function buildUpstreamUrl(requestUrl: string, targetPort: number, protocol: "http" | "ws" = "http") {
  const url = new URL(requestUrl)
  return `${protocol}://localhost:${targetPort}${url.pathname}${url.search}`
}

interface RelayWsData {
  upstreamUrl: string
  headers: Record<string, string>
  protocols: string[]
  upstream: WebSocket | null
  /** Frames the browser sent before the upstream socket opened. */
  pending: Array<string | ArrayBuffer | Uint8Array>
}

const relays = new Map<number, { server: ReturnType<typeof Bun.serve>; port: number }>()

/** Start (or reuse) the relay for a target port; returns the relay's port. */
export function ensurePreviewRelay(targetPort: number): number {
  const existing = relays.get(targetPort)
  if (existing) return existing.port

  const start = (port: number) => Bun.serve<RelayWsData>({
    hostname: RELAY_HOST,
    port,
    async fetch(request, server) {
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const headers = rewriteForwardedHeaders(request.headers, targetPort)
        const upgraded = server.upgrade(request, {
          data: {
            upstreamUrl: buildUpstreamUrl(request.url, targetPort, "ws"),
            headers: Object.fromEntries(headers.entries()),
            protocols: (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim()).filter(Boolean),
            upstream: null,
            pending: [],
          },
        })
        return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 })
      }
      try {
        const upstream = await fetch(buildUpstreamUrl(request.url, targetPort), {
          method: request.method,
          headers: rewriteForwardedHeaders(request.headers, targetPort),
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          // The browser must see the dev server's redirects, not their targets.
          redirect: "manual",
        })
        return new Response(upstream.body, { status: upstream.status, headers: rewriteResponseHeaders(upstream.headers) })
      } catch (error) {
        return new Response(`Kanna preview relay: ${error instanceof Error ? error.message : String(error)}`, {
          status: 502,
          headers: { "content-type": "text/plain" },
        })
      }
    },
    websocket: {
      open(ws) {
        const { upstreamUrl, headers, protocols } = ws.data
        // Bun's client takes custom headers, which is what lets the dev
        // server's own host/origin checks pass on the upgrade too.
        const upstream = new WebSocket(upstreamUrl, { protocols, headers } as unknown as string[])
        ws.data.upstream = upstream
        upstream.addEventListener("open", () => {
          for (const frame of ws.data.pending) upstream.send(frame)
          ws.data.pending = []
        })
        upstream.addEventListener("message", (event) => {
          ws.send(event.data as string | ArrayBuffer)
        })
        upstream.addEventListener("close", (event) => {
          ws.close(event.code === 1005 ? 1000 : event.code, event.reason)
        })
        upstream.addEventListener("error", () => {
          ws.close(1011, "upstream error")
        })
      },
      message(ws, message) {
        const upstream = ws.data.upstream
        if (upstream && upstream.readyState === WebSocket.OPEN) {
          upstream.send(message)
        } else {
          ws.data.pending.push(message)
        }
      },
      close(ws) {
        const upstream = ws.data.upstream
        if (upstream && upstream.readyState <= WebSocket.OPEN) upstream.close()
      },
    },
  })

  let server: ReturnType<typeof Bun.serve>
  try {
    server = start(preferredRelayPort(targetPort))
  } catch {
    server = start(0)
  }
  relays.set(targetPort, { server, port: server.port ?? 0 })
  return server.port ?? 0
}

export function stopPreviewRelay(targetPort: number) {
  const relay = relays.get(targetPort)
  if (!relay) return
  relays.delete(targetPort)
  relay.server.stop(true)
}

export function stopAllPreviewRelays() {
  for (const port of [...relays.keys()]) stopPreviewRelay(port)
}
