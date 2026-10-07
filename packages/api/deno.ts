// The runtime-specific steps, kept in the one file that knows about a runtime.
// Everything else in this package is standard `Request`, `Response` and
// `WebSocket`. Two things are not standard: upgrading a request to a WebSocket,
// which the application supplies, and binding a TCP port, which the `serve`
// tool does. Both default to the runtime most applications start on.
//
// The `Deno` global is looked up at call time rather than imported, so this
// module loads and type-checks anywhere, with no Deno types in the package's
// compile at all. On another runtime it throws when called, and the error
// names the fix: pass your own `upgrade`.

import type { Socket, Upgrade } from './socket.ts'

type Upgrader = (request: Request) => { socket: Socket; response: Response }

// This runtime's `Deno.upgradeWebSocket`, or null when there is none.
let found = (): Upgrader | null => {
  let host: unknown = globalThis
  if (!host || typeof host != 'object' || !('Deno' in host)) return null
  let deno = host.Deno
  if (!deno || typeof deno != 'object' || !('upgradeWebSocket' in deno)) {
    return null
  }
  let up = deno.upgradeWebSocket
  return typeof up == 'function' ? (request) => up(request) : null
}

/**
 * Deno's WebSocket upgrade, as an {@link Upgrade}. The default for `/ws`; on
 * any other runtime it throws, and the application passes its own.
 *
 * ```ts ignore
 * Deno.serve(api({ graph, upgrade: denoUpgrade }))
 * ```
 */
export let denoUpgrade: Upgrade = (request) => {
  let up = found()
  if (!up) {
    throw new Error('@yaks/api: no Deno.upgradeWebSocket here — pass `upgrade`')
  }
  return up(request)
}

/** What a runtime gives back for a port it is now listening on: the promise
 * that settles once it has stopped, and the way to ask it to stop. */
export type Listener = {
  finished: Promise<void>
  shutdown: () => Promise<void>
}

/** Where a server ended up listening. */
export type Addr = { hostname: string; port: number }

/** How this package asks a runtime to listen on a port. `reusePort` lets
 * another server that asks the same way listen on it too (SO_REUSEPORT, Linux
 * only; Deno needs `--unstable-net`), so a replacement can start answering
 * before the server it replaces stops. */
export type Listen = (
  opts: {
    port: number
    hostname?: string
    reusePort?: boolean
    onListen?: (addr: Addr) => void
  },
  handler: (request: Request) => Response | Promise<Response>,
) => Listener

// This runtime's `Deno.serve`, or null when there is none — found the same way
// as the upgrade above, and for the same reason.
let listener = (): Listen | null => {
  let host: unknown = globalThis
  if (!host || typeof host != 'object' || !('Deno' in host)) return null
  let deno = host.Deno
  if (!deno || typeof deno != 'object' || !('serve' in deno)) return null
  let go = deno.serve
  return typeof go == 'function'
    ? (opts, handler) => go(opts, handler) as Listener
    : null
}

/**
 * Deno's own server, as a {@link Listen} — what the `serve` tool binds a port
 * with (./tools.ts). A runtime that binds its own port, such as a Cloudflare
 * Worker, has no `Deno.serve` and nothing for that tool to do, so this throws
 * there rather than pretending to listen.
 */
export let denoListen: Listen = (opts, handler) => {
  let go = listener()
  if (!go) {
    throw new Error(
      '@yaks/api: no Deno.serve here — this runtime binds its own',
    )
  }
  return go(opts, handler)
}

// The file calls `denoReady` makes, on this runtime's `Deno`, found the same
// way as the two above.
type Files = {
  pid: number
  writeTextFile: (path: string, data: string) => Promise<void>
  remove: (path: string) => Promise<void>
}
let files = (): Files => {
  let host: unknown = globalThis
  let deno = host && typeof host == 'object' && 'Deno' in host
    ? host.Deno
    : null
  if (!deno || typeof deno != 'object' || !('writeTextFile' in deno)) {
    throw new Error('@yaks/api: no Deno here to say a server is ready')
  }
  return deno as Files
}

/**
 * Say this process is serving: its pid, written to `path` for whoever waits
 * on a replacement before stopping the server it replaces (@yaks/cli
 * `restart`). The function returned takes it back.
 */
export let denoReady = async (path: string): Promise<() => Promise<void>> => {
  let fs = files()
  await fs.writeTextFile(path, `${fs.pid}\n`)
  return () =>
    fs.remove(path).catch((error) => {
      if ((error as Error).name != 'NotFound') throw error
    })
}
