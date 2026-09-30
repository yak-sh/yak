// Sub-projects: a project filed under another project is part of it.
//
// A project's parent is its own `filed.project`, the property that files a task
// under it, so one walk answers "everything under P" at any depth:
// `.filed.project->P` selects what is filed under P, its sub-projects, what is
// filed under those, and so on down (@yaks/query's walk over a reference
// property, which @yaks/sql and @yaks/match both evaluate). A property holds
// one value, so a project has at most one parent without a rule saying so.
//
// What a walk down cannot answer is the way up, which is {@link lineage}: an
// entity's project and every project above it, nearest first. A sub-project
// with no `repo` of its own lands through the nearest one above it that has
// one, and its agents are owed each common persona along the way
// (@yaks/persona). {@link nesting} refuses the one shape a tree cannot take: a
// project filed under itself, or under a project already under it.

import type { Bundle, Comp, Eid, Hook } from '@yaks/graph'
import { after, each } from '@yaks/fp'
import { Refused } from '@yaks/graph'
import { FILED, PROJECT } from './comp.ts'

/** What reading up a lineage needs: entities by eid, synchronously or not. */
export type Reads = { get: (eids: Eid[]) => Bundle[] | Promise<Bundle[]> }

let parentOf = (b: Bundle | undefined): Eid | undefined => {
  let p = (b?.[FILED] as Comp | undefined)?.project
  return typeof p == 'string' && p ? p : undefined
}

let up = (
  g: Reads,
  eid: Eid | undefined,
  seen: Set<Eid>,
  out: Bundle[],
): Bundle[] | Promise<Bundle[]> => {
  if (!eid || seen.has(eid)) return out
  seen.add(eid)
  return after(g.get([eid]), ([b]) => {
    if (b?.[PROJECT]) out.push(b)
    return up(g, parentOf(b), seen, out)
  })
}

/**
 * The projects an entity is under, nearest first: the entity itself when it is
 * a project, then each project its `filed.project` chain passes through. A
 * task's lineage starts at the project it is filed in. Synchronous over a
 * synchronous storage, a promise over one that returns promises.
 *
 * ```ts
 * import { lineage } from '@yaks/project'
 *
 * // (await lineage(g, 'T-7')).find((p) => p.repo) — where T-7 lands
 * ```
 */
export let lineage = (
  g: Reads,
  eid: Eid,
): Bundle[] | Promise<Bundle[]> => up(g, eid, new Set(), [])

// Where this change files each entity it moves: a removed filing, or a cleared
// project, leaves it under nothing.
let moves = (bundles: Bundle[]): Map<Eid, Eid | undefined> => {
  let out = new Map<Eid, Eid | undefined>()
  for (let b of bundles) {
    let f = b[FILED] as Comp | null | undefined
    if (f === null) out.set(b.entity.eid, undefined)
    else if (f && 'project' in f) out.set(b.entity.eid, parentOf(b))
  }
  return out
}

/**
 * The `precondition` hook that keeps projects a tree: it refuses filing an
 * entity under a project that is already under it, itself included. The
 * parents it walks are the ones this change leaves, so two projects filed under
 * each other in one change are refused too.
 */
export let nesting: Hook = (bundles, tx) => {
  let moved = moves(bundles)
  let parent = (eid: Eid) =>
    moved.has(eid) ? moved.get(eid) : after(tx.get([eid]), ([b]) => parentOf(b))
  let reaches = (
    at: Eid | undefined,
    eid: Eid,
    seen: Set<Eid>,
  ): boolean | Promise<boolean> =>
    !at || seen.has(at) ? false : at == eid ||
      (seen.add(at), after(parent(at), (p) => reaches(p, eid, seen)))
  return after(
    each(
      [...moved],
      null,
      (_, [eid, under]) =>
        after(reaches(under, eid, new Set()), (loop) => {
          if (!loop) return null
          throw new Refused(
            `${eid} cannot be filed under ${under}: ${under} is already under ` +
              `it, and a project's sub-projects form a tree`,
          )
        }),
    ),
    () => bundles,
  )
}
