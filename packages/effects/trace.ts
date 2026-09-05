// What HAPPENED, told from what was committed. A batch on the wire says only
// what to write: the same bundle patches a component that already existed and
// creates one that did not, and a cascade's casualty rides back as a bare
// tombstone with none of the components it used to carry. An observer needs
// the difference — "a post was published" is not "a post exists" — so this
// file works it out.
//
// It takes two readings. BEFORE the patches go in, `before()` reads which
// components each entity in the batch already carries, plus the same for
// everything the batch is about to kill (@yaks/graph's own `doomed()` walk, so
// the death rule is asked, never re-implemented). AFTER the commit, `events()`
// replays the applied batch against that reading: a component absent before is
// a birth, one present before is a change carrying only the columns that
// moved, and a component or an entity that went is a removal.
//
// The reading rides forward on the batch itself, under `$before`. A `$`-key is
// not a component — `comps()` skips it, so no storage adapter ever sees it —
// which is how one phase of `apply()` tells a later one what it learned
// without a global anywhere. The effect phase strips it back off.

import type { Bundle, Comp, Eid, Entity, Tx } from '@yaks/graph'
import { comps, dead, doomed, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'

/** What happened to one component: it appeared, it moved, or it went. */
export type Kind = 'created' | 'changed' | 'removed'

/**
 * One committed component change, as an effect sees it.
 *
 * `comp` is the patch AS APPLIED, which is what makes a change readable: on a
 * `created` event it is the whole birth row, on a `changed` event only the
 * columns that moved, and on a `removed` event there is nothing left to carry.
 */
export type Event = {
  /** what happened */
  kind: Kind
  /** the entity it happened to, with the `num` storage minted */
  entity: Entity
  /** the component's name */
  name: string
  /** the columns the change carried (absent on `removed`) */
  comp?: Comp
}

/** What each entity carried before the batch: component names, by eid. */
export type Before = Record<Eid, string[]>

/** The key the reading rides forward on. Not a component: `$`-prefixed keys
 * are `apply()`'s pipeline, never columns, so storage never sees it. */
export let BEFORE = '$before'

// The entities this batch says are dying, either spelling.
let killing = (bundles: Bundle[]): Eid[] => [
  ...new Set(bundles.filter(dead).map((b) => b.entity.eid)),
]

/**
 * Read what the batch's entities — and everything that will die with them —
 * carry right now, and ride it forward on the batch. Registered on the
 * `precondition` phase, so it reads inside the transaction and before a single
 * patch has gone in.
 */
export let before = (
  vocab: Vocab,
) =>
(bundles: Bundle[], tx: Tx): Bundle[] | Promise<Bundle[]> => {
  let killed = killing(bundles)
  return then(
    killed.length ? doomed(tx, vocab, killed) : [],
    (gone) =>
      then(
        tx.get([...new Set([...bundles.map((b) => b.entity.eid), ...gone])]),
        (found) => {
          let map: Before = {}
          for (let b of found) map[b.entity.eid] = comps(b).map(([n]) => n)
          return bundles.map((b) => ({ ...b, [BEFORE]: map }))
        },
      ),
  )
}

/**
 * Take the reading back off, so the batch a caller gets back is the batch as
 * applied and nothing else. Done in place, deliberately: `apply()` returns the
 * bundles it committed rather than what the effect phase hands back, so a copy
 * made here would be a copy nobody reads. The bundles it edits are the ones
 * `before()` copied, never the caller's own.
 */
export let strip = (bundles: Bundle[]): Bundle[] => {
  for (let b of bundles) if (BEFORE in b) delete b[BEFORE]
  return bundles
}

/**
 * The committed batch, read as what happened. Replays the bundles in order
 * against the reading `before()` took: a component the entity did not carry is
 * `created` (once — a second patch for it in the same batch is a `changed`), a
 * component it did carry is `changed`, a null component or a dead entity is
 * `removed`, one event per component the casualty carried.
 */
export let events = (bundles: Bundle[]): Event[] => {
  let map = (bundles.find((b) => b[BEFORE])?.[BEFORE] ?? {}) as Before
  // A birth's `num` rides back on its own bundle, so an event about the entity
  // that was just created can carry the number storage gave it.
  let nums = new Map<Eid, number>()
  for (let b of bundles) {
    if (b.entity.num != null) nums.set(b.entity.eid, b.entity.num)
  }
  let named = (e: Entity): Entity =>
    e.num != null || !nums.has(e.eid) ? e : { ...e, num: nums.get(e.eid) }
  // What each entity carries as the replay walks the batch, so the batch's own
  // earlier bundles count: created then patched is one birth, not two.
  let held = new Map<Eid, Set<string>>()
  let has = (eid: Eid): Set<string> => {
    let s = held.get(eid)
    if (!s) held.set(eid, s = new Set(map[eid] ?? []))
    return s
  }
  let out: Event[] = []
  for (let b of bundles) {
    let entity = named(b.entity)
    let carried = has(entity.eid)
    if (dead(b)) {
      for (let name of carried) out.push({ kind: 'removed', entity, name })
      carried.clear()
      continue
    }
    for (let [name, comp] of comps(b)) {
      if (comp == null) {
        if (carried.delete(name)) out.push({ kind: 'removed', entity, name })
        continue
      }
      let born = !carried.has(name)
      carried.add(name)
      out.push({ kind: born ? 'created' : 'changed', entity, name, comp })
    }
  }
  return out
}
