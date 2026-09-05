// Parity: the FULL fleet vocabulary, converted mechanically from the fleet
// manifests into the @yaks/vocab JSON Schema format, loaded through the
// runtime, must answer exactly what the fleet's generated src/types.ts (and
// src/query.ts routing) answer today — same comps, same column types, same
// kindOrder, same death worklists, same routing. The converter is fleet glue
// (the package ships zero components); it lives in ./fleet_vocab.ts, shared.
//
// Known, deliberate divergences (the fleet layers rules the meta-model does
// not carry): the log partition (log comps don't claim bare spellings), the
// curated bareShy/sharedRefs bare-routing lists, and derived value COMPUTATION
// (statusOf) — the derived column itself is declared here as persist: false.

import { assert, assertEquals } from '@std/assert'
import type { Column } from '@yaks/vocab'
import { idOf, prefixes } from '@yaks/id'
import {
  comps,
  deaths,
  idOf as idOfFleet,
  kindOrder,
  prefix,
  type PropType,
  shortId,
  stamped,
} from '../types.ts'
import { route } from '../query.ts'
import { fleetVocab } from './fleet_vocab.ts'

// The converter that maps the fleet manifests into @yaks/vocab documents lives
// in fleet_vocab.ts — one truth, shared by this test, the @yaks/sql parity test,
// and the @yaks/sqlite integration spike.
let v = fleetVocab()
let EID = '9f1c8d2a-0b44-4e51-9f77-6a0c1e2d3b45'

// ---- the canonical type spelling both sides collapse to --------------------

let canonType = (t: PropType): string =>
  typeof t == 'string'
    ? t
    : 'enum' in t
    ? `enum:${t.enum.join('|')}`
    : 'eid' in t
    ? `ref:${t.eid}:${t.death}`
    : 'text' // a well is a text column whose pool name dissolved

let canonCol = (c: Column): string =>
  c.category == 'enum'
    ? `enum:${c.values!.join('|')}`
    : c.category == 'ref'
    ? `ref:${c.ref}:${c.death}`
    : c.scalar!

// ---- parity ----------------------------------------------------------------

Deno.test('parity: the writable component list', () => {
  assertEquals(v.comps, Object.keys(comps).sort())
})

Deno.test('parity: kindOrder, exactly', () => {
  assertEquals(v.kinds, kindOrder)
})

Deno.test('parity: every wire-writable column, name and type', () => {
  for (let [name, cols] of Object.entries(comps)) {
    assertEquals(v.comp(name)!.writable, Object.keys(cols), name)
    for (let [p, t] of Object.entries(cols)) {
      assertEquals(canonCol(v.column(name, p)!), canonType(t), `${name}.${p}`)
    }
  }
})

Deno.test('parity: every stamped column, name and type', () => {
  for (let name of v.all) {
    assertEquals(
      v.comp(name)!.stamped,
      Object.keys(stamped[name] ?? {}),
      name,
    )
  }
  for (let [name, cols] of Object.entries(stamped)) {
    for (let [p, t] of Object.entries(cols)) {
      let c = v.column(name, p)!
      assert(c.stamped, `${name}.${p} is stamped`)
      assertEquals(canonCol(c), canonType(t), `${name}.${p}`)
    }
  }
})

Deno.test('parity: death worklists, all four words', () => {
  for (let word of ['cascade', 'detach', 'release', 'keep'] as const) {
    assertEquals(v.deaths(word).sort(), deaths(word).sort(), word)
  }
})

Deno.test('parity: enum aliases ride along', () => {
  assertEquals(v.column('review', 'verdict')!.aliases, {
    approve: 'approved',
    reject: 'rejected',
    changes: 'changes_requested',
  })
})

Deno.test('parity: the id prefixes, read through @yaks/id', () => {
  assertEquals(prefixes(v), prefix)
  // and the same id every fleet door prints
  let id = idOf(v)
  assertEquals(
    id({ eid: EID, kind: 'task', num: 3 }),
    idOfFleet({
      eid: EID,
      kind: 'task',
      num: 3,
    }),
  )
  assertEquals(id({ eid: EID, kind: 'entity', num: 3 }), 'E-3')
  assertEquals(id({ eid: EID, kind: 'task' }), shortId(EID))
})

Deno.test('parity: derived status is readable, never writable', () => {
  let status = v.column('task', 'status')!
  assertEquals(status.persist, false)
  assertEquals(status.values, ['open', 'wip', 'done', 'cancelled'])
  assert(!v.comp('task')!.writable.includes('status'))
})

Deno.test('parity: bare routing agrees with the fleet on the shared spellings', () => {
  // The sample every board actually speaks. The fleet's curated layers
  // (bareShy, the log partition) own the rest; see the header comment.
  for (
    let p of [
      'status',
      'title',
      'body',
      'priority',
      'project',
      'assignee',
      'domain',
      'query',
      'color',
      'target',
      'scope',
      'session',
      'from',
      'person',
      'claim',
    ]
  ) {
    assertEquals(v.route(p), route(p), `.${p}`)
  }
})

Deno.test('parity: dotted paths aim through references', () => {
  assertEquals(v.aim('comment.target.doc.title'), [
    { comp: 'comment', prop: 'target' },
    { comp: 'doc', prop: 'title' },
  ])
  assertEquals(v.aim('task.project.doc.title'), [
    { comp: 'task', prop: 'project' },
    { comp: 'doc', prop: 'title' },
  ])
  assertEquals(v.aim('created.by'), [{ comp: 'created', prop: 'by' }])
})
