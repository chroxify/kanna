import { execFile } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { promisify } from "node:util"
import { buildRemotePreviewUrl, parseServeStatusPorts, type RemotePreviewInfo } from "../shared/remote-preview"
import { ensurePreviewRelay, stopPreviewRelay } from "./preview-relay"

const execFileAsync = promisify(execFile)

/**
 * The tailnet half of remote previews (see shared/remote-preview.ts): runs
 * `tailscale serve` so a loopback-only dev server is reachable at
 * https://<machine>.<tailnet>.ts.net:<port> from any device on the tailnet.
 *
 * Tailnet-only on purpose — never `funnel`, which would put the port on the
 * public internet. `serve --bg` persists across restarts, so a port set up
 * once is instant next time; "stop sharing" in the panel takes it down.
 */

/** `tailscale` on PATH, else the CLI inside the macOS app bundle. */
const CLI_CANDIDATES = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]
const STATUS_CACHE_TTL_MS = 30_000
const COMMAND_TIMEOUT_MS = 10_000

let cliPath: string | null | undefined
let statusCache: { info: RemotePreviewInfo; at: number } | null = null

async function findCli(): Promise<string | null> {
  if (cliPath !== undefined) return cliPath
  for (const candidate of CLI_CANDIDATES) {
    try {
      if (candidate.startsWith("/")) {
        await access(candidate, constants.X_OK)
      } else {
        await execFileAsync(candidate, ["version"], { timeout: COMMAND_TIMEOUT_MS })
      }
      cliPath = candidate
      return candidate
    } catch {
      // try the next one
    }
  }
  cliPath = null
  return null
}

async function tailscale(args: string[]) {
  const cli = await findCli()
  if (!cli) throw new Error("Tailscale is not installed on this machine")
  const { stdout } = await execFileAsync(cli, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
  return stdout
}

function unavailable(reason: string): RemotePreviewInfo {
  return { available: false, dnsName: null, reason, exposedPorts: [] }
}

/** Whether previews can be published, and on what name. Cached briefly. */
export async function getRemotePreviewInfo(options: { force?: boolean } = {}): Promise<RemotePreviewInfo> {
  if (!options.force && statusCache && Date.now() - statusCache.at < STATUS_CACHE_TTL_MS) {
    return statusCache.info
  }
  const info = await probe()
  statusCache = { info, at: Date.now() }
  return info
}

async function probe(): Promise<RemotePreviewInfo> {
  if (!(await findCli())) return unavailable("Tailscale is not installed on this machine")
  let status: { Self?: { DNSName?: string; Online?: boolean }; CertDomains?: string[]; BackendState?: string }
  try {
    status = JSON.parse(await tailscale(["status", "--json"]))
  } catch {
    return unavailable("Tailscale isn't running on this machine")
  }
  if (status.BackendState && status.BackendState !== "Running") {
    return unavailable(`Tailscale is ${status.BackendState.toLowerCase()} on this machine`)
  }
  const dnsName = status.Self?.DNSName?.replace(/\.$/, "") ?? null
  if (!dnsName) return unavailable("This machine has no tailnet name (enable MagicDNS)")
  if (!status.CertDomains?.includes(dnsName)) {
    return unavailable("HTTPS certificates aren't enabled for this tailnet (Tailscale admin → DNS → HTTPS)")
  }
  let exposedPorts: number[] = []
  try {
    exposedPorts = parseServeStatusPorts(JSON.parse(await tailscale(["serve", "status", "--json"])))
  } catch {
    // An empty serve config prints "{}"; anything else here is a CLI hiccup
    // and not a reason to call previews unavailable.
  }
  return { available: true, dnsName, reason: null, exposedPorts }
}

function assertPort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`)
  }
}

/** Publish a loopback port on the tailnet over HTTPS; returns the URL. Idempotent. */
export async function exposePreviewPort(port: number): Promise<{ url: string }> {
  assertPort(port)
  const info = await getRemotePreviewInfo()
  if (!info.available || !info.dnsName) {
    throw new Error(info.reason ?? "Remote previews are unavailable")
  }
  // tailscale forwards to Kanna's relay, not to the dev server: the relay
  // rewrites Host/Origin to localhost so the dev server's own host checks
  // pass (Vite answers 403 to a tailnet Host), and it dials `localhost`,
  // which reaches servers listening on IPv6 loopback only — Node resolves
  // localhost to ::1 first, so Vite is one of those.
  //
  // Always (re)applied rather than skipped when already published: `serve`
  // is idempotent, and this repairs a handler left pointing at a relay port
  // from a previous run.
  const relayPort = ensurePreviewRelay(port)
  await tailscale(["serve", "--bg", `--https=${port}`, `http://127.0.0.1:${relayPort}`])
  statusCache = null
  return { url: buildRemotePreviewUrl(info.dnsName, port) }
}

export async function unexposePreviewPort(port: number): Promise<void> {
  assertPort(port)
  await tailscale(["serve", `--https=${port}`, "off"])
  stopPreviewRelay(port)
  statusCache = null
}

/**
 * On startup: ports the previous run published still have their
 * `tailscale serve` handlers, pointing at relays that died with that run.
 * Bring the relays back so a preview already open on another device keeps
 * working across a Kanna restart. Best effort; a panel re-publishes anyway
 * when it mounts.
 */
export async function restorePreviewRelays(): Promise<number[]> {
  const info = await getRemotePreviewInfo({ force: true }).catch(() => null)
  if (!info?.available) return []
  const restored: number[] = []
  for (const port of info.exposedPorts) {
    try {
      await exposePreviewPort(port)
      restored.push(port)
    } catch {
      // Leave it; the next panel open reports the reason.
    }
  }
  return restored
}

/** Test seam. */
export function resetTailscalePreviewCache() {
  cliPath = undefined
  statusCache = null
}
