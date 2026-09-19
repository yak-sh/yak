// Fleet parity (T-33820, goal V-33493): the fleet's log and @yaks/journal's
// other layout answer the same question the same way. It used to be a
// comparison across a DIVERGENCE — the app kept three relational tables and
// the package kept batch/delta entities, and neither could read the other, so
// only a projection of both could be held equal. That divergence is gone: the
// fleet's log IS the package's normalized layout now (packages/journal/
// normalized.ts), so this is an equality test over one reader's two shapes.
//
// One corpus of batches, replayed through both:
//   - the fleet's own apply() (src/db.ts), read back with journalHistory(),
//     the package's `Batch` over the relational rows, and
//   - @yaks/graph's apply() over @yaks/ram with @yaks/journal's component
//     writer registered, read back with history(), both over the fleet
//     vocabulary.
// Both sides now carry the before-value of every movement, so the comparison
// is the whole sentence and not a projection of it.
//
// Three allowances remain, each fleet POLICY rather than a difference of
// layout, and each named where it is made: the fleet logs the entity SPINE as
// a change where the package hands the minted number back on the bundle's
// identity; the fleet echoes a newly created row WHOLE, padding with what the
// unsent columns hold, so an empty column is not a movement on either side;
// and a death is one '†' for the fleet while the package also records what the
// entity lost, so a tombstoned target's component rows are folded into the '†'.

import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import type { Batch } from '@yaks/journal'
import { history, journal, journalDoc } from '@yaks/journal'
import { loadVocab } from '@yaks/vocab'
import type { Change } from '../types.ts'
import { asBundle } from './wire.ts'
import { fleetDocs, fleetKeywords } from '../vocab/fleet_vocab.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, journalHistory } = await import('../db.ts')
let { bareDb } = await import('../testdb.ts')
let { uuid } = await import('../types.ts')
let V = loadVocab([...fleetDocs(), journalDoc], fleetKeywords)
let appDb = bareDb()
let core = graph({ storage: ram(V), vocab: V, plugins: [journal(V)] })

let VIA = uuid()

// One batch through both writers.
let both = (changes: Change[]) => {
  core.apply(changes.map((c) => ({ ...asBundle(c), $actor: { via: VIA } })))
  apply(appDb, changes as never, undefined, VIA)
}

// A batch as sentences: a column that moved is `comp.column before→after`, a
// component dropped is `-comp`, a death is `†`.
//
// The two allowances that are about VALUES, not shape: the `entity` component
// is the SPINE — the number storage minted, which the package hands back on
// the bundle's identity rather than as a movement — and a create is echoed
// WHOLE by the fleet, padded with what the columns the caller never sent hold:
// nothing, or the empty string a doc body round-trips through its blob as. A
// movement from nothing to nothing is not a movement on either side.
let empty = (v: unknown) =>
  v == null || v === '' ||
  (typeof v == 'object' && !Object.keys(v as object).length)

let said = (batches: Batch[]): string[][] =>
  batches.map((b) => {
    let dying = new Set(
      b.deltas.filter((d) => d.comp == 'tombstone').map((d) => d.target),
    )
    return b.deltas.flatMap((d) =>
      d.comp == 'tombstone'
        ? ['†']
        : d.comp == 'entity'
        ? []
        : dying.has(d.target)
        ? []
        : d.column == null
        ? (d.after != null ? [] : [`-${d.comp}`])
        : empty(d.before) && empty(d.after)
        ? []
        : [
          `${d.comp}.${d.column} ${JSON.stringify(d.before ?? null)}→${
            JSON.stringify(d.after ?? null)
          }`,
        ]
    )
  })

let T = uuid()

Deno.test('parity: the two layouts tell the same story about one entity', () => {
  both([
    { eid: T, name: 'doc', comp: { title: 'One' } },
    { eid: T, name: 'task', comp: {} },
    { eid: T, name: 'filed', comp: { priority: 1, domain: 'Eng' } },
  ])
  both([{ eid: T, name: 'doc', comp: { title: 'Two' } }])
  both([{ eid: T, name: 'task', comp: {} }, {
    eid: T,
    name: 'filed',
    comp: { priority: 2 },
  }])
  both([{ eid: T, name: 'task', comp: null }])
  both([{ eid: T, name: 'entity', comp: null }])

  let mine = said(history(core)(T) as Batch[])
  assertEquals(said(journalHistory(appDb, T)), mine)
  assertEquals(mine, [
    [
      'doc.title null→"One"',
      'filed.priority null→1',
      'filed.domain null→"Eng"',
    ],
    ['doc.title "One"→"Two"'],
    ['filed.priority 1→2'],
    ['-task'],
    ['†'],
  ])
})

Deno.test('parity: both layouts attribute a batch, by their own rule', () => {
  let X = uuid()
  both([{ eid: X, name: 'doc', comp: { title: 'Solo' } }])
  // The fleet RESOLVES a writer through the box (an unresolvable one is
  // nobody); the package stamps the `$actor` that rode in the batch. Both
  // record the slot on the batch, which is the parity — the resolution is
  // fleet policy, and the spike test pins the same difference for the stamps.
  let [theirs] = journalHistory(appDb, X)
  assertEquals(theirs.via, null)
  assertEquals(theirs.by, null)
  assertEquals((history(core)(X) as Batch[])[0].via, VIA)
})
