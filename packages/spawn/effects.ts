// The effect handlers this package exports as `@yaks/spawn/effects`. They run
// after a transaction commits, and decide what that commit means for a managed
// session. A server that lists `@yaks/spawn` in its `plugins` config loads
// them.
//
// Three components, all defined elsewhere:
//
// - a `using` written on an entry is a request — this session wants that
//   provider, that model, that effort. When the provider is a command line,
//   answering the request means running that command.
// - a `stop` written on the session's own entity, next to the `process` it is
//   running, kills the run.
// - a `process` row written for the server's own process means the server is
//   starting up: time to pick up the agents a restart left running.
//
// No handler stays open while the work runs. Launching waits on systemd and
// tailing a log runs for as long as the agent does, so a handler that awaited
// either would make a commit wait on an agent. Each one reads what it needs,
// starts the work, and returns; failures go to `report` and never back into the
// transaction, which is what @yaks/effects guarantees for every handler.
//
// Config sets the working directory the agent runs in and how often its log is
// read:
//
// ```json
// { "use": "@yaks/spawn", "with": { "cwd": "/srv/work", "poll": 250 } }
// ```
//
// Providers are not in it: an adapter is a function, so a server with one of
// its own calls {@link spawning} from a module of its own.

import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { take, type Watch } from '@yaks/effects'
import { EXIT, PROCESS } from '@yaks/process'
import { down, type Opts, resume, start } from './run.ts'

/** Lease name for picking up the agents a restart left running — one server
 * process at a time, so two starting together do not both tail the same
 * log. */
export let ADOPT = '@yaks/spawn'

/** What these handlers are given: the open graph, the eid of the server's own
 * process (@yaks/cli `Host.me`), and whether it runs its duties (@yaks/cli
 * `Config.duties`). A new `process` row is either the server recording itself or
 * a child it just launched, and only the first means the server is starting
 * up. */
export type Host = { graph: Graph; me: Eid; config?: { duties?: boolean } }

/** What config can set — the JSON-expressible half of {@link Opts}. */
export type Options = {
  /** where an agent runs (default the server's own cwd) */
  cwd?: string
  /** where @yaks/process keeps its files */
  dir?: string
  /** how often a log and an ending are read (ms) */
  poll?: number
  /** how long a killed agent gets after SIGTERM before SIGKILL (ms) */
  grace?: number
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let one = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]

/**
 * The same handlers, with providers of your own added.
 *
 * ```ts
 * import { spawning } from '@yaks/spawn/effects'
 * import { adapters } from '@yaks/spawn'
 *
 * export let effects = spawning({ adapters: { ...adapters, mine } })
 * ```
 *
 * A server that wants only the providers this package ships names the
 * package in its config and gets {@link effects}, which is this with nothing
 * added.
 */
export let spawning =
  (o: Opts = {}) => (host: Host, options: Options = {}): Watch[] => {
    let opts: Opts = { ...options, ...o }
    let report = o.report ?? ((err: unknown) => console.error('spawn —', err))
    return [{
      comp: 'using',
      // The request. A `using` recorded on an `ask` row says what was
      // served, not what is wanted, and a session that is already running was
      // started the first time round: either way there is nothing to start.
      created: async (e) => {
        let entry = await one(host.graph, e.entity.eid)
        if (!entry?.entry || entry.ask) return
        let session = String(comp(entry, 'entry')?.session ?? '')
        if (!session) return
        let row = await one(host.graph, session)
        if (!row || row[PROCESS]) return
        start(host.graph, session, opts).catch(report)
      },
    }, {
      comp: 'stop',
      // Kill. A `stop` on an entry only marks the end of a transcript; only
      // a `stop` on the entity that is running a process means kill it.
      created: async (e) => {
        let row = await one(host.graph, e.entity.eid)
        if (!row?.[PROCESS] || row[EXIT] != null) return
        down(host.graph, e.entity.eid, opts).catch(report)
      },
    }, {
      comp: PROCESS,
      // This server process starting up. An agent outlives whoever launched
      // it, by design, so a fresh server finds runs it has no memory of — a pid
      // in a row, a log file with unread lines in it — and one pass picks both
      // back up: liveness from the pidfile, the transcript from where it
      // stands.
      //
      // This fires on the birth of the row the server wrote for itself
      // (@yaks/process `started`), which is why comparing against `host.me` is
      // the whole guard: every other `process` row born here belongs to a
      // child, and adopting a child we just launched would tail it twice.
      //
      // The lease keeps two servers that started together from both adopting.
      // It is taken and never released: whoever got it is following those runs
      // now, and a second tail over one log would import every line twice.
      created: async (e) => {
        if (e.entity.eid != host.me || host.config?.duties == false) return
        if (!await take(host.graph, ADOPT, { holder: host.me })) return
        await resume(host.graph, opts).catch(report)
      },
    }]
  }

/** The handlers, with the providers this package ships. */
export let effects: (host: Host, options?: Options) => Watch[] = spawning()
