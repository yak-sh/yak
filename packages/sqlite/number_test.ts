import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Bundle, Refused, type Tx } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { col, eq, lit, val } from '@yaks/sql'
import { mem } from './testing.ts'
import { mintSql, storage } from './mod.ts'
import { idDoc, idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'

let vocab = loadVocab([idDoc, {
  $defs: {
    entity: { component: true, properties: {} },
    entry: { component: true, properties: { seq: { type: 'number' } } },
    task: {
      component: true,
      kind: true,
      properties: { target: { type: 'string', ref: 'entity' } },
    },
    // A memory saved from a task is a memory: its kind comes first.
    memory: { component: true, kind: true, before: ['task'] },
  },
}], [idKeywords])
let SERIES = { task: 'T', memory: 'M' }

type Opts = { number: boolean | Record<string, string> }
let open = (backend: string, opts: Opts, d = mem()) => {
  let s = backend == 'sqlite' ? storage(d, vocab, opts) : ram(vocab, opts)
  s.install()
  return s
}
// Each entity's id as the store holds it: `T-1`, a bare number for one
// numbered without a letter, null for none.
let idOf = (tx: Tx, eids: string[]) =>
  (tx.get(eids) as Bundle[]).map(({ entity: e }) =>
    e.num == null ? null : e.prefix ? `${e.prefix}-${e.num}` : e.num
  )
let mk = (eid: string, comps: Record<string, object> = { task: {} }) => ({
  entity: { eid },
  ...comps,
})

for (let backend of ['sqlite', 'ram']) {
  test(`${backend}: each series counts on its own`, () =>
    open(backend, { number: SERIES }).tx((tx) => {
      tx.patch([
        mk('t1'),
        mk('m1', { memory: {} }),
        mk('t2'),
        mk('note', { entry: { seq: 1 } }),
        mk('both', { task: {}, memory: {} }),
      ])
      assertEquals(idOf(tx, ['t1', 'm1', 't2', 'note', 'both']), [
        'T-1',
        'M-1',
        'T-2',
        null,
        'M-2',
      ])
    }))

  test(`${backend}: an entity is numbered by the first component in a series, once`, () =>
    open(backend, { number: SERIES }).tx((tx) => {
      tx.patch([mk('note', { entry: { seq: 1 } })])
      tx.patch([mk('note', { task: {} })])
      tx.patch([mk('note', { memory: {} })])
      assertEquals(idOf(tx, ['note']), ['T-1'])
    }))

  test(`${backend}: a reference to nothing numbers nothing until it is given one`, () =>
    open(backend, { number: SERIES }).tx((tx) => {
      tx.patch([mk('a', { task: { target: 'later' } })])
      assertEquals(idOf(tx, ['later']), [null])
      tx.patch([mk('later', { memory: {} })])
      assertEquals(idOf(tx, ['a', 'later']), ['T-1', 'M-1'])
    }))

  test(`${backend}: a stated pair is taken, and its series counts on past it`, () =>
    open(backend, { number: SERIES }).tx((tx) => {
      tx.patch([
        { entity: { eid: 'a', prefix: 'T', num: 5 }, task: {} },
        { entity: { eid: 'b', prefix: 'M', num: 5 }, memory: {} },
        mk('c'),
      ])
      assertEquals(idOf(tx, ['a', 'b', 'c']), ['T-5', 'M-5', 'T-6'])
      assertThrows(
        () => tx.patch([{ entity: { eid: 'c', prefix: 'T', num: 5 } }]),
        Refused,
        "T-5 is a's",
      )
    }))
}

test('sqlite: a series fills its holes, stepping over a number held', () => {
  let d = mem()
  let s = open('sqlite', { number: SERIES }, d)
  s.tx((tx) =>
    tx.patch([2, 3, 5].map((num) => ({
      entity: { eid: `t${num}`, prefix: 'T', num },
      task: {},
    })))
  )
  // As a store whose rows were moved under their letters starts it.
  d.query({
    t: 'update',
    table: 'entity_series',
    set: { high: lit(0) },
    where: eq(col('prefix'), val('T')),
  })
  s.tx((tx) => {
    tx.patch([mk('a'), mk('b'), mk('c')])
    assertEquals(idOf(tx, ['a', 'b', 'c']), ['T-1', 'T-4', 'T-6'])
  })
})

test('sqlite: a store still holding unlettered numbers counts on past them', () => {
  let d = mem()
  open('sqlite', { number: true }, d).tx((tx) =>
    tx.patch([mk('old'), mk('older', { memory: {} })])
  )
  let s = open('sqlite', { number: SERIES }, d)
  s.tx((tx) => {
    tx.patch([mk('new'), mk('saved', { memory: {} })])
    assertEquals(idOf(tx, ['old', 'older', 'new', 'saved']), [
      1,
      2,
      'T-3',
      'M-4',
    ])
    // An unlettered number answers under any letter; a lettered one under
    // its own.
    assertEquals(
      Object.fromEntries(
        ids(vocab).address!(tx, ['T-1', 'M-1', 'T-3', 'M-3']) as Map<
          string,
          string | null
        >,
      ),
      { 'T-1': 'old', 'M-1': 'old', 'T-3': 'new', 'M-3': null },
    )
  })
})

test('sqlite: a spine keeping its number unique on its own counts once, though every row is lettered', () => {
  // A spine made before series had letters, its rows moved under them.
  let d = mem()
  d.query({
    t: 'create table',
    name: 'entity',
    cols: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'eid', type: 'text', notNull: true, unique: true },
      { name: 'num', type: 'integer', unique: true },
    ],
  })
  let s = open('sqlite', { number: SERIES }, d)
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'old', prefix: 'T', num: 1 }, task: {} },
      { entity: { eid: 'older', prefix: 'M', num: 2 }, memory: {} },
    ])
  )
  d.query({ t: 'update', table: 'entity_series', set: { high: lit(0) } })
  s.tx((tx) => {
    tx.patch([mk('saved', { memory: {} }), mk('new')])
    assertEquals(idOf(tx, ['saved', 'new']), ['M-3', 'T-4'])
  })
})

