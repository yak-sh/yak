/// <reference lib="deno.ns" />
// A branch of a store in a Durable Object: workerd refuses every temporary
// object, and an object has one connection, so a branch is read and written
// over the storage its main store writes through (@yaks/sqlite `moded`).

import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { as, col, fn, type History, NOW, select, table } from '@yaks/sql'
import { moded } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'
import { durable } from './testing.ts'
import { driver } from './sql.ts'
import { storage } from './store.ts'

let vocab = loadVocab([{
  $defs: {
    page: { component: true, properties: { title: { type: 'string' } } },
  },
}])

// The transactions: a table of its own here, the history plugin's elsewhere.
let history: History = {
  clock: {
    t: 'insert',
    into: 'clock',
    cols: ['at'],
    rows: [[NOW]],
    returning: [col('id')],
  },
  tip: select({ cols: [as(fn('max', col('id')), 'id')], from: table('clock') }),
}

let db = durable()
driver(db).query({
  t: 'create table',
  name: 'clock',
  cols: [{ name: 'id', type: 'integer', pk: true }, {
    name: 'at',
    type: 'text',
  }],
})
let store = storage(db, vocab, { history })
store.install()
let main = graph({ storage: store, vocab })
await main.apply([{ entity: { eid: 'p1' }, page: { title: 'live' } }])
let b = await store.branches!.make()
let on = graph({
  storage: moded(driver(db), vocab, { history }, {
    branch: b.id,
    fork: b.fork,
  }),
  vocab,
})
await on.apply([
  { entity: { eid: 'p1' }, page: { title: 'drafted' } },
  { entity: { eid: 'p2' }, page: { title: 'new' } },
])
await main.apply([{ entity: { eid: 'p1' }, page: { title: 'live again' } }])

let titles = async (g: typeof main) =>
  (await g.read('.page')).map((x) => (x.page as { title: string }).title)
    .sort()

test('a branch in an object reads main as of its fork under its own writes', async () =>
  equal(await titles(on), ['drafted', 'new']))

test('main in the same object never sees the branch', async () =>
  equal(await titles(main), ['live again']))

test('a branch’s changes are read in the object it was written in', async () =>
  equal(
    (await store.branches!.changes(b.id)).map((c) => [c.eid, c.comp]).sort(),
    [['p1', 'page'], ['p2', 'page']],
  ))
