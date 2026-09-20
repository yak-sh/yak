// What a commit MEANS about a managed session: the `effects` facet a host
// takes (`@yaks/spawn/effects`).
//
// Two words, and both are already in the vocabulary. A `using` written on an
// entry is a REQUEST — this transcript wants that provider, that model, that
// effort — and where the provider is a command, answering it is starting the
// command. A `stop` written on the session's own entity, beside the process it
// is running, is the brake.
//
// Neither handler holds the effect open: a launch waits on systemd and a tail
// runs for as long as the agent does, and an effect that waited on either
// would be a commit waiting on an agent. So each reads what it needs, hands
// the work to the run, and returns; a failure goes to `report`, never into the
// batch, which is what @yaks/effects promises about every handler.
//
// What the config says here is where the agent RUNS — its cwd, and the beat
// its log is read on:
//
// ```json
// { "use": "@yaks/spawn", "with": { "cwd": "/srv/work", "poll": 250 } }
// ```
//
// The providers themselves are not in it: an adapter is a function, and a
// host with one of its own composes {@link spawning} in a module of its own.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Watch } from '@yaks/effects'
import { EXIT, PROCESS } from '@yaks/process'
import { down, type Opts, start } from './run.ts'

/** What the facet is handed: the graph, once it is open. */
export type Host = { graph: Graph }

/** What a config says to this plugin — the JSON half of {@link Opts}. */
export type Options = {
  /** where an agent runs (default the server's own cwd) */
  cwd?: string
  /** where @yaks/process keeps its files */
  dir?: string
  /** how often a log and an ending are read (ms) */
  poll?: number
  /** how long a stopped agent has after TERM before KILL (ms) */
  grace?: number
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let one = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.storage.tx((tx) => tx.get([eid])))[0]

/**
 * The effects, with providers of your own.
 *
 * ```ts
 * import { spawning } from '@yaks/spawn/effects'
 * import { adapters } from '@yaks/spawn'
 *
 * export let effects = spawning({ adapters: { ...adapters, mine } })
 * ```
 *
 * A host that wants the package's own providers names the package in its
 * config and gets {@link effects}, which is this with nothing added.
 */
export let spawning =
  (o: Opts = {}) => (host: Host, options: Options = {}): Watch[] => {
    let opts: Opts = { ...options, ...o }
    let report = o.report ?? ((err: unknown) => console.error('spawn —', err))
    return [{
      comp: 'using',
      // The request. A `using` recorded on an ASK is what was served, not what
      // is wanted, and a session already running was answered the first time:
      // either way there is nothing to start.
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
      // The brake. A `stop` on an entry is a mark in a transcript; only one on
      // the entity that is RUNNING something is an order to take it down.
      created: async (e) => {
        let row = await one(host.graph, e.entity.eid)
        if (!row?.[PROCESS] || row[EXIT] != null) return
        down(host.graph, e.entity.eid, opts).catch(report)
      },
    }]
  }

/** The facet a host takes, with the providers this package ships. */
export let effects: (host: Host, options?: Options) => Watch[] = spawning()
