// The code behind the effects this package declares (./vocab.json), exported
// as `@yaks/spawn/effects`. It runs after a transaction commits, in whichever
// process works the effects, and decides what that commit means for a managed
// session.
//
// Two components, both defined elsewhere:
//
// - a `using` written on an entry is a request — this session wants that
//   provider, that model, that effort. When the provider is a command line,
//   answering the request means running that command.
// - a `stop` written on the session's own entity, next to the `process` it is
//   running, kills the run.
//
// Picking up the agents a restart left running is not a commit's business: it
// is the duty at `@yaks/spawn/service`, held by the process that stays up.
//
// No handler stays open while the work runs. Launching waits on systemd and
// tailing a log runs for as long as the agent does, so a handler that awaited
// either would make a commit wait on an agent. Each one reads what it needs,
// starts the work, and returns; failures go to `report` and never back into the
// transaction, which is what @yaks/effects guarantees for every handler.
//
// Config sets the checkout agents work from, the directory each run's own
// checkout is cut under, and how often its log is read:
//
// ```json
// { "use": "@yaks/spawn",
//   "with": { "cwd": "/srv/repo", "worktrees": "/srv/runs", "poll": 250 } }
// ```
//
// Providers are not in it: an adapter is a function, so a server with one of
// its own calls {@link spawning} from a module of its own.

import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import { EXIT, PROCESS } from '@yaks/process'
import { down, type Opts, start } from './run.ts'

/** What these handlers are given: the open graph. */
export type Host = { graph: Graph; stopping?: AbortSignal }

/** What config can set — the JSON-expressible half of {@link Opts}. */
export type Options = {
  /** where an agent runs (default the server's own cwd), or with `worktrees`
   * the checkout each run's own is cut from */
  cwd?: string
  /** where each run gets a checkout of its own (@yaks/spawn `Opts`) */
  worktrees?: string
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
  (await g.get([eid]))[0]

/**
 * The same handlers, with providers of your own added.
 *
 * ```ts ignore
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
  (o: Opts = {}) => (host: Host, options: Options = {}): Handlers => {
    let opts: Opts = { ...options, ...o, signal: host.stopping }
    let report = o.report ?? ((err: unknown) => console.error('spawn —', err))
    return {
      // The request. A `using` recorded on an `ask` row says what was
      // served, not what is wanted, and a session that is already running was
      // started the first time round: either way there is nothing to start.
      spawn_start: async (e) => {
        let entry = await one(host.graph, e.entity.eid)
        if (!entry?.entry || entry.ask) return
        let session = String(comp(entry, 'entry')?.session ?? '')
        if (!session) return
        let row = await one(host.graph, session)
        if (!row || row[PROCESS]) return
        start(host.graph, session, opts).catch(report)
      },
      // Kill. A `stop` on an entry only marks the end of a transcript; only
      // a `stop` on the entity that is running a process means kill it.
      spawn_stop: async (e) => {
        let row = await one(host.graph, e.entity.eid)
        if (!row?.[PROCESS] || row[EXIT] != null) return
        down(host.graph, e.entity.eid, opts).catch(report)
      },
    }
  }

/** The handlers, with the providers this package ships. */
export let effects: (host: Host, options?: Options) => Handlers = spawning()
