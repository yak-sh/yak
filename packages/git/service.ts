// Host-checkout maintenance: idle, landed worktrees can be reclaimed only
// when no graph session's explicitly attached machine or local process uses
// them. Machine-provisioned sandboxes are their provider's business, not this
// service's. Managed checkout observations remain restore history.

import type { Machine } from '@yaks/machine'
import type { Blobs } from '@yaks/blob'
import { canonical, exists } from './machine.ts'
import type { Comp, Graph } from '@yaks/graph'
import { refEid } from './refs.ts'
import { sleep } from '@yaks/effects'
import {
  type Held,
  idleFor,
  inUse,
  linked,
  machineRun,
  processPaths,
  reclaim,
  reconcile,
  repositoryEid,
  sync,
  worktreeEid,
} from './host.ts'

let HOUR = 3_600_000

/** How long Git must have left a worktree alone before it is taken back. */
export let IDLE = 6 * HOUR
/** How long the service waits between passes. */
export let EVERY = HOUR
/** The graph accepted-ref poll; no machine command when acceptance is unchanged. */
export let SYNC_EVERY = 1_000

export type Options = {
  /** milliseconds without Git touching a worktree (default {@link IDLE}) */
  idle?: number
  /** milliseconds between passes (default {@link EVERY}) */
  every?: number
  /** milliseconds between accepted-ref checks (default 1000) */
  syncEvery?: number
}

/** Take back every idle worktree of the repository at `common` that holds
 * nothing, and return the idle ones kept, with why. */
export let collect = async (
  g: Graph,
  common: string,
  idle: number = IDLE,
  now: number = Date.now(),
  processes: (() => Promise<Set<string>>) | undefined,
  machine: Machine,
): Promise<Record<string, Held>> => {
  await reconcile(g, common, machine)
  let kept: Record<string, Held> = {}
  let repository = repositoryEid(common)
  let live = async () => {
    let paths = new Set<string>()
    if (!g.vocab.comp('session') || !g.vocab.comp('home')) return paths
    let sessions = (await g.read('.session&.home&*')).filter((b) =>
      !['settled', 'stopped', 'failed'].includes(
        String((b.session as Comp).status),
      ) ||
      Boolean(b.process && !b.exit)
    )
    for (let b of sessions) {
      let cwd = (b.home as Comp).cwd
      if (typeof cwd == 'string') paths.add(cwd)
    }
    let ids = sessions.map((b) => (b.home as Comp).machine)
      .filter((id): id is string => typeof id == 'string')
    for (let row of await g.get([...new Set(ids)])) {
      let path = (row.machine as Comp | undefined)?.address
      if (typeof path == 'string') paths.add(path)
    }
    return new Set(
      await Promise.all(
        [...paths].map((path) => canonical(path, machine).catch(() => path)),
      ),
    )
  }
  for (let path of await linked(common, machine)) {
    if (await idleFor(path, now, machine) < idle) continue
    let real = await canonical(path, machine).catch(() => path)
    let [row] = await g.get([worktreeEid(repository, real)])
    let tree = row?.worktree as Comp | undefined
    if (tree?.managed) continue
    if (
      inUse(real, await live()) ||
      inUse(
        real,
        await (processes ? processes() : processPaths(undefined, machine)),
      )
    ) continue
    let held = await reclaim(path, 'refs/heads/main', machine).catch(() =>
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
  host: { graph: Graph; artifacts?: Blobs; machines?: { local?: Machine } },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
  processes?: () => Promise<Set<string>>,
): Promise<void> => {
  let machine = host.machines?.local
  if (!machine) return
  let collected = 0
  let caughtUp = new Map<string, string>()
  let retry = new Map<string, number>()
  for (;;) {
    let now = Date.now()
    let collectDue = !collected || now - collected >= (options.every ?? EVERY)
    for (let r of await host.graph.read('.repository')) {
      let common = (r.repository as Comp).common
      if (typeof common != 'string') continue
      // One repository failing is reported and the pass goes on to the next;
      // what it left is the next pass's to find.
      let accepted =
        (await host.graph.get([refEid(r.entity.eid, 'refs/heads/main')], [
          'ref',
        ]))[0]?.ref as Comp | undefined
      let tip = typeof accepted?.commit == 'string'
        ? accepted.commit
        : undefined
      if (
        host.artifacts && tip && caughtUp.get(common) != tip &&
        now >= (retry.get(common) ?? 0)
      ) {
        retry.set(common, now + 30_000)
        if (!await exists(common, machine)) continue
        // The accepted ref stays in the graph. Its checkout is only a mirror,
        // attached by the host's explicitly lent local capability.
        let listed = await machineRun(machine)([
          '--git-dir=' + common,
          'worktree',
          'list',
          '--porcelain',
        ], common)
        if (listed.ok) {
          for (let record of listed.out.split('\n\n')) {
            let lines = record.split('\n')
            let path = lines.find((line) => line.startsWith('worktree '))
              ?.slice(9)
            if (!path || !lines.includes('branch refs/heads/main')) continue
            let outcome = await sync(host.graph, path, machine, {
              bytes: host.artifacts,
            })
              .catch((error) => {
                console.warn('@yaks/git checkout sync —', path, error)
                return 'failed'
              })
            if (outcome == 'current' || outcome == 'synced') {
              caughtUp.set(common, tip)
              retry.delete(common)
            } else if (outcome != 'failed') {
              console.warn('@yaks/git checkout sync —', path, outcome)
            }
          }
        }
      }
      if (!collectDue || !await exists(common, machine)) continue
      let kept = await collect(
        host.graph,
        common,
        options.idle,
        Date.now(),
        processes,
        machine,
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
    if (collectDue) collected = now
    if (signal.aborted) return
    await sleep(options.syncEvery ?? SYNC_EVERY, signal)
    if (signal.aborted) return
  }
}
