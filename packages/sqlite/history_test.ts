import { equal, test, throws } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import {
  as,
  col,
  fn,
  type History,
  NOW,
  select,
  type Stmt,
  table,
} from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { open } from './db.ts'
import { branch, type Mode, moded, storage } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    page: {
      component: true,
      properties: { title: { type: 'string' }, n: { type: 'number' } },
    },
    pinned: { component: true, properties: {} },
    lease: {
      component: true,
      journal: false,
      properties: { holder: { type: 'string' } },
    },
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

// One database with history for the file, its graph, and a connection for
// each kind of mode that reads it, since a mode's views are its connection's
// own.
let CLOCK: Stmt = {
  t: 'create table',
  name: 'clock',
  cols: [{ name: 'id', type: 'integer', pk: true }, {
    name: 'at',
    type: 'text',
  }],
}
let path = `file:${crypto.randomUUID()}?mode=memory&cache=shared`
let d = open(path)
d.query(CLOCK)
let store = storage(d, vocab, { history })
store.install()
let g = graph({ storage: store, vocab })
let past = open(path), branched = open(path)
let seen = (mode: Mode) =>
  graph({
    storage: moded('at' in mode ? past : branched, vocab, { history }, mode),
    vocab,
  })
let tx = () => Number(d.query(history.tip)[0].id)
let step = async (bundles: Bundle[]) => (await g.apply(bundles), tx())

let eids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)

// What each test reads was written as the file loaded, so a test pays for
// its reads alone. Two pages' lives: each write, the transaction it took,
// and what main held just after it.
let life: { write: string; at: number; then: Bundle[] }[] = []
for (
  let [write, bundles] of [
    ['a page made', [{ entity: { eid: 'p1' }, page: { title: 'one', n: 1 } }]],
    ['another page made', [{
      entity: { eid: 'p2' },
      page: { title: 'other' },
    }]],
    ['a property changed', [{ entity: { eid: 'p1' }, page: { title: 'two' } }]],
    ['a component swapped', [{
      entity: { eid: 'p1' },
      page: null,
      pinned: {},
    }]],
    ['a component back', [{ entity: { eid: 'p1' }, page: { title: 'back' } }]],
    ['a page deleted', [{ entity: { eid: 'p2' }, $delete: true }]],
  ] as [string, Bundle[]][]
) {
  life.push({ write, at: await step(bundles), then: await g.get(['p1', 'p2']) })
}

// A component that keeps no history, written twice after a page.
let leased = await step([{ entity: { eid: 'p3' }, page: { title: 'three' } }])
await g.apply([{ entity: { eid: 'l1' }, lease: { holder: 'a' } }])
let after = await step([{ entity: { eid: 'l1' }, lease: { holder: 'b' } }])

// A branch: two pages on main, then the branch changes one, adds one and
// deletes the other, and main moves on.
await g.apply([
  { entity: { eid: 'b1' }, page: { title: 'one', n: 1 } },
  { entity: { eid: 'b2' }, page: { title: 'two' } },
])
let fork = branch(d, history)
let on = seen(fork)
await on.apply([{ entity: { eid: 'b1' }, page: { title: 'branched' } }])
await on.apply([
  { entity: { eid: 'b3' }, page: { title: 'new' }, lease: { holder: 'b' } },
])
await on.apply([{ entity: { eid: 'b2' }, $delete: true }])
await g.apply([{ entity: { eid: 'b1' }, page: { title: 'main moved' } }])

let pages = async (on: ReturnType<typeof graph>) =>
  (await on.get(['b1', 'b2', 'b3'])).map((b) => b.page ?? Object.keys(b))

// Each mode's connection reads before any test does, so none of them pays
// for preparing the statements they share.
for (let eids of [['b1', 'b2'], ['b1']]) {
  await on.get(eids)
  await seen(life[0]).get(eids)
}
await pages(seen(fork))
await pages(g)
await seen(life[0]).read('.page')

for (let { write, at, then } of life) {
  test(`as of ${write}, a store with history holds what it held then`, async () =>
    equal(await seen({ at }).get(eids(then)), then))
}

test('as of a transaction, a query reads what matched then', async () => {
  let swapped = life[3].at
  equal(eids(await seen({ at: swapped }).read('.page')), ['p2'])
})

test('a component that keeps no history takes no transaction and reads as it stands', async () => {
  equal(after, leased)
  equal((await seen({ at: leased }).get(['l1']))[0].lease, { holder: 'b' })
})

test('as of a transaction, the graph refuses a write', async () => {
  await throws(() =>
    seen({ at: leased }).apply([{
      entity: { eid: 'p3' },
      page: { title: 'x' },
    }])
  )
  equal((await g.get(['p3']))[0].page, { title: 'three' })
})

test('a branch reads main as of its fork under its own writes', async () =>
  equal(await pages(seen(fork)), [
    { title: 'branched', n: 1 },
    ['entity', 'tombstone'],
    { title: 'new' },
  ]))

test('main never sees a branch’s writes', async () =>
  equal(await pages(g), [
    { title: 'main moved', n: 1 },
    { title: 'two' },
    ['entity'],
  ]))

// A store that kept no history, then begins to: what it held, changed once.
let later = `file:${crypto.randomUUID()}?mode=memory&cache=shared`
let plain = open(later)
plain.query(CLOCK)
storage(plain, vocab).install()
await graph({ storage: storage(plain, vocab), vocab }).apply([
  { entity: { eid: 'q1' }, page: { title: 'before' } },
])
let begun = storage(plain, vocab, { history })
begun.install()
await graph({ storage: begun, vocab }).apply([
  { entity: { eid: 'q1' }, page: { title: 'after' } },
])
let looking = graph({
  storage: moded(open(later), vocab, { history }, { at: 0 }),
  vocab,
})
await looking.get(['q1'])

test('a store that begins to keep history keeps what it held as its past', async () =>
  equal((await looking.get(['q1']))[0].page, { title: 'before' }))
