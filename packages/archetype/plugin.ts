import { after } from '@yaks/fp'
import {
  type Bundle,
  comps,
  dead,
  type Plugin,
  Refused,
  type Tracker,
  type Tx,
} from '@yaks/graph'
import { type Archetype, archetypeDoc, Archetypes, tablesOf } from './sets.ts'

type Held = { set: Archetype; assigned?: string; dead: boolean }

/**
 * Assign archetypes on create/add/remove using the graph's gathered pre-image.
 * Load archetypeDoc into both graph and storage. All state about pending writes
 * is transaction-local; the supplied cache contains only immutable table sets.
 * Stamps, cascades and journal writes use the same tracker as ordinary patches.
 */
export function archetypes(cache: Archetypes = new Archetypes()): Plugin {
  let empty = cache.intern([])
  let meta = cache.intern(['archetype'])
  // A previous write tells us which descriptors the next one may need, not
  // whether they still exist or what they hold. Gather reads every hint anew;
  // a changed shape simply asks for its unexpected descriptors afterwards.
  let plans = new Map<string, { set: Archetype; reads: Set<string> }>()
  let initial = (eid: string, set: Archetype) => {
    let plan = plans.get(eid)
    if (plan?.set.eid == set.eid) return
    if (plans.size >= 2048 && !plans.has(eid)) {
      plans.delete(plans.keys().next().value!)
    }
    plans.set(eid, { set, reads: new Set() })
  }
  let needed = (eid: string, set: Archetype) => {
    let reads = plans.get(eid)?.reads
    if (!reads) return
    if (reads.size >= 16 && !reads.has(set.eid)) {
      reads.delete(reads.values().next().value!)
    }
    reads.add(set.eid)
  }
  return {
    name: '@yaks/archetype',
    admission: () => true,
    vocab: [archetypeDoc],
    derive: { archetype: (comp) => cache.decode(comp.tables).eid },
    wants: (bundles) => {
      let eids = new Set<string>()
      let moved = new Map<string, Archetype>()
      for (let b of bundles) {
        let plan = plans.get(b.entity.eid)
        if (!plan) continue
        eids.add(plan.set.eid)
        let set = moved.get(b.entity.eid) ?? plan.set
        set = dead(b) ? cache.intern(['tombstone']) : comps(b).reduce(
          (set, [table, patch]) => cache.move(set, table, patch != null),
          set,
        )
        moved.set(b.entity.eid, set)
        eids.add(set.eid)
        if (set.eid != plan.set.eid) {
          for (let eid of plan.reads) eids.add(eid)
          eids.add(meta.eid)
        }
      }
      if (!eids.size) return []
      return [{ eids: [...eids], hint: true }]
    },
    hooks: {
      // A returned bundle may be sent back as a patch. The pointer is derived,
      // never something a caller can use to misclassify an entity.
      normalize: (bundles) =>
        bundles.map((b) => {
          let { archetype: _, ...entity } = b.entity
          return {
            ...b,
            entity,
            ...(b.archetype == null ? {} : {
              archetype: {
                tables: JSON.stringify(
                  tablesOf((b.archetype as { tables: unknown }).tables),
                ),
              },
            }),
          }
        }),
    },
    track: (tx, found) =>
      tracking(tx, found, cache, empty, meta, initial, needed),
  }
}

