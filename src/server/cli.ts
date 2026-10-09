import process from "node:process"
import { LOG_PREFIX } from "../shared/branding"
import {
  fetchLatestPackageVersion,
  installPackageVersion,
  openUrl,
  runCli,
} from "./cli-runtime"
import {
  CLI_RESTART_SIGNAL,
  CLI_STARTUP_UPDATE_RESTART_EXIT_CODE,
  CLI_UI_UPDATE_RESTART_EXIT_CODE,
  isSupervisedChild,
} from "./restart"
import { installNightlyBuild } from "./nightly"
import { startKannaServer } from "./server"
import { EXIT_WITH_PARENT_ENV_VAR, exitWithParent, openInMacApp } from "./mac-app"

// Read version from package.json at the package root
const pkg = await Bun.file(new URL("../../package.json", import.meta.url)).json()
const VERSION: string = pkg.version ?? "0.0.0"

// Last-resort backstop: log escaped rejections (e.g. from requests Bun
// idle-timed-out mid-handler) instead of letting them crash the process.
process.on("unhandledRejection", (reason) => {
  console.error(`${LOG_PREFIX} unhandled rejection:`, reason)
})

const argv = process.argv.slice(2)
let resolveExitAction: ((action: "ui_restart" | "exit") => void) | null = null

const result = await runCli(argv, {
  version: VERSION,
  bunVersion: Bun.version,
  startServer: async (options) => {
    const started = await startKannaServer(options)
    if (started.updateManager && options.update) {
      started.updateManager.onChange((snapshot) => {
        if (snapshot.status !== "restart_pending") return
        console.log(`${LOG_PREFIX} update installed, shutting down current process for restart`)
        resolveExitAction?.("ui_restart")
      })
    }

    return started
  },
  fetchLatestVersion: fetchLatestPackageVersion,
  installVersion: installPackageVersion,
  installNightly: () => installNightlyBuild({ log: console.log }),
  openUrl,
  openInMacApp,
  log: console.log,
  warn: console.warn,
})

if (result.kind === "exited") {
  process.exit(result.code)
}

if (result.kind === "restarting") {
  process.exit(result.reason === "startup_update" ? CLI_STARTUP_UPDATE_RESTART_EXIT_CODE : CLI_UI_UPDATE_RESTART_EXIT_CODE)
}

const exitAction = await new Promise<"ui_restart" | "exit">((resolve) => {
  resolveExitAction = resolve

  // The first signal stops cleanly, which marks running turns to resume on
  // the next start. A second is most likely an impatient Ctrl-C: dying then
  // would lose exactly those turns, so it only says what's happening, and a
  // third forces it.
  let signals = 0
  const shutdown = () => {
    signals += 1
    if (signals === 1) resolve("exit")
    else if (signals === 2) console.log(`${LOG_PREFIX} stopping, saving running chats to resume; press Ctrl-C again to quit now`)
    else process.exit(130)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
  exitWithParent(() => {
    if (!result.releasedFromParent?.()) shutdown()
  })
  if (isSupervisedChild()) {
    // `kanna restart`, through the supervisor: stop as for an update, and the
    // supervisor starts the server again.
    process.once(CLI_RESTART_SIGNAL, () => resolve("ui_restart"))
    // In its own process group the server outlives a supervisor killed
    // outright, holding the port with nobody to stop it. Watch for that.
    exitWithParent(() => shutdown(), { [EXIT_WITH_PARENT_ENV_VAR]: "1" })
  }
})

await result.stop()
if (exitAction === "ui_restart") {
  console.log(`${LOG_PREFIX} current process stopped, handing restart back to supervisor`)
}
process.exit(exitAction === "ui_restart" ? CLI_UI_UPDATE_RESTART_EXIT_CODE : 0)
