// The one environment-specific step, kept in the one file that knows about an
// environment. Everything else in this package is standard `Request`,
// `Response` and `WebSocket`; an upgrade is not standard, so it is injected —
// and this is the default for the runtime most hosts start on.
//
// The global is LOOKED UP rather than imported, so this module loads and
// type-checks anywhere, with no Deno types in the package's compile at all.
// Off Deno it throws when called, which is the honest answer: pass your host's
// upgrade.

import type { Socket, Upgrade } from './socket.ts'

type Upgrader = (request: Request) => { socket: Socket; response: Response }

// This runtime's `Deno.upgradeWebSocket`, or null where there is none.
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
 * Deno's WebSocket upgrade, as an {@link Upgrade}. The default for `/ws`; it
 * throws off Deno, where the host passes its own.
 *
 * ```ts
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