function tracking(
  tx: Tx,
  found: (eid: string) => Bundle | null | undefined,
  cache: Archetypes,
  empty: Archetype,
  meta: Archetype,
  initial: (eid: string, set: Archetype) => void,
  rememberRead: (eid: string, set: Archetype) => void,
): Tracker {
  let held = new Map<string, Held>()
  let dirty = new Set<string>()
  let validated = new Map<string, Archetype>()

  let descriptor = (b: Bundle) => {
    let a = cache.decode((b.archetype as { tables: unknown }).tables)
    if (a.eid != b.entity.eid) {
      throw new Refused('Invalid stored archetype identity')
    }
    validated.set(a.eid, a)
    return a
  }

  let ensure = (eids: string[]) => {
    let missing = [...new Set(eids)].filter((e) => !held.has(e))
    let unknown = missing.filter((e) => found(e) === undefined)
    return after(unknown.length ? tx.get(unknown) : [], (rows) => {
      let read = new Map(rows.map((b) => [b.entity.eid, b]))
      let before = missing.map((e) => found(e) ?? read.get(e))
      let ids = [
        ...new Set(before.flatMap((b) => {
          let id = b?.entity.archetype
          return id && !validated.has(id) ? [id] : []
        })),
      ]
      // The gather's hints are freshly read for this transaction, not cached
      // descriptor values. Validate those exact bundles; only an unexpected
      // shape or a projection that omitted its descriptor needs another read.
      let gathered = ids.flatMap((id) => {
        let b = found(id)
        return b?.archetype != null ? [b] : []
      })
      let have = new Set(gathered.map((b) => b.entity.eid))
      let unread = ids.filter((id) => !have.has(id))
      return after(unread.length ? tx.get(unread) : [], (defs) => {
        for (let b of [...gathered, ...defs]) {
          if (b.archetype != null) descriptor(b)
        }
        for (let i = 0; i < missing.length; i++) {
          let b = before[i]
          let assigned = b?.entity.archetype
          let set = assigned ? validated.get(assigned) : undefined
          if (assigned && !set) {
            throw new Refused(`Missing archetype ${assigned}`)
          }
          set ??= b
            ? cache.intern(
              dead(b)
                ? ['tombstone']
                : comps(b).filter(([, c]) => c != null).map(([n]) => n),
            )
            : empty
          held.set(missing[i], { set, assigned, dead: b ? dead(b) : false })
          initial(missing[i], set)
        }
      })
    })
  }

  let wrapped: Tx = {
    ...tx,
    patch: (bundles) =>
      after(ensure(bundles.map((b) => b.entity.eid)), () => {
        for (let b of bundles) {
          let h = held.get(b.entity.eid)!
          if (h.dead) continue
          for (let [table, comp] of comps(b)) {
            if (table == 'archetype') {
              if (comp == null) {
                throw new Refused(
                  'Archetypes are never removed; mark retired instead',
                )
              }
              let set = cache.decode(comp.tables)
              if (set.eid != b.entity.eid) {
                throw new Refused('archetype.tables does not name its entity')
              }
            }
            h.set = cache.move(h.set, table, comp != null)
          }
          if (h.set.eid != h.assigned) dirty.add(b.entity.eid)
        }
        return after(tx.patch(bundles), (born) => {
          for (let e of born) {
            // References can mint bare entities that no input bundle named.
            if (!held.has(e.eid)) held.set(e.eid, { set: empty, dead: false })
            if (held.get(e.eid)!.assigned == null) dirty.add(e.eid)
          }
          return born
        })
      }),
    remove: (entities) =>
      after(ensure(entities.map((e) => e.eid)), () => {
        for (let e of entities) {
          let h = held.get(e.eid)!
          if (h.set.tables.includes('archetype')) {
            throw new Refused(
              'Archetypes are never deleted; mark retired instead',
            )
          }
          h.set = cache.intern(['tombstone'])
          h.dead = true
          dirty.add(e.eid)
        }
        return tx.remove(entities)
      }),
    // A revived entity starts from the empty set: the patch after it moves it
    // to the tables it is given, as it would a new one.
    revive: (eids) =>
      after(ensure(eids), () => {
        for (let eid of eids) {
          let h = held.get(eid)!
          if (!h.dead) continue
          h.set = empty
          h.dead = false
          dirty.add(eid)
        }
        return tx.revive(eids)
      }),
  }

  return {
    tx: wrapped,
    flush: (bundles) => {
      if (!dirty.size) return bundles
      // Classification is this plugin's own bookkeeping, so on its own it is
      // never reported back to the caller (@yaks/graph `composed`): the pointer
      // still appears on the bundle of an entity the write already returns, and
      // an entity nothing else in the write mentioned — a descriptor, or an
      // entity created only to be referenced — is written and journaled without
      // appearing in the result.
      let assignments: Bundle[] = [...dirty].flatMap((eid) => {
        let h = held.get(eid)!
        return h.assigned == h.set.eid
          ? []
          : [{ entity: { eid, archetype: h.set.eid }, $quiet: true }]
      })
      dirty.clear()
      if (!assignments.length) return bundles
      for (let b of assignments) {
        rememberRead(b.entity.eid, cache.get(b.entity.archetype!)!)
      }
      let needed = new Map(assignments.map((b) => {
        let a = cache.get(b.entity.archetype!)!
        return [a.eid, a]
      }))
      // Archetype entities themselves carry an archetype. That recursion stops
      // at one self-classifying entity, rather than an infinite chain of
      // descriptors.
      needed.set(meta.eid, meta)
      let missing = [...needed.keys()].filter((eid) => !validated.has(eid))
      let gathered = missing.flatMap((eid) => {
        let row = found(eid)
        return row?.archetype != null ? [row] : []
      })
      let have = new Set(gathered.map((row) => row.entity.eid))
      let unread = missing.filter((eid) => !have.has(eid))
      return after(unread.length ? tx.get(unread) : [], (fresh) => {
        let rows = [...gathered, ...fresh]
        let existing = new Set([
          ...validated.keys(),
          ...rows.filter((b) => b.archetype != null).map((b) => b.entity.eid),
        ])
        for (let b of rows) {
          if (existing.has(b.entity.eid)) descriptor(b)
          if (!existing.has(b.entity.eid) && (dead(b) || comps(b).length)) {
            throw new Refused(`Archetype identity is occupied: ${b.entity.eid}`)
          }
        }
        let made: Bundle[] = [...needed.values()].filter((a) =>
          !existing.has(a.eid)
        ).map((a) => ({
          entity: { eid: a.eid, archetype: meta.eid },
          archetype: { tables: JSON.stringify(a.tables) },
          $quiet: true,
        }))
        // A reference may have minted a bare spine with this content address.
        // It is a descriptor now, not an empty-set owner from the earlier write.
        let defining = new Set(made.map((b) => b.entity.eid))
        assignments = assignments.filter((b) => !defining.has(b.entity.eid))
        // The underlying transaction bypasses this tracker for its own
        // metadata. It is still inside the same rollback/journal boundary.
        return after(tx.patch([...made, ...assignments]), (born) => {
          let numbered = new Map(born.map((e) => [e.eid, e]))
          for (let b of made) {
            held.set(b.entity.eid, {
              set: meta,
              assigned: meta.eid,
              dead: false,
            })
            b.entity = { ...numbered.get(b.entity.eid), ...b.entity }
          }
          for (let b of assignments) {
            held.get(b.entity.eid)!.assigned = b.entity.archetype
          }
          return [...bundles, ...made, ...assignments]
        })
      })
    },
  }
}
