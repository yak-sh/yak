// A write that changes nothing is no write. A patch is compared with what the
// graph holds before anything acts on it: a component whose every property
// already holds the value the patch gives it, or whose removal names a
// component the entity does not have, leaves the batch. An entity left with
// nothing to say leaves it whole, so nothing stamps it `updated`, journals it,
// fires a rule or an effect on it, or wakes whoever is watching it.
//
// It runs twice: before the rules, so a caller repeating what is stored
// triggers nothing, and before the write, so a rule or hook repeating it
// writes nothing either. An entity the graph does not hold, or holds only as a
// tombstone, is left alone: a write gives it exactly the components it names
// (./mutate.ts), so every one of them is a change. A delete is left alone too,
// and so is a bundle carrying `$touch`, whose writer knows the graph's copy is
// not the truth: a page's write goes to the server whatever the page held
// (@yaks/sync).
//
// What leaves is the caller's still: `apply()` hands each entity, and each
// component that left a changed one, back where the caller put it in its
// return value, so a caller that writes what is stored learns it is stored.
// An entity's components leave the same way whatever else the batch holds.

import { after, same } from '@yaks/fp'
import type { Bundle, Comp, Eid } from './bundle.ts'
import { alive, comps, dead } from './bundle.ts'
import { merged } from './gather.ts'
import { writers } from './stamp.ts'
import type { ReadTx } from './storage.ts'

/** Whether a patch to one component leaves `held` as it was: a removal of one
 * it lacks, or a value for each property that it already holds. */
/// idle(null, undefined) -> true
/// idle({ title: 'Dune' }, { title: 'Dune', body: 'x' }) -> true
/// idle({ title: null }, { body: 'x' }) -> true
/// idle({ title: 'Dune' }, { title: 'Emma' }) -> false
/// idle({}, undefined) -> false
export let idle = (patch: Comp | null, held: Comp | undefined): boolean =>
  patch == null ? held == null : !!held &&
    Object.entries(patch).every(([p, v]) => same(v ?? null, held[p] ?? null))

// The keys a bundle carries for the pipeline alone: who wrote it, when, what
// they read, and what a phase before this one read for a later one
// (@yaks/effects rides its reading of every entity on `$before`, and the
// subjects of its targeted effects on `$effectTargets`). Any other `$` key
// asks a plugin for something (`$num`, a number), so a bundle carrying one
// stays in the batch, if only as its entity.
let bookkeeping = new Set([
  '$actor',
  '$at',
  '$was',
  '$quiet',
  '$before',
  '$effectTargets',
])
let asks = (b: Bundle): boolean =>
  Object.keys(b).some((k) => k[0] == '$' && !bookkeeping.has(k))

// What of a bundle changes its stored row, and what would leave it as it is:
// the bundle without its idle components and those components on their own,
// or nothing to keep when nothing would change.
let changes = (
  b: Bundle,
  row: Bundle | undefined,
): [Bundle | undefined, Bundle | undefined] => {
  if (dead(b) || b.$prune || b.$touch || !alive(row)) return [b, undefined]
  let still = comps(b).filter(([c, patch]) => idle(patch, row[c] as Comp))
  if (!still.length) return [b, undefined]
  let moves = (k: 'num' | 'archetype') =>
    b.entity[k] !== undefined && b.entity[k] !== (row.entity[k] ?? null)
  if (
    still.length == comps(b).length && !moves('num') && !moves('archetype') &&
    !asks(b)
  ) return [undefined, b]
  let out = { ...b }
  let part: Bundle = { entity: { eid: b.entity.eid } }
  for (let [c, patch] of still) delete out[c], part[c] = patch
  return [out, part]
}

/**
 * The batch without what it would not change, read through `tx`, and what
 * left it: the bundles that left whole and the components that left a kept
 * one. A bundle that leaves takes no writer with it: every entity still in
 * the batch keeps the one it had.
 */
export let unchanged = (
  bundles: Bundle[],
  tx: ReadTx,
):
  | { kept: Bundle[]; idle: Bundle[] }
  | Promise<{
    kept: Bundle[]
    idle: Bundle[]
  }> => {
  let named = new Map<Eid, Set<string>>()
  for (let b of bundles) {
    if (dead(b) || b.$prune || b.$touch || !comps(b).length) continue
    let set = named.get(b.entity.eid) ?? new Set()
    for (let [c] of comps(b)) set.add(c)
    named.set(b.entity.eid, set)
  }
  if (!named.size) return { kept: bundles, idle: [] }
  let names = [...new Set([...named.values()].flatMap((s) => [...s]))]
  return after(tx.get([...named.keys()], names), (rows) => {
    // Each row with the batch's earlier patches folded in, so a later patch
    // is compared with what an earlier one in the same batch left.
    let held = new Map(rows.map((r) => [r.entity.eid, r]))
    let kept: Bundle[] = []
    let left: Bundle[] = []
    let parts: Bundle[] = []
    for (let b of bundles) {
      let eid = b.entity.eid
      let row = held.get(eid)
      let [out, part] = changes(b, row)
      if (!out) {
        left.push(b)
        continue
      }
      kept.push(out)
      if (part) parts.push(part)
      if (dead(out)) held.delete(eid)
      else if (alive(row)) held.set(eid, merged(row, out))
    }
    let gone = [...left, ...parts]
    if (!left.some((b) => b.$actor)) return { kept, idle: gone }
    let writer = writers(bundles)
    return {
      kept: kept.map((b) =>
        b.$actor ? b : { ...b, $actor: writer(b.entity.eid) }
      ),
      idle: gone,
    }
  })
}
