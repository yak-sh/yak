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
// the port is bound; and a call this process was killed in the middle of stays
// `running` with no `exit` on its process, which is exactly the state that
// stops another runner from re-driving it — nobody wants a start-up sweep
// launching a second server.

import type { Bundle, ToolCtx } from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { reconcile, type Runner } from '@yaks/tools'
import { denoListen } from './deno.ts'
import type { Handler } from './route.ts'

/** The port `serve` listens on when neither the call nor the config names
 * one. */
export let PORT = 8787

/** What this tool needs from the host that composed it: the request handler to
 * answer with, the runner whose interrupted calls a process that stays up
 * finishes, the duties it takes over while it is up, and the config
 * that said where to listen. */
export type Serving = {
  config: { db?: string; port?: number; hostname?: string }
  /** what this host answers with. Optional because a host has one only where
   * a plugin built one, and ./routes.ts is that plugin — so a `Serving` put
   * together by hand may carry none. */
  handler?: Handler
  runner: Runner
  duties: (signal?: AbortSignal) => Promise<void>
  stopping: AbortSignal
}

let seconds = (ms: number): string => `${Math.round(ms / 1000)}s`

/** The implementation of the tool ./vocab.json declares. */
export let runs = (host: Serving): Runs => ({
  serve: async (_bundles, ctx: ToolCtx): Promise<Bundle[]> => {
    let handler = host.handler
    // A host that composed this package has a handler; one that does not has
    // nothing to listen with, and binding a port to refuse every request is
    // not a server.
    if (!handler) throw new Error('serve has no handler — compose @yaks/api')
    let port = Number(ctx.args.port ?? host.config.port ?? PORT)
    let hostname = ctx.args.hostname ?? host.config.hostname
    // What a crash left claimed and unanswered, finished before this process
    // takes new requests. A one-shot command must not touch calls another
    // process is running; a process that is about to stay up is the one that
    // can afford to.
    await reconcile(host.runner)
    // And the duties in their long-lived form: the effect sweep and
    // the plugins' timers, each under its own lease, held for as long as this
    // process is up. A one-shot command runs the same duties for one pass on its
    // way in — an HTTP server is not a special kind of process, it is the one
    // that stays. Not awaited: it returns when the host closes.
    void host.duties()
    let at = ''
    let began = Date.now()
    let server = denoListen({
      port,
      ...(typeof hostname == 'string' ? { hostname } : {}),
      onListen: (addr) => {
        at = `http://${addr.hostname}:${addr.port}`
        // The one thing printed while the call is still running, because a
        // person who just started a server wants the address now and the
        // result is a long way off.
        console.error(`serve — ${at} · ${host.config.db ?? 'no db'}`)
      },
    }, handler)
    // A host closing while this is up stops the server too, so a program that
    // shuts its graph down does not leave a port bound over a closed database.
    // It is the unusual way round: a program closes its graph after the call
    // has returned, and a result written while the file is closing is a result
    // nobody stored.
    host.stopping.addEventListener('abort', () => void server.shutdown(), {
      once: true,
    })
    await server.finished
    return [{
      entity: { eid: '$served' },
      content: { body: `served ${at} for ${seconds(Date.now() - began)}` },
    }]
  },
})
