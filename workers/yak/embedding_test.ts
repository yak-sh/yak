// A store keeps a vector beside each text it searches and ranks by meaning
// over them (embedding.ts, T-59101): `.near` in a query, and words through
// the kernel's `/meaning` door, which memory recall asks.
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { hashEmbedder, pack, TABLE, unit } from '@yaks/embedding'
import { driver } from '@yaks/durable-object'
import { col, select, table, val } from '@yaks/sql'
import { doorOf } from './door.ts'
import { Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import { state } from './testing.ts'
import { DIM, SPACE } from './embedding.ts'

// Workers AI, stood in for by word buckets: texts sharing words are near.
let words = hashEmbedder(DIM)
let AI = {
  run: async (_model: string, input: unknown) => ({
    data: await Promise.all(
      (input as { text: string[] }).text.map(async (t) => [
        ...await words.embed(t),
      ]),
    ),
  }),
  gateway: () => ({ getUrl: () => Promise.resolve('') }),
}

// A store over an object's state, and its door.
let open = (st: ReturnType<typeof state>) => {
  let store = new Store(st, { AI })
  return metaOf(doorOf((r) => store.fetch(r), 'ada/notes'))
}

// An app's store holding three notes, embedded once their write committed.
let notes = async (st = state()) => {
  let door = open(st)
  await door.apply([
    { entity: { eid: 'hobbit' }, doc: { title: 'a burglar meets a dragon' } },
    { entity: { eid: 'flight' }, doc: { title: 'a dragon meets a burglar' } },
    { entity: { eid: 'kitchen' }, doc: { title: 'what cooks do at night' } },
  ], KERNEL)
  let near = (q: string) =>
    door.query(q).then((rows) => rows.map((b) => b.entity.eid))
  await until(() => near('.near=hobbit').then((eids) => eids.length))
  return { door, near }
}

test('a store answers .near from its own vectors, closest first', async () => {
  let { near } = await notes()
  assertEquals(await near('.near=hobbit&.order=similar'), ['flight', 'kitchen'])
  assertEquals(await near('.near=hobbit&.order=similar&.limit=1'), ['flight'])
})

test('words rank by meaning among what a line selects', async () => {
  let { door } = await notes()
  let hits = await door.meaning('dragon burglar', { within: '.doc', limit: 2 })
  assertEquals(hits.map((h) => h.entity).sort(), ['flight', 'hobbit'])
  let none = await door.meaning('dragon', { within: '.eid=kitchen' })
  assertEquals(none.map((h) => h.entity), ['kitchen'])
})

test('a store woken with its vectors in another space re-embeds them all', async () => {
  let st = state()
  await notes(st)
  let sql = driver(st.storage)
  sql.query({
    t: 'update',
    table: TABLE,
    set: {
      model: val(`${SPACE}#256`),
      hash: val(''),
      vec: val(pack(unit(new Float32Array(256).fill(1)))),
    },
  })
  let door = open(st)
  let near = (q: string) =>
    door.query(q).then((rows) => rows.map((b) => b.entity.eid))
  await until(() => near('.near=hobbit').then((eids) => eids.length))
  assertEquals(await near('.near=hobbit&.order=similar'), ['flight', 'kitchen'])
  let spaces = sql.query(select({
    cols: [col('model')],
    from: table(TABLE),
    distinct: true,
  }))
  assertEquals(spaces, [{ model: SPACE }])
})
