// The implementation behind the `tool: true` declaration in ./vocab.json,
// exported as `@yaks/api/tools`.
//
// `serve` is the only one, and it is what makes one process the one answering
// HTTP for a graph. It is a tool rather than a command of the `yak` program,
// because listening on a port is something a package contributes, the same way
// a package contributes components, rules and routes: `yak` reads the config
// and loads the plugins, and this package brings the verb. A config whose
// plugins do not include @yaks/api has no `serve` to run, and a config that
// names it can be served by anything that lists its tools.
//
// It acts on the machine rather than on the graph — it binds a port there —
// the way `land` acts on a checkout, so it belongs to the process that opened
// the graph in the first place. What it listens with is already assembled:
// `host.handler` is this package's own doors with the listed plugins' routes
// in front of them, built by ./routes.ts when the host was composed.
//
// A call that does not return. The runner writes the call row and claims it
// `running` before the tool starts, and writes the result and `done` when it
// returns (@yaks/tools). This one returns when the server stops, so the record
// of a server that is up is a call still marked `running`, and the record of
// one that has stopped is its result, carrying the address it answered on and
// how long it answered for. Two consequences worth knowing: nothing is printed
// until it stops, which is why the address is reported on stderr as soon as
// the port is bound; and a server is never run again by a sweep. Stopped by a
// signal, it stops taking requests and closes its sockets, lets the requests
// in flight finish for a grace of seconds, then cancels reads, cuts every
// answer still streaming that no admitted write is producing (an MCP call's
// event stream), and waits for admitted writes before returning. The reader then closes after the request
// owners finish, preserving edits. A killed process leaves its call claimed;
// the next server closes that process and interrupts the call (host.ts `bury`).
//
// A restart is invisible when the replacement answers before this one stops
// taking requests. `share` lets two servers listen on one port at once, and
// `ready` names a file written once this one is listening, which is what a
// supervisor waits on before stopping the old one (@yaks/cli `restart`).
// Sharing is asked for, never assumed: a second server started by mistake on a
// taken port is refused rather than quietly handed half its requests.

import { requests } from './requests.ts'
import type { Bundle } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import type { Runs } from '@yaks/graph/tools'
import type { Runner } from '@yaks/tools'
import { CallError } from '@yaks/tools/errors'
import { denoListen, denoReady } from './deno.ts'
import type { Handler, Route } from './route.ts'

/** The port `serve` listens on when neither the call nor the config names
 * one. */
export let PORT = 8787

/** The interface `serve` binds when neither the call nor the config names
 * one: this machine alone. A server that answers every request as the machine
 * itself (@yaks/cli's `doorman`) is offered to a network only when a config
 * says so. */
export let HOSTNAME = '127.0.0.1'

/** Where a client on this machine reaches the server a config serves: its
 * port, else {@link PORT}, at its hostname, or this machine's own address
 * where it names none or every interface.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { served } from '@yaks/api/tools'
 *
 * assertEquals(served({}), 'http://127.0.0.1:8787')
 * assertEquals(
 *   served({ port: 5173, hostname: '0.0.0.0' }),
 *   'http://127.0.0.1:5173',
 * )
 * ```
 */
export let served = (
  config: { port?: number; hostname?: string },
): string => {
  let { hostname = HOSTNAME, port = PORT } = config
  let any = ['0.0.0.0', '::', '[::]'].includes(hostname)
  return `http://${any ? HOSTNAME : hostname}:${port}`
}

/** Seconds a stopping server lets requests finish before cancelling reads
 * and cutting streamed answers. Admitted writes drain even after this grace
 * expires. */
export let GRACE = 10

/** What this tool needs from the host that composed it: the request handler to
 * answer with, the duties it takes over while it is up, and the config
 * that said where to listen. */
export type Serving = {
  config: { db?: string; port?: number; hostname?: string }
  /** what this host answers with. Optional because a host has one only where
   * a plugin built one, and ./routes.ts is that plugin — so a `Serving` put
   * together by hand may carry none. */
  handler?: Handler
  /** the plugins' routes: each that `says` what it is is told on listening */
  routes?: Pick<Route, 'path' | 'says'>[]
  runner: Runner
  duties: (signal?: AbortSignal) => Promise<void>
  /** close for the processes on this machine that ended without closing
   * (@yaks/cli host.ts `bury`); a host that tracks no processes has none */
  bury?: () => Promise<unknown>
  stopping: AbortSignal
  /** warm the host (@yaks/host `Host.warm`): a server taking over a port
   * (`share`) warms before it listens, any other once it listens, and every
   * server before it says it is ready; one that fails ends the server */
  warm?: () => Promise<void>
}

let seconds = (ms: number): string => `${Math.round(ms / 1000)}s`

