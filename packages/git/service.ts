// Host-checkout maintenance: idle, landed worktrees can be reclaimed only
// when no graph session's explicitly attached machine or local process uses
// them. Machine-provisioned sandboxes are their provider's business, not this
// service's. Managed checkout observations remain restore history.

import type { Comp, Graph } from '@yaks/graph'
import { sleep } from '@yaks/effects'
import {
  discover,
  type Held,
  idleFor,
  inUse,
  linked,
  processPaths,
  reclaim,
  reconcile,
  repositoryEid,
  worktreeEid,
} from './host.ts'

let HOUR = 3_600_000

/** How long Git must have left a worktree alone before it is taken back. */
export let IDLE = 6 * HOUR
/** How long the service waits between passes. */
export let EVERY = HOUR

export type Options = {
  /** milliseconds without Git touching a worktree (default {@link IDLE}) */
  idle?: number
  /** milliseconds between passes (default {@link EVERY}) */
  every?: number
}

let there = (path: string) => Deno.stat(path).then(() => true, () => false)

let text = (value: unknown): value is string => typeof value == 'string'

/** A session with a home, and the paths it works in: its cwd and its
 * machine's address, as real paths. */
type Seat = { session: string; paths: Set<string> }

// Where every session with a home works, read for its home alone. A session's
// status is derived from its transcript (@yaks/session), dear enough that
// reading it of every session took a minute, in one statement that held the
// worker's thread; asked of every session for each idle worktree, it held a
// worker for hours and let every lease it renews lapse.
let seats = async (g: Graph): Promise<Seat[]> => {
  if (!g.vocab.comp('session') || !g.vocab.comp('home')) return []
  let props = ['cwd', 'machine'].filter((p) => g.vocab.prop('home', p))
  let rows = await g.rows(
    `.session&.home .fields=${
      ['entity.eid', ...props.map((p) => `home.${p}`)].join(',')
    }`,
  ) as Record<string, unknown>[]
  let ids = [...new Set(rows.map((r) => r['home.machine']).filter(text))]
  let addresses = new Map(
    (ids.length ? await g.get(ids, ['machine']) : []).map((b) => [
      b.entity.eid,
      (b.machine as Comp | undefined)?.address,
    ]),
  )
  let reals = new Map<string, Promise<string>>()
  let real = (path: string) => {
    let found = reals.get(path)
    if (!found) {
      reals.set(path, found = Deno.realPath(path).catch(() => path))
    }
    return found
  }
  return Promise.all(rows.map(async (r) => ({
    session: String(r.eid),
    paths: new Set(
      await Promise.all(
        [r['home.cwd'], addresses.get(String(r['home.machine']))]
          .filter(text).map(real),
      ),
    ),
  })))
}

// Whether any of these sessions still holds its checkout: its transcript is
// not over, or its process still runs. Only they are asked their status.
let holding = async (g: Graph, sessions: string[]): Promise<boolean> => {
  if (!sessions.length) return false
  let comps = ['session', 'process', 'exit'].filter((c) => g.vocab.comp(c))
  return (await g.get(sessions, comps)).some((b) =>
    !['settled', 'stopped', 'failed'].includes(
      String((b.session as Comp | undefined)?.status),
    ) || Boolean(b.process && !b.exit)
  )
}

/** Take back every idle worktree of the repository at `common` that holds
 * nothing, and return the idle ones kept, with why. A `signal` that aborts
 * ends the pass before the next worktree. */
export let collect = async (
  g: Graph,
  common: string,
  idle: number = IDLE,
  now: number = Date.now(),
  processes: () => Promise<Set<string>> = processPaths,
  signal?: AbortSignal,
): Promise<Record<string, Held>> => {
  await reconcile(g, common)
  let kept: Record<string, Held> = {}
  let repository = repositoryEid(common)
  // Read once a pass, at the first worktree it is needed for.
  let seated: Promise<Seat[]> | undefined
  for (let path of await linked(common)) {
    if (signal?.aborted) break
    if (await idleFor(path, now) < idle) continue
    let real = await Deno.realPath(path).catch(() => path)
    let [row] = await g.get([worktreeEid(repository, real)])
    let tree = row?.worktree as Comp | undefined
    if (tree?.managed) continue
    if (tree) await discover(g, path).catch(() => {})
    let on = (await (seated ??= seats(g)))
      .filter((s) => inUse(real, s.paths))
      .map((s) => s.session)
    if (await holding(g, on) || inUse(real, await processes())) continue
    let held = await reclaim(path, 'refs/heads/main').catch(() =>
      'failed' as Held
    )
    if (held) kept[path] = held
  }
  return kept
}

/** Collect every repository the graph knows that is on this machine, for as
 * long as `signal` lets it: one pass when it has already aborted, the way a
 * one-shot command runs a service. A removal Git refused is reported; a
 * worktree kept for what it holds is not, since that is an agent's work in
 * progress. */
export let service = async (
  host: { graph: Graph },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
  processes: () => Promise<Set<string>> = processPaths,
): Promise<void> => {
  // A pass the service is told to stop (its lease taken by another process)
  // ends between worktrees; a one-shot pass runs whole.
  let stopping = signal.aborted ? undefined : signal
  for (;;) {
    for (let r of await host.graph.read('.repository')) {
      if (stopping?.aborted) return
      let common = (r.repository as Comp).common
      if (typeof common != 'string' || !await there(common)) continue
      // One repository failing is reported and the pass goes on to the next;
      // what it left is the next pass's to find.
      let kept = await collect(
        host.graph,
        common,
        options.idle,
        Date.now(),
        processes,
        stopping,
      ).catch(
        (error) => {
          console.warn('@yaks/git worktree collection —', common, error)
          return {} as Record<string, Held>
        },
      )
      let failed = Object.keys(kept).filter((p) => kept[p] == 'failed')
      if (failed.length) {
        console.warn('@yaks/git could not take back', failed.join(', '))
      }
    }
    if (signal.aborted) return
    await sleep(options.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}