test('sqlite: the series index is built over a spine of series, never over one keeping its number unique on its own', () => {
  let paired = (d: ReturnType<typeof mem>) =>
    d.query({ t: 'pragma', name: 'index_list', arg: 'entity' })
      .map((i) => String(i.name)).includes('entity_num_prefix')
  let old = mem()
  old.query({
    t: 'create table',
    name: 'entity',
    cols: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'eid', type: 'text', notNull: true, unique: true },
      { name: 'num', type: 'integer', unique: true },
    ],
  })
  let fresh = mem()
  open('sqlite', { number: SERIES }, old)
  open('sqlite', { number: SERIES }, fresh)
  assertEquals([paired(old), paired(fresh)], [false, true])
})

for (let backend of ['sqlite', 'ram']) {
  test(`${backend}: by one count, a reference to nothing numbers nothing`, () =>
    open(backend, { number: true }).tx((tx) => {
      let born = (bs: Bundle[]) =>
        tx.patch(bs).map((e) => [e.eid, e.num ?? null])
      let target = (eid: string, at?: string) =>
        mk(eid, { task: at ? { target: at } : {} })
      assertEquals(born([target('a', 'nobody')]), [['a', 1], ['nobody', null]])
      assertEquals(tx.get(['nobody']), [{ entity: { eid: 'nobody' } }])
      // In one batch, a target is numbered where it is first touched.
      assertEquals(born([target('b', 'c'), target('d'), target('c')]), [
        ['b', 2],
        ['c', 3],
        ['d', 4],
      ])
      assertEquals(born([target('nobody')]), [['nobody', 5]])
    }))
}

test('a mint may state the number it is adopting', () => {
  // What a store seeded from another store's export needs: an entity read as
  // 37574 there is 37574 here, and the sequence carries on past it rather than
  // handing the next arrival a number already in use.
  let d = mem()
  let s = open('sqlite', { number: true }, d)
  for (let [eid, n] of [['old', 37574], ['older', 12]] as const) {
    d.query(mintSql(eid, n))
  }
  d.query(mintSql('nameless', false))
  s.tx((tx) => {
    tx.patch([mk('fresh')])
    assertEquals(idOf(tx, ['old', 'older', 'nameless', 'fresh']), [
      37574,
      12,
      null,
      37575,
    ])
  })
})

// A number is a property like any other: a patch stating one gives it to a
// new entity or one holding another, `null` clears it, and the sequence
// carries on past every one given. A number another entity holds is that
// entity's address, so it is refused, unless that entity moves off it in the
// same batch. Each test's store is made beside it, and its patches run in one
// transaction, so the test times only them.
for (let backend of ['sqlite', 'ram']) {
  let fresh = () => {
    let s = open(backend, { number: true })
    s.tx((tx) =>
      tx.patch([
        { entity: { eid: 'old', num: 37574 }, task: {} },
        { entity: { eid: 'made', num: null }, task: {} },
        mk('mine'),
      ])
    )
    // A new entity takes a stated number, or none for null, and the sequence
    // carries on past it.
    assertEquals(
      s.tx((tx) => tx.get(['old', 'made', 'mine']).map((b) => b.entity.num)),
      [37574, undefined, 37575],
    )
    return (body: (tx: Tx, nums: () => (number | null)[]) => void) =>
      s.tx((tx) =>
        body(
          tx,
          () =>
            tx.get(['old', 'made', 'mine']).map((b) => b.entity.num ?? null),
        )
      )
  }
  let sets = fresh(), clears = fresh(), refuses = fresh()

  test(`${backend}: a patch stating a number gives it, and two may swap`, () =>
    sets((tx, nums) => {
      tx.patch([
        { entity: { eid: 'old', num: 37575 } },
        { entity: { eid: 'mine', num: 37574 } },
        { entity: { eid: 'made', num: 3 } },
      ])
      assertEquals(nums(), [37575, 3, 37574])
    }))

  test(`${backend}: a patch stating a null number clears it`, () =>
    clears((tx, nums) => {
      tx.patch([{ entity: { eid: 'old', num: null } }])
      assertEquals(nums(), [null, null, 37575])
    }))

  test(`${backend}: a number another entity holds is refused`, () =>
    refuses((tx, nums) => {
      assertThrows(
        () => tx.patch([{ entity: { eid: 'made', num: 37574 } }]),
        Refused,
        'two entities cannot share an id',
      )
      assertThrows(
        () => tx.patch([{ entity: { eid: 'made', num: 0 } }]),
        Refused,
        'a whole number from 1',
      )
      assertEquals(nums(), [37574, null, 37575])
    }))
}
