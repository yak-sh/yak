/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph, type Row, type Storage } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { preparedStore, snapshot } from '../sqlite/testing.ts'
import { ram } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    name: {
      component: true,
      type: 'object',
      properties: { text: { type: 'string' } },
    },
    note: {
      component: true,
      type: 'object',
      properties: {
        by: { type: 'string', ref: 'entity' },
        text: { type: 'string' },
      },
    },
    pref: {
      component: true,
      type: 'object',
      properties: { value: { type: 'string' } },
    },
    link: {
      component: true,
      type: 'object',
      properties: { to: { type: 'string', ref: 'entity' } },
    },
  },
})
let visibility = {
  entity: '!note | .note.by=alice',
  components: { pref: '.entity.eid=alice' },
}
let fixture = (storage: Storage) => {
  storage.tx((tx) =>
    tx.patch([
      {
        entity: { eid: 'alice' },
        name: { text: 'Alice' },
        pref: { value: 'blue' },
      },
      {
        entity: { eid: 'bob' },
        name: { text: 'Bob' },
        pref: { value: 'secret' },
      },
      { entity: { eid: 'a' }, note: { by: 'alice', text: 'mine' } },
      { entity: { eid: 'b' }, note: { by: 'bob', text: 'hidden' } },
      { entity: { eid: 'public' }, link: { to: 'bob' } },
      { entity: { eid: 'private-link' }, link: { to: 'b' } },
    ])
  )
  return graph({
    storage,
    vocab,
    plugins: [{ name: 'visibility', scope: () => visibility }],
  })
}
let sqlite = preparedStore(vocab, {}, snapshot(vocab))
let graphs = { RAM: fixture(ram(vocab)), SQL: fixture(sqlite) }
let ids = (rows: Row[] | Promise<Row[]>) =>
  (rows as Row[]).map((r) => r.eid).sort()
let reads = [
  ['entity selection', '.note', ['a']],
  ['private component presence', '.pref', ['alice']],
  ['private component absence', '.name !pref', ['bob']],
  ['private value predicate', '.name .pref.value=secret', []],
  ['private value dereference', '.link .link.to.pref.value=secret', []],
  ['hidden target backlinks', '.refs=b', []],
  ['private child association', '.name .notes>=1', ['alice']],
  ['hidden target walk', '.link.to<-private-link', []],
] as const
let aggregates = [
  ['entity count', '.note .count', [{ value: '', n: 1 }]],
  ['private value distinct', '.pref .distinct=pref.value', [{ value: 'blue' }]],
  ['private value tally', '.pref .tally=pref.value', [{ value: 'blue', n: 1 }]],
] as const
for (let [adapter, g] of Object.entries(graphs)) {
  for (let [name, query, expected] of reads) {
    test(`${adapter} visibility scopes ${name}`, () =>
      assertEquals(ids(g.rows(query)), [...expected]))
  }
  for (let [name, query, expected] of aggregates) {
    test(`${adapter} visibility scopes ${name}`, () =>
      assertEquals<unknown>(g.rows(query), expected))
  }
  test(`${adapter} visibility preserves public aspects in direct lookup`, () => {
    let [person] = g.get(['bob']) as Bundle[]
    assertEquals(person.name, { text: 'Bob' })
    assertEquals(person.pref, undefined)
  })
  test(`${adapter} visibility hides direct lookup of private entities`, () =>
    assertEquals(g.get(['b']), []))
  test(`${adapter} native reads preserve relational visibility`, () =>
    assertEquals(ids(g.rows('.note', { native: true })), ['a']))
  test(`${adapter} visibility hides reference values naming private entities`, () => {
    assertEquals(g.rows('.entity.eid=private-link .fields=link.to'), [{
      eid: 'private-link',
      'link.to': null,
    }])
  })
  test(`${adapter} visibility hides projected private aspects`, () => {
    assertEquals(g.rows('.name .fields=pref.value .order=name.text'), [
      { eid: 'alice', 'pref.value': 'blue' },
      { eid: 'bob', 'pref.value': null },
    ])
  })
}

// Warm the shared query and projection machinery outside individual budgets.
for (let g of Object.values(graphs)) {
  for (let [, q] of reads) g.read(q)
  for (let [, q] of aggregates) g.rows(q)
  g.get(['bob', 'b'])
  g.rows('.name .fields=pref.value .order=name.text')
  g.rows('.entity.eid=private-link .fields=link.to')
}
