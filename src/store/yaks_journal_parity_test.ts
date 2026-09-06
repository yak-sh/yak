// Fleet parity (T-33498, goal V-33493): does @yaks/journal answer the history
// the APP's journal answers? The write spike (./yaks_graph_spike_test.ts) held
// the two apply()s against each other; this is the same evidence for the
// RECORD they leave behind.
//
// One corpus of batches, replayed through both:
//   - the app's own apply() (src/db.ts), read back with journalOf(), and
//   - @yaks/graph's apply() over @yaks/ram with @yaks/journal registered,
//     read back with history(), both over the fleet vocabulary.
// Each side is projected to the same sentence — the components and columns
// each batch moved, in order — and the two projections must agree.
//
// What is NOT compared is the layout, and that is deliberate: the app keeps
// its log in three relational tables (journal_tx/journal_change/journal_field,
// integer rowids, spine ids) holding AFTER-IMAGES only, deriving a prior value
// at read time (D-18861); the package keeps components (batch/delta, eids,
// before AND after on every row). A reader cannot be pointed at the other's
// rows without a shim. That divergence is pinned as its own task; what must
// agree — and what this test holds — is the ANSWER.
//
// Three further allowances, each named where it is made: the app logs the
// entity SPINE as a change where the package hands the minted number back on
// the bundle's identity; the app echoes a newly created row WHOLE, padding
// with what the unsent columns hold, so an empty column is not a movement on
// either side; and a death is one '†' for the app while the package also
// records what the entity lost, so a tombstoned target's component rows are
// folded into the '†'.

import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import type { Batch } from '@yaks/journal'
import { history, journal, journalDoc } from '@yaks/journal'
import { loadVocab } from '@yaks/vocab'
import { fleetDocs, fleetKeywords } from '../vocab/fleet_vocab.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, journalOf } = await import('../db.ts')
let { bareDb } = await import('../testdb.ts')
let { uuid } = await import('../types.ts')
type Change = {
  eid: string
  name: string
  comp: Record<string, unknown> | null
}

let V = loadVocab([...fleetDocs(), journalDoc], fleetKeywords)
let appDb = bareDb()
let core = graph({ storage: ram(V), vocab: V, plugins: [journal(V)] })

let VIA = uuid()

// The app's flat change spelling as a bundle, with the writing instrument
// riding along the way the core takes it.
let asBundle = (c: Change) =>
  c.name == 'entity' && c.comp == null
    ? { entity: { eid: c.eid }, $delete: true, $actor: { via: VIA } }
    : { entity: { eid: c.eid }, [c.name]: c.comp, $actor: { via: VIA } }

// One batch through both writers.
let both = (changes: Change[]) => {
  core.apply(changes.map(asBundle))
  apply(appDb, changes as never, undefined, VIA)
}

// The app's record of one batch, as sentences: a written column is
// `comp.column`, a dropped component is `-comp`, a death is `†`.
//
// Two things in an app row are not movements. The `entity` component is the
// SPINE — the number storage minted, which the package hands back on the
// bundle's identity rather than as a change. And a create is echoed WHOLE,
// padded with what the columns the caller never sent hold: nothing (`null`, or
// the empty string a doc body round-trips through its blob as).
let appSaid = (eid: string): string[][] =>
  journalOf(appDb, eid).reverse().map((e) =>
    e.changes.flatMap((c) =>
      c.name == 'entity' && c.comp == null
        ? ['†']
        : c.name == 'entity'
        ? []
        : c.comp == null
        ? [`-${c.name}`]
        : Object.entries(c.comp)
          .filter(([k, v]) => k != 'eid' && v != null && v !== '')
          .map(([k]) => `${c.name}.${k}`)
    )
  )

// The package's record of the same batches, said the same way. A component
// APPEARING has no counterpart in the app's log (its columns say it), and a
// component the entity LOST to its own death is folded into the death.
let pkgSaid = (batches: Batch[]): string[][] =>
  batches.map((b) => {
    let dying = new Set(
      b.deltas.filter((d) => d.comp == 'tombstone').map((d) => d.target),
    )
    return b.deltas.flatMap((d) =>
      d.comp == 'tombstone'
        ? ['†']
        : d.column != null
        ? [`${d.comp}.${d.column}`]
        : d.after != null || dying.has(d.target)
        ? []
        : [`-${d.comp}`]
    )
  })

let T = uuid()

Deno.test('parity: the two journals tell the same story about one entity', () => {
  both([
    { eid: T, name: 'doc', comp: { title: 'One' } },
    { eid: T, name: 'task', comp: { priority: 1, domain: 'Eng' } },
  ])
  both([{ eid: T, name: 'doc', comp: { title: 'Two' } }])
  both([{ eid: T, name: 'task', comp: { priority: 2 } }])
  both([{ eid: T, name: 'task', comp: null }])
  both([{ eid: T, name: 'entity', comp: null }])

  let mine = pkgSaid(history(core)(T) as Batch[])
  assertEquals(mine, appSaid(T))
  assertEquals(mine, [
    ['doc.title', 'task.priority', 'task.domain'],
    ['doc.title'],
    ['task.priority'],
    ['-task'],
    ['†'],
  ])
})

Deno.test('parity: both journals attribute a batch, by their own rule', () => {
  let X = uuid()
  both([{ eid: X, name: 'doc', comp: { title: 'Solo' } }])
  // The app RESOLVES a writer through the box (an unresolvable one is nobody);
  // the package stamps the `$actor` that rode in the batch. Both record the
  // slot on the batch, which is the parity — the resolution is fleet policy,
  // and the spike test pins the same difference for the stamps.
  let theirs = journalOf(appDb, X)[0]
  assertEquals(theirs.via, null)
  assertEquals(theirs.actor, null)
  assertEquals((history(core)(X) as Batch[])[0].via, VIA)
})