/** What a server says once it listens at `at`: the address and the graph,
 * then each door a route says something about, at `origin`, where a client on
 * this machine reaches it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { listening } from '@yaks/api/tools'
 *
 * assertEquals(
 *   listening('http://0.0.0.0:80', 'http://127.0.0.1:80', {
 *     config: { db: 'g.db' },
 *     routes: [{ path: '/', says: 'the canvas' }, { path: '/ws' }],
 *   }),
 *   'serve — http://0.0.0.0:80 · g.db\n' +
 *     '  http://127.0.0.1:80/  the canvas\n' +
 *     'Ctrl-C stops it',
 * )
 * ```
 */
export let listening = (
  at: string,
  origin: string,
  host: Pick<Serving, 'config' | 'routes'>,
): string => {
  let told = (host.routes ?? []).filter((r) => r.says)
    .sort((a, b) => a.path.localeCompare(b.path))
  let wide = Math.max(0, ...told.map((r) => r.path.length))
  return [
    `serve — ${at} · ${host.config.db ?? 'no db'}`,
    ...told.map((r) => `  ${origin}${r.path.padEnd(wide)}  ${r.says}`),
    'Ctrl-C stops it',
  ].join('\n')
}

/** The implementation of the tool ./vocab.json declares. */
export let runs = (host: Serving): Runs => ({
  serve: async (call): Promise<Bundle[]> => {
    let handler = host.handler
    // A host that composed this package has a handler; one that does not has
    // nothing to listen with, and binding a port to refuse every request is
    // not a server.
    if (!handler) throw new Error('serve has no handler — compose @yaks/api')
    let args = argsOf(call)
    let port = Number(args.port ?? host.config.port ?? PORT)
    let hostname = String(args.hostname ?? host.config.hostname ?? HOSTNAME)
    let grace = Number(args.grace ?? GRACE) * 1000
    // Close for dead processes before accepting requests. Running their
    // unanswered calls belongs to recovery, independently of listening.
    await host.bury?.()
    // A server sharing a port takes requests from the one it replaces as soon
    // as it listens, so it listens warm. One starting alone listens at once,
    // since nothing answers there until it does, and warms once it listens.
    if (args.share === true) await host.warm?.()
    let at = ''
    let began = Date.now()
    let active = requests(handler)
    let server
    try {
      server = denoListen({
        port,
        hostname,
        reusePort: args.share === true,
        onListen: (addr) => {
          at = `http://${addr.hostname}:${addr.port}`
          // The one thing printed while the call is still running, because a
          // person who just started a server wants the address now and the
          // result is a long way off.
          console.error(listening(at, served(addr), host))
        },
      }, active.handle)
    } catch (error) {
      if (error instanceof Error && error.name == 'AddrInUse') {
        throw new CallError('address', `${hostname}:${port} is already in use`)
      }
      throw error
    }
    // Stopping: no new connection, every socket closed, and the requests in
    // flight let finish until the grace is up. Reads and streamed answers are
    // then cut; admitted writes finish before the listener and graph close.
    let cut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let graced = new Promise<void>((done) => {
      let stop = () => {
        void server.shutdown()
        timer = setTimeout(() => {
          cut = true
          console.error('serve drain —', JSON.stringify(active.open()))
          active.cancel()
          done()
        }, grace)
      }
      if (host.stopping.aborted) stop()
      else host.stopping.addEventListener('abort', stop, { once: true })
    })
    let unready: (() => Promise<void>) | undefined
    try {
      await host.warm?.()
      if (typeof args.ready == 'string') unready = await denoReady(args.ready)
      // And the duties in their long-lived form: the effect pool, where this
      // process serves `effects`, and the plugins' services, each under its
      // own lease, for as long as this process is up. Commands passing
      // through leave these roles to a host that stays up.
      // Not awaited: it returns when the host closes.
      if (!host.stopping.aborted) void host.duties()
      await Promise.race([server.finished, graced])
    } finally {
      // Already stopping unless saying it was ready failed; never awaited,
      // since a shutdown settles only once every request has.
      void server.shutdown()
      clearTimeout(timer)
      active.cancel()
      let phase = 'request cleanup'
      let waiting = setTimeout(() =>
        console.error(
          `serve drain — waiting for ${phase}`,
          JSON.stringify(active.open()),
        ), 5000)
      try {
        await active.drain()
        phase = 'listener'
        await server.finished
      } finally {
        clearTimeout(waiting)
      }
      await unready?.()
    }
    return [{
      entity: { eid: '$served' },
      content: {
        body: `served ${at} for ${seconds(Date.now() - began)}` +
          (cut ? `, cutting what was open after ${seconds(grace)}` : ''),
      },
      output: { source: call.entity.eid },
    }]
  },
})
