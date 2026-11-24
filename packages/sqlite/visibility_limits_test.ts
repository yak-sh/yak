/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { fields, schema, search } from '@yaks/fts'
import { loadVocab } from '@yaks/vocab'
import { and, eq, joined, line, list } from '@yaks/query'
import { type Driver, render } from '@yaks/sql'
import { get, storage } from './mod.ts'
import { mem, snapshot, textual } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    pointers: {
      component: true,
      properties: Object.fromEntries(Array.from({ length: 110 }, (_, n) => [
        `p${n}`,
        { type: 'string', ref: 'entity' },
      ])),
    },
  },
})
let db = textual({ variableNumber: 100, sqlLength: 100_000 }, snapshot(vocab))
let driver: Driver = {
  query: (stmt) => {
    let q = render(stmt)
    return db.run(q.sql, q.params)
  },
}
let store = storage(driver, vocab, { schemaReady: () => true })
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'public' } },
    { entity: { eid: 'hidden' } },
    { entity: { eid: 'history-1' } },
    { entity: { eid: 'public,literal' } },
    { entity: { eid: 'literal-link' }, pointers: { p0: 'public,literal' } },
    { entity: { eid: 'link' }, pointers: { p0: 'public', p1: 'hidden' } },
    { entity: { eid: 'shade' }, pointers: { p2: 'hidden' } },
  ])
)
let g = graph({
  vocab,
  storage: store,
  plugins: [{
    name: 'owner',
    scope: () => ({ entity: '.entity.eid!=hidden' }),
  }],
})
// The wide statement's prepare belongs to opening this fixture's connection.
g.rows('.refs=public')
g.rows('.refs=hidden')
let literal = () => g.rows(and(eq('pointers.p0', 'public,literal')))
let literalList = () =>
  g.rows(and(eq('pointers.p0', list('public,literal', 'public', 'hidden'))))
literal()
literalList()
test('scoped reference equality preserves literal commas', () =>
  assertEquals(literal(), [{ eid: 'literal-link' }]))
test('scoped reference lists preserve literal members and hide denied targets', () =>
  assertEquals(literalList(), [{ eid: 'literal-link' }, { eid: 'link' }]))
test('wide backlinks stay scoped under the host parameter limit', () => {
  assertEquals(g.rows('.refs=public'), [{ eid: 'link' }])
})
test('wide backlinks cannot name a hidden target', () => {
  assertEquals(g.rows('.refs=hidden'), [])
})
test('backlinks of several targets admit only those pointing at a visible one', () => {
  assertEquals(g.rows('.refs=public|.refs=hidden'), [{ eid: 'link' }])
})
let targets = [
  'public',
  'hidden',
  ...Array.from(
    { length: 1500 },
    (_, i) => `not-in-the-store-${String(i).padStart(24, '0')}`,
  ),
]
let many = joined(targets.map((eid) => line`.refs=${eid}`), '|')
test('a wide set of backlink targets fits in the store’s statement and bind limits', () => {
  assertEquals(g.rows(many), [{ eid: 'link' }])
})
test('scoped getters read physical eids that resemble human ids', () =>
  assertEquals(
    (g.get(['history-1']) as { entity: { eid: string } }[])[0].entity.eid,
    'history-1',
  ))

test('empty scoped identity lookups need no database', () =>
  assertEquals(
    get(
      {
        query: () => {
          throw new Error('an empty lookup needs no database')
        },
      },
      vocab,
      [],
      { visibility: { entity: '.entity.eid=owner' } },
    ),
    [],
  ))

let wide = loadVocab({
  $defs: {
    doc: {
      component: true,
      properties: { title: { type: 'string', search: true } },
    },
    ...Object.fromEntries(Array.from({ length: 360 }, (_, i) => [
      `pointer${i}`,
      {
        component: true,
        properties: { to: { type: 'string', ref: 'entity' } },
      },
    ])),
  },
})
let indexed = fields(wide)
let native = mem()
let rankedStore = storage(native, wide, { extend: [search(indexed, native)] })
rankedStore.install()
rankedStore.raise()
for (let stmt of schema(indexed)) native.query(stmt)
let ranked = graph({
  vocab: wide,
  storage: rankedStore,
  plugins: [{
    name: 'owner',
    scope: () => ({ entity: '.entity.eid!=hidden' }),
  }],
})
ranked.apply([
  { entity: { eid: 'visible' }, doc: { title: 'Target' } },
  { entity: { eid: 'hidden' }, doc: { title: 'Private target' } },
  {
    entity: { eid: 'link' },
    pointer359: { to: 'visible' },
    doc: { title: 'Needle' },
  },
  {
    entity: { eid: 'private-link' },
    pointer0: { to: 'hidden' },
    doc: { title: 'Needle' },
  },
  { entity: { eid: 'unrelated' }, doc: { title: 'Needle' } },
])

test('ranked full-text search over wide backlinks respects target visibility', () => {
  assertEquals(
    ranked.rows('(.refs=visible|.refs=hidden) needle .order=search .limit=5'),
    [{ eid: 'link' }],
  )
})
