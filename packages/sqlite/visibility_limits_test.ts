/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { type Driver, render } from '@yaks/sql'
import { get, storage } from './mod.ts'
import { snapshot, textual } from './testing.ts'

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
let db = textual({ variableNumber: 100 }, snapshot(vocab))
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
    { entity: { eid: 'link' }, pointers: { p0: 'public', p1: 'hidden' } },
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
test('wide backlinks stay scoped under the host parameter limit', () => {
  assertEquals(g.rows('.refs=public'), [{ eid: 'link' }])
})
test('wide backlinks cannot name a hidden target', () => {
  assertEquals(g.rows('.refs=hidden'), [])
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
