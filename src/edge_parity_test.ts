// Fleet parity for @yaks/edge: the package derives the SAME eid the fleet has
// been storing (T-33502). An edge's id is content-addressed from its sentence,
// so the two derivations are not merely "compatible" — they are the same bytes
// or the package cannot read a single edge already in the graph.
//
// Three things are held here:
//   1. edgeEid agrees, byte for byte, for the sentences the fleet says.
//   2. a STORED edge — written through the app's own link() and apply() — is
//      found at the eid the package derives for it.
//   3. the fleet vocabulary's relation declarations (the `relation` keyword,
//      emitted by fleet_vocab from the manifests' edge list) name the same
//      type↔nature pairs edge.ts holds.

import { assertEquals } from '@std/assert'
import { edgeEid as derived, relations } from '@yaks/edge'
import { edgeEid, link, natureOf, typeOf } from './edge.ts'
import { edges as edgeTypes, uuid } from './types.ts'
import { fleetVocab } from './vocab/fleet_vocab.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { bareDb } = await import('./testdb.ts')

Deno.test('the package derives the fleet id, byte for byte', () => {
  let A = 'e8b9a0d2-1111-4222-8333-444455556666'
  let B = '0f1e2d3c-9999-4888-8777-666655554444'
  // every nature the fleet speaks, both directions, plus an `ord`-less pair
  for (let type of edgeTypes) {
    let nature = natureOf[type]
    assertEquals(derived(A, nature, B), edgeEid(A, nature, B))
    assertEquals(derived(B, nature, A), edgeEid(B, nature, A))
  }
})

let db = bareDb()

Deno.test('a stored edge is found at the eid the package derives', () => {
  let parent = uuid(), child = uuid()
  apply(db, [
    { eid: parent, name: 'doc', comp: { title: 'parent' } },
    { eid: child, name: 'doc', comp: { title: 'child' } },
    ...link(parent, 'referenced', child),
  ])
  // `referenced` is the type a query says; `references` is the comp the edge
  // wears, and the sentence is hashed from the comp — the case the two
  // spellings would diverge on if either side guessed.
  let want = derived(parent, 'references', child)
  let rows = db.prepare(
    `select e.eid as eid from edge g join entity e on e.id = g.entity`,
  ).all() as { eid: string }[]
  assertEquals(rows.map((r) => r.eid), [want])
})

Deno.test('the fleet vocabulary declares the fleet relations', () => {
  // relations() reads the `relation` keyword off the loaded vocabulary; the app
  // reads its own natureOf/typeOf tables. One list, said two ways.
  let said = relations(fleetVocab())
  assertEquals(
    Object.fromEntries(Object.entries(said).map(([name, tag]) => [tag, name])),
    typeOf,
  )
  assertEquals(said.referenced, 'references')
  assertEquals(Object.keys(said).sort(), [...edgeTypes].sort())
})
