// The work this package keeps doing while a process is up
// (`@yaks/git/service`): taking back the worktrees nobody takes back. An agent
// cuts a worktree for its task, lands it and moves on, and nothing removed it:
// 228 of them, 73 GB, filled the root disk in two days. The harness takes back
// the worktrees it creates when their session ends (@yaks/harness
// worktrees.ts). This takes back every other one, in every repository the
// graph knows, once it holds nothing (`holds`) and Git has not touched it for
// `idle`.
//
// Holding nothing is what makes it safe: a clean worktree whose commits are on
// another branch loses nothing when it goes, and Git's own refusal stands
// behind that test. The idle wait only spares an agent still standing in a
// worktree it has just landed. A worktree the harness created (`managed`) is
// left to the harness, which brings one back when its session resumes; one
// that has a row is brought up to date before it goes, as the harness does,
// so the row records the commit it stood at.

import type { Comp, Graph } from '@yaks/graph'
import { sleep } from '@yaks/effects'
import {
  discover,
  type Held,
  idleFor,
  linked,
  reclaim,
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

/** Take back every idle worktree of the repository at `common` that holds
 * nothing, and return the idle ones kept, with why. */
export let collect = async (
  g: Graph,
  common: string,
  idle: number = IDLE,
  now: number = Date.now(),
): Promise<Record<string, Held>> => {
  let kept: Record<string, Held> = {}
  let repository = repositoryEid(common)
  for (let path of await linked(common)) {
    if (await idleFor(path, now) < idle) continue
    let real = await Deno.realPath(path).catch(() => path)
    let [row] = await g.get([worktreeEid(repository, real)])
    let tree = row?.worktree as Comp | undefined
    if (tree?.managed) continue
    if (tree) await discover(g, path).catch(() => {})
    let held = await reclaim(path).catch(() => 'failed' as Held)
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
): Promise<void> => {
  for (;;) {
    for (let r of await host.graph.read('.repository')) {
      let common = (r.repository as Comp).common
      if (typeof common != 'string' || !await there(common)) continue
      // One repository failing is reported and the pass goes on to the next;
      // what it left is the next pass's to find.
      let kept = await collect(host.graph, common, options.idle).catch(
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
