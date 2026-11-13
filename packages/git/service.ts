import * as io from '@yaks/file/io'
// Host-checkout maintenance: idle, landed worktrees can be reclaimed only
// when no graph session's explicitly attached machine or local process uses
// them. Machine-provisioned sandboxes are their provider's business, not this
// service's. Managed checkout observations remain restore history.

import type { Comp, Graph } from '@yaks/graph'
import { retained } from './workspace.ts'
import { sleep } from '@yaks/effects'
import {
  discover,
  type Held,
  idleFor,
  inUse,
  linked,
  localFilesystem,
  processPaths,
  reclaim,
  reconcile,
  repositoryEid,
  shelve,
  worktreeEid,
} from './host.ts'

let HOUR = 3_600_000

/** How long Git must have left a worktree alone before it is taken back. */
export let IDLE = 6 * HOUR
/** How long a worktree that still holds work must be left alone before it is
 * shelved (./host.ts `shelve`): its work committed onto its branch and the
 * checkout removed. Three days, past any agent's run. */
export let STALE = 72 * HOUR
/** How long the service waits between passes. */
export let EVERY = HOUR
/** Where agents cut checkouts of their own: Claude Code's, inside the primary
 * checkout. */
export let ROOTS = ['.claude/worktrees']

export type Options = {
  /** milliseconds without Git touching a worktree (default {@link IDLE}) */
  idle?: number
  /** milliseconds without Git touching a worktree that still holds work
   * before it is shelved (default {@link STALE}) */
  stale?: number
  /** milliseconds between passes (default {@link EVERY}) */
  every?: number
  /** directories whose checkouts are agents' own, taken back like managed
   * ones; a relative one is inside the repository's primary checkout
   * (default {@link ROOTS}) */
  roots?: string[]
}

/// within('/r/.claude/worktrees/a', ['/r/.claude/worktrees']) -> true
/// within('/r/.claude/worktrees', ['/r/.claude/worktrees']) -> false
/// within('/r/elsewhere', ['/r/.claude/worktrees']) -> false
/** Whether a checkout lies under one of these directories. */
export let within = (path: string, roots: string[]): boolean =>
  roots.some((root) => path.startsWith(root.replace(/\/+$/, '') + '/'))

// The roots, as real paths: a relative one resolved in the primary checkout
// beside `common`.
let rooted = (common: string, roots: string[]): Promise<string[]> =>
  Promise.all(roots.map((root) => {
    let path = root.startsWith('/')
      ? root
      : common.replace(/\/\.git\/?$/, '') + '/' + root
    return io.realPath(path).catch(() => path)
  }))

let there = (path: string) => io.stat(path).then(() => true, () => false)

/** Take back every idle worktree of the repository at `common` that holds
 * nothing, managed or under one of `roots`, shelve each one `stale` that
 * still holds work, and return the idle ones kept, with why. A `signal` that
 * aborts ends the pass before the next worktree. */
export let collect = async (
  g: Graph,
  common: string,
  idle: number = IDLE,
  now: number = Date.now(),
  processes: () => Promise<Set<string>> = processPaths,
  signal?: AbortSignal,
  roots: string[] = ROOTS,
  stale: number = STALE,
): Promise<Record<string, Held>> => {
  await reconcile(g, common)
  let own = await rooted(common, roots)
  let kept: Record<string, Held> = {}
  let filesystem = await localFilesystem(g)
  let repository = repositoryEid(common, filesystem.entity.eid)
  for (let path of await linked(common)) {
    if (signal?.aborted) break
    let quiet = await idleFor(path, now)
    if (quiet < idle) continue
    let real = await io.realPath(path).catch(() => path)
    let [row] = await g.get([worktreeEid(repository, real)])
    if (!(row?.worktree as Comp | undefined)?.managed && !within(real, own)) {
      continue
    }
    let seen = await discover(g, path).catch(() => row)
    if (!seen || await retained(g, seen.entity.eid)) continue
    if (inUse(real, await processes())) continue
    let failed = () => 'failed' as Held
    let held = await reclaim(path, 'refs/heads/main').catch(failed)
    // Work left this long is no agent's in progress: it moves onto its
    // branch, where it costs no disk, and the checkout goes.
    if (held && held != 'failed' && quiet >= stale) {
      held = await shelve(path, () => discover(g, path)).catch(failed)
    }
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
  host: {
    graph: Graph
    report?: (
      error: unknown,
      context: { tags: Record<string, string> },
    ) => void | Promise<void>
  },
  options: Options = {},
  signal: AbortSignal = AbortSignal.abort(),
  processes: () => Promise<Set<string>> = processPaths,
): Promise<void> => {
  let report = (error: unknown, root: string) =>
    host.report
      ? host.report(error, {
        tags: { package: '@yaks/git', step: 'worktree collection', root },
      })
      : console.error('@yaks/git worktree collection —', root, error)
  // A pass the service is told to stop (its lease taken by another process)
  // ends between worktrees; a one-shot pass runs whole.
  let stopping = signal.aborted ? undefined : signal
  for (;;) {
    let filesystem = await localFilesystem(host.graph)
    for (
      let r of await host.graph.read(
        '.repository.workspace=' + filesystem.entity.eid,
      )
    ) {
      if (stopping?.aborted) return
      let common = (r.repository as Comp).common
      if (typeof common != 'string') continue
      // One repository failing is reported and the pass goes on to the next;
      // what it left is the next pass's to find.
      let kept: Record<string, Held> = await (await there(common)
        ? collect(
          host.graph,
          common,
          options.idle,
          Date.now(),
          processes,
          stopping,
          options.roots,
          options.stale,
        )
        : reconcile(host.graph, common).then(() => ({}))).catch(
          async (error) => {
            await report(error, common)
            return {}
          },
        )
      let failed = Object.keys(kept).filter((p) => kept[p] == 'failed')
      if (failed.length) {
        await report(
          new Error(`Could not take back ${failed.join(', ')}`),
          common,
        )
      }
    }
    if (signal.aborted) return
    await sleep(options.every ?? EVERY, signal)
    if (signal.aborted) return
  }
}
