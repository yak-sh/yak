import { equal, ok, test, throws } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import {
  as,
  col,
  eq,
  fn,
  type History,
  join,
  NOW,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { eidOf } from '@yaks/archetype/sets'
import { open } from './db.ts'
import { render } from '@yaks/sql'
import { meta, SCHEMA } from './meta.ts'
import { branch, branchOf, type Mode, moded, storage } from './mod.ts'

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
// each kind of mode that reads it.
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
// The graph's branches as a host gives them: the store's, each read and
// written through a connection of its own.
let g = graph({
  storage: store,
  vocab,
  branches: {
    make: async () => await store.branches!.make(),
    list: async (trash) => await store.branches!.list(trash),
    restore: async (id) => await store.branches!.restore(id),
    drop: async (id) => await store.branches!.drop(id),
    changes: async (id) => await store.branches!.changes(id),
    on: (id) => {
      let mode = branchOf(d, id)
      if (!mode) return Promise.reject(new Error(`no branch ${id}`))
      return Promise.resolve(
        graph({ storage: moded(open(path), vocab, { history }, mode), vocab }),
      )
    },
  },
})
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

// Each mode's driver reads before any test does, so none of them pays
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

// The same beginning paced: the install owes the live rows as their first
// versions, each maintain() takes a page of them, and a row a write changed
// before its page keeps only the version that write made.
let slow = open(`file:${crypto.randomUUID()}?mode=memory&cache=shared`)
slow.query(CLOCK)
storage(slow, vocab).install()
await graph({ storage: storage(slow, vocab), vocab }).apply(
  Array.from({ length: 600 }, (_, i) => ({
    entity: { eid: `s${i}` },
    page: { title: `held ${i}` },
  })),
)
let pacing = storage(slow, vocab, { history, paced: true })
pacing.install()
let seededAt = graph({ storage: pacing, vocab })
let early = await Promise.resolve().then(() => pacing.branches!.make())
  .then(() => null, (e) => e.name)
await seededAt.apply([{ entity: { eid: 's599' }, page: { title: 'moved' } }])
let units = 0
while (pacing.maintain(() => true)) units++
let atStart = graph({
  storage: moded(slow, vocab, { history }, { at: 0 }),
  vocab,
})
let firsts = await atStart.get(['s0', 's599'])

test('a paced beginning takes its rows a page at a time, and makes no branch till it has', async () => {
  equal(early, 'Unseeded')
  equal(units, 2)
  equal(firsts.map((b) => b.page), [{ title: 'held 0' }, undefined])
  equal(
    (await pacing.branches!.make()).fork,
    Number(slow.query(history.tip)[0].id),
  )
})

// As a file from before historical archetypes: keep all its component
// versions, remove only the new index, and let installation rebuild it.
let shapeRows = () =>
  d.query(
    select({
      from: table('$archetype$versions'),
      order: [col('entity'), col('component'), col('$branch'), col('$to')],
    }),
  )
let originalShapes = shapeRows()
d.query({ t: 'drop', kind: 'table', name: '$archetype$versions' })
meta(d).del(SCHEMA)
store.install()
let repairedShapes = shapeRows()
store.install()
let repeatedShapes = shapeRows()
test('historical archetypes rebuild from older versions and installation is idempotent', () => {
  equal(repairedShapes, originalShapes)
  equal(repeatedShapes, repairedShapes)
})

test('a past whole read asks no unrelated component view for presence', async () => {
  let statements: string[] = []
  let query = past.query
  past.query = (s) => {
    statements.push(render(s).sql)
    return query(s)
  }
  try {
    let row = (await seen({ at: life[0].at }).get(['p1']))[0]
    equal(row.page, { title: 'one', n: 1 })
    ok(
      !statements.some((s) => /(?:from|join) "(?:pinned|lease)"/.test(s)),
      statements.join('\n'),
    )
  } finally {
    past.query = query
  }
})

// Through the graph's own doors: a branch made, written, deleted on and read
// by options, and then dropped.
await g.apply([
  { entity: { eid: 'd1' }, page: { title: 'kept' } },
  { entity: { eid: 'd2' }, page: { title: 'doomed' } },
])
let made = await g.branches!.make()
let on3 = { branch: made.id }
await g.apply([{ entity: { eid: 'd1' }, page: { title: 'drafted' } }], on3)
await g.apply([{ entity: { eid: 'd3' }, page: { title: 'born' } }], on3)
await g.apply([{ entity: { eid: 'd2' }, $delete: true }], on3)
let doors = {
  get: (await g.get(['d1', 'd2', 'd3'], undefined, on3))
    .map((b) => b.page ?? Object.keys(b)),
  read: eids(await g.read('.page.title=born', on3)),
  main: (await g.get(['d1', 'd2'])).map((b) => b.page),
  listed: (await g.branches!.list()).map((b) => b.id),
  // On main, the entity the branch made holds nothing, and its pointer says so.
  pointed: d.query(select({
    cols: [col('eid', 'p')],
    from: table('entity', 'e'),
    joins: [
      join(table('entity', 'p'), eq(col('id', 'p'), col('archetype', 'e'))),
    ],
    where: eq(col('eid', 'e'), val('d3')),
  }))[0]?.eid == eidOf([]),
}
await g.branches!.drop(made.id)

test('a branch is made, written, deleted on and read through the graph’s options', () =>
  equal(doors, {
    get: [{ title: 'drafted' }, ['entity', 'tombstone'], { title: 'born' }],
    read: ['d3'],
    main: [{ title: 'kept' }, { title: 'doomed' }],
    listed: [fork.branch, made.id],
    pointed: true,
  }))

let trashed = (await g.branches!.list(true)).find((b) => b.id == made.id)
let hidden = await Promise.resolve().then(() => g.get(['d1'], undefined, on3))
  .then(() => false, () => true)
store.install()
await g.branches!.restore(made.id)
let restored = {
  row: (await g.branches!.list()).find((b) => b.id == made.id),
  held: (await g.get(['d1', 'd2', 'd3'], undefined, on3))
    .map((b) => b.page ?? Object.keys(b)),
}
await g.branches!.drop(made.id)

test('a trashed branch is hidden until restored with every write intact', () => {
  ok(trashed?.trashed)
  equal(hidden, true)
  equal(restored.row, made)
  equal(restored.held, doors.get)
  ok(
    d.query(select({
      from: table('page$versions'),
      where: eq(col('$branch'), val(made.id)),
    })).length > 0,
  )
})

test('a dropped branch’s id is never given again', async () => {
  let next = await g.branches!.make()
  await g.branches!.drop(next.id)
  ok((await g.branches!.make()).id > next.id)
})

// What a branch changed, as its store reads it: each entity's component it
// wrote, at the fork, on the branch and on main now.
await g.apply([
  { entity: { eid: 'c1' }, page: { title: 'a', n: 1 } },
  { entity: { eid: 'c2' }, page: { title: 'gone' } },
])
let since = await g.branches!.make()
let onIt = { branch: since.id }
await g.apply([{ entity: { eid: 'c1' }, page: { title: 'b' } }], onIt)
await g.apply([{ entity: { eid: 'c1' }, lease: { holder: 'x' } }], onIt)
await g.apply([{ entity: { eid: 'c2' }, $delete: true }], onIt)
await g.apply([{ entity: { eid: 'c3' }, pinned: {} }], onIt)
await g.apply([{ entity: { eid: 'c1' }, page: { n: 2 } }])
let changed = (await g.branches!.changes(since.id))
  .map((c) => [c.eid, c.comp, c.fork, c.branch, c.main])
  .sort((a, b) => String(a).localeCompare(String(b)))
await g.branches!.drop(since.id)

test('a branch’s changes are each component it wrote, at the fork, on it and on main now', () =>
  equal(changed, [
    ['c1', 'page', { title: 'a', n: 1 }, { title: 'b', n: 1 }, {
      title: 'a',
      n: 2,
    }],
    ['c2', 'page', { title: 'gone' }, null, { title: 'gone' }],
    ['c2', 'tombstone', null, {}, null],
    ['c3', 'pinned', null, {}, null],
  ]))
