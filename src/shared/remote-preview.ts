/**
 * Remote previews: reaching a dev server on the machine from a browser that
 * isn't on it. The browser panel is a plain iframe, so from your phone
 * `localhost:3000` is the phone. Through `tailscale serve` the machine can
 * publish that port on its tailnet name over HTTPS — reachable from any device
 * on the tailnet, and embeddable inside the (HTTPS) kanna.sh page.
 *
 * Shared by the server (which runs tailscale) and the client (which rewrites
 * the address); no runtime imports here.
 */

export interface RemotePreviewInfo {
  /** tailscale is running here and the tailnet issues HTTPS certs for this machine. */
  available: boolean
  /** The machine's MagicDNS name, e.g. "christos-mac-mini.tail1bcad8.ts.net". */
  dnsName: string | null
  /** Why `available` is false, for the panel to show. */
  reason: string | null
  /** Ports currently published over HTTPS on the tailnet. */
  exposedPorts: number[]
}

export interface LoopbackAddress {
  port: number
  /** Path plus query and hash, "/" at minimum — carried over to the remote URL. */
  pathAndQuery: string
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"])

/**
 * The port and path of an address that only means something on the machine.
 * Null for anything else (a real hostname, a tailnet URL, no explicit port).
 */
export function parseLoopbackAddress(address: string): LoopbackAddress | null {
  let url: URL
  try {
    url = new URL(address.includes("://") ? address : `http://${address}`)
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null
  // No explicit port means 80/443, which isn't a dev server and isn't
  // something we'd publish on the tailnet.
  if (!url.port) return null
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { port, pathAndQuery: `${url.pathname || "/"}${url.search}${url.hash}` }
}

export function buildRemotePreviewUrl(dnsName: string, port: number, pathAndQuery = "/"): string {
  return `https://${dnsName}:${port}${pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`}`
}

/** Ports published over HTTPS, from `tailscale serve status --json`. */
export function parseServeStatusPorts(json: unknown): number[] {
  const tcp = (json as { TCP?: Record<string, { HTTPS?: boolean }> } | null)?.TCP
  if (!tcp || typeof tcp !== "object") return []
  return Object.entries(tcp)
    .filter(([, entry]) => entry?.HTTPS === true)
    .map(([port]) => Number(port))
    .filter((port) => Number.isInteger(port))
    .sort((a, b) => a - b)
}
