// The one runtime-specific step, kept in the one file that knows about a
// runtime. Everything else in this package is standard `Request`, `Response`
// and `WebSocket`; a WebSocket upgrade is not standard, so the application
// supplies one — and this is the default for the runtime most applications
// start on.
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
