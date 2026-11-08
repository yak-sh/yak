import { assert, assertEquals } from '@std/assert'
import { clock, test } from '@yaks/testing'
import { col, insert, select, table, tally } from '@yaks/sql'
import { graph } from '@yaks/graph'
import { open } from '@yaks/sqlite/db'
import { statements, storage } from '@yaks/sqlite'
import { follow, printOf } from '@yaks/sqlite/follow'
import { entity, stepping } from '../sqlite/testing.ts'
import { FILL, OWED, schema } from './ddl.ts'
import { fields, present } from './fields.ts'
import { fill, filling, schedule } from './fill.ts'
import { due, watch } from './owed.ts'
import { drain } from './sweep.ts'
import { embedder, shelf, shop } from './testing.ts'

let text = fields(shop)
let large = shelf()
for (let id = 5; id < 605; id++) {
  entity(large, id, `book-${id}`)
  large.query(
    insert('book', { entity: id, title: 'Words', blurb: '', price: 1 }),
  )
}

// A second statement capability represents another service opening the same
// database: cursors belong to the storage, not the process that watched it.
let driver = open(':memory:')
let partial = shelf(statements(driver))
partial.query({
  t: 'create table',
  name: 'draft',
  cols: [{ name: 'entity', type: 'integer', pk: true }],
})
partial.query(insert('draft', { entity: 3 }))
let excludes = text.map((f) => ({ ...f, not: ['draft'] }))
schedule(partial, ['book'])
fill(partial, excludes, 2)
let resumed = statements(driver)

let yielding = shelf()
let time = clock()
let turns = 0
let yielded = Promise.withResolvers<void>()
let stopped = new AbortController()
let done = drain(yielding, text, embedder, {
  batch: 1,
  signal: stopped.signal,
  clock: {
    ...time,
    after: (ms, go) => {
      turns++
      yielded.resolve()
      return time.after(ms, go)
    },
  },
})

test('watch queues a bounded portion and resumes the complete corpus', () => {
  watch(large, text)
  let first = due(large, 1000).length
  assert(first > 0 && first < 604)
  assert(filling(large))
  while (filling(large)) fill(large, text)
  assertEquals(due(large, 1000).length, 604)
})

test('reconciliation resumes through excluded source rows on a fresh capability', () => {
  assertEquals(due(resumed, 10).map((d) => d.owner), [2, 1])
  assert(filling(resumed))
  fill(resumed, excludes, 2)
  assertEquals(filling(resumed), false)
  assertEquals(due(resumed, 10).map((d) => d.owner), [2, 1])
  assertEquals(tally(resumed, FILL), 0)
})

test('drain yields between passes even when its embedder resolves immediately', async () => {
  await yielded.promise
  stopped.abort()
  await time.advance(0)
  await done
  assertEquals(turns, 1)
  assertEquals(tally(yielding, OWED), 3)
})

let dir = Deno.makeTempDirSync({ prefix: 'embedding-fill-upgrade-' })
let oldFile = open(`${dir}/graph.db`)
let oldStore = storage(oldFile, shop)
oldStore.install()
let oldSchema = schema().filter((s) => s.t != 'create table' || s.name != FILL)
follow(oldFile, printOf('embedding', oldSchema), () => {
  for (let stmt of oldSchema) oldFile.query(stmt)
})
await graph({ storage: oldStore, vocab: shop }).apply([1, 2, 3].map((id) => ({
  entity: { eid: `old-${id}` },
  book: { title: 'Old book' },
})))
let oldOwners = oldFile.query(select({
  cols: [col('entity')],
  from: table('book'),
  order: [col('entity')],
})).map((r) => Number(r.entity))
oldFile.query(insert(OWED, { owner: oldOwners[0], n: 7 }))
oldFile.close()
let upgraded = open(`${dir}/graph.db`)

test('a standing pre-cursor file installs reconciliation without losing its queue', () => {
  try {
    let wanted = schema()
    assertEquals(
      follow(upgraded, printOf('embedding', wanted), () => {
        for (let stmt of wanted) upgraded.query(stmt)
      }),
      true,
    )
    let db = statements(upgraded)
    assertEquals(due(db, 10), [{ owner: oldOwners[0], n: 7 }])
    schedule(db, ['book'])
    fill(db, present(db, text), 2)
    assertEquals(
      due(db, 10).map((d) => d.owner),
      oldOwners.slice(0, 2).reverse(),
    )
    assert(filling(db))
    assertEquals(
      follow(upgraded, printOf('embedding', wanted), () => {
        throw new Error('a second install must leave the cursors intact')
      }),
      false,
    )
  } finally {
    upgraded.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

let excludedWorld = (size: number) => {
  let { driver, steps } = stepping()
  let db = shelf(statements(driver))
  db.query({
    t: 'create table',
    name: 'draft',
    cols: [{ name: 'entity', type: 'integer', pk: true }],
  })
  let ids = Array.from({ length: size }, (_, i) => i + 5)
  db.query(insert('entity', ...ids.map((id) => ({ id, eid: `x-${id}` }))))
  db.query(
    insert('book', ...ids.map((entity) => ({ entity, title: 'Excluded' }))),
  )
  db.query(insert('draft', ...[1, 2, 3, ...ids].map((entity) => ({ entity }))))
  let text = [{ comp: 'book', prop: 'title', not: ['draft'] }]
  schedule(db, ['book'])
  fill(db, text, 2)
  return { db, steps, page: () => fill(db, text, 2) }
}
let [short, long] = [40, 400].map(excludedWorld)

test('a reconciliation window bounds work before excluding a long source tail', () => {
  let at = short.steps()
  short.page()
  let small = short.steps() - at
  at = long.steps()
  long.page()
  let large = long.steps() - at
  assertEquals(due(long.db, 10), [])
  assert(filling(long.db))
  assert(large <= small + 100, `${small} then ${large} VM steps`)
})
