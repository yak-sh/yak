import {
  type Bundle,
  comps,
  dead,
  type Plugin,
  Refused,
  then,
  type Tracker,
  type Tx,
} from '@yaks/graph'
import {
  type Archetype,
  archetypeDoc,
  Archetypes,
  eidOf,
  tablesOf,
} from './sets.ts'

type Held = { set: Archetype; assigned?: string; dead: boolean }

/**
 * Assign archetypes on create/add/remove using the graph's gathered pre-image.
 * Load archetypeDoc into both graph and storage. All state about pending writes
 * is transaction-local; the supplied cache contains only immutable table sets.
 * Stamps, cascades and journal writes use the same tracker as ordinary patches.
 */
export function archetypes(cache: Archetypes = new Archetypes()): Plugin {
  return {
    name: '@yaks/archetype',
    vocab: [archetypeDoc],
    derive: { archetype: (comp) => eidOf(tablesOf(comp.tables)) },
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
    track: (tx, found) => tracking(tx, found, cache),
  }
}

function tracking(
  tx: Tx,
  found: (eid: string) => Bundle | null | undefined,
  cache: Archetypes,
): Tracker {
  let held = new Map<string, Held>()
  let dirty = new Set<string>()
  let empty = cache.intern([])

  let ensure = (eids: string[]) => {
    let missing = [...new Set(eids)].filter((e) => !held.has(e))
    let unknown = missing.filter((e) => found(e) === undefined)
    return then(unknown.length ? tx.get(unknown) : [], (rows) => {
      let read = new Map(rows.map((b) => [b.entity.eid, b]))
      let before = missing.map((e) => found(e) ?? read.get(e))
      let ids = [
        ...new Set(before.flatMap((b) => {
          let id = b?.entity.archetype
          return id && !cache.get(id) ? [id] : []
        })),
      ]
      return then(ids.length ? tx.get(ids) : [], (defs) => {
        for (let b of defs) {
          let a = cache.intern(
            tablesOf((b.archetype as { tables: unknown }).tables),
          )
          if (a.eid != b.entity.eid) {
            throw new Refused('Invalid stored archetype identity')
          }
        }
        for (let i = 0; i < missing.length; i++) {
          let b = before[i]
          let assigned = b?.entity.archetype
          let set = assigned ? cache.get(assigned) : undefined
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
        }
      })
    })
  }

  let wrapped: Tx = {
    ...tx,
    patch: (bundles) =>
      then(ensure(bundles.map((b) => b.entity.eid)), () => {
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
              let set = cache.intern(tablesOf(comp.tables))
              if (set.eid != b.entity.eid) {
                throw new Refused('archetype.tables does not name its entity')
              }
            }
            h.set = cache.move(h.set, table, comp != null)
          }
          if (h.set.eid != h.assigned) dirty.add(b.entity.eid)
        }
        return then(tx.patch(bundles), (born) => {
          for (let e of born) {
            // References can mint bare entities that no input bundle named.
            if (!held.has(e.eid)) held.set(e.eid, { set: empty, dead: false })
            if (held.get(e.eid)!.assigned == null) dirty.add(e.eid)
          }
          return born
        })
      }),
    remove: (entities) =>
      then(ensure(entities.map((e) => e.eid)), () => {
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
  }

  return {
    tx: wrapped,
    flush: (bundles) => {
      if (!dirty.size) return bundles
      let assignments: Bundle[] = [...dirty].flatMap((eid) => {
        let h = held.get(eid)!
        return h.assigned == h.set.eid
          ? []
          : [{ entity: { eid, archetype: h.set.eid } }]
      })
      dirty.clear()
      if (!assignments.length) return bundles
      let needed = new Map(assignments.map((b) => {
        let a = cache.get(b.entity.archetype!)!
        return [a.eid, a]
      }))
      // Archetype entities themselves wear archetype. This fixed point ends
      // at one self-classifying entity, not an infinite chain of descriptors.
      let meta = cache.intern(['archetype'])
      needed.set(meta.eid, meta)
      return then(tx.get([...needed.keys()]), (rows) => {
        let existing = new Set(
          rows.filter((b) => b.archetype != null).map((b) => b.entity.eid),
        )
        for (let b of rows) {
          if (!existing.has(b.entity.eid) && (dead(b) || comps(b).length)) {
            throw new Refused(`Archetype identity is occupied: ${b.entity.eid}`)
          }
        }
        let made: Bundle[] = [...needed.values()].filter((a) =>
          !existing.has(a.eid)
        ).map((a) => ({
          entity: { eid: a.eid, archetype: meta.eid },
          archetype: { tables: JSON.stringify(a.tables) },
        }))
        // A reference may have minted a bare spine with this content address.
        // It is a descriptor now, not an empty-set owner from the earlier write.
        let defining = new Set(made.map((b) => b.entity.eid))
        assignments = assignments.filter((b) => !defining.has(b.entity.eid))
        // The underlying transaction bypasses this tracker for its own
        // metadata. It is still inside the SAME rollback/journal boundary.
        return then(tx.patch([...made, ...assignments]), (born) => {
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
