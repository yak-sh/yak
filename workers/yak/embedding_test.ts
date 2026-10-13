// A store keeps a vector beside each text it searches and ranks by meaning
// over them (embedding.ts, T-59101): `.near` in a query, and words through the
// meaning it lends its host, which memory recall asks.
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { hashEmbedder, pack, TABLE, unit } from '@yaks/embedding'
import { driver } from '@yaks/durable-object'
import { col, select, table, val } from '@yaks/sql'
import { doorOf, PLATFORM_STORE } from './door.ts'
import { callStored } from './package-tools.ts'
import { saved } from '@yaks/memory'
import { Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import { state } from './testing.ts'
import { DIM, SPACE } from './embedding.ts'

let NOBODY = { person: null, role: null }

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

// The store also holds searchable vocabulary documentation. Rank these notes
// as their own corpus, rather than assuming they are its only embedded rows.
let NOTES = '.entity.eid=hobbit,flight,kitchen'

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
    door.query(`${NOTES}&${q}`).then((rows) => rows.map((b) => b.entity.eid))
  await until(() => near('.near=hobbit').then((eids) => eids.length == 2))
  return { door, near }
}

test('a store answers .near from its own vectors, closest first', async () => {
  let { near } = await notes()
  assertEquals(await near('.near=hobbit&.order=similar'), ['flight', 'kitchen'])
  assertEquals(await near('.near=hobbit&.order=similar&.limit=1'), ['flight'])
})

// A space's memories, kept in the directory and recalled through its own
// runner, as the connector's store_memory_recall reaches them.
test("a recall ranks a space's memories by meaning", async () => {
  let store = new Store(state(), { AI })
  let door = doorOf((r) => store.fetch(r), PLATFORM_STORE)
  await metaOf(door).apply([
    { entity: { eid: 'kitchen' }, doc: { title: 'a space' } },
    { entity: { eid: 'elsewhere' }, doc: { title: 'another space' } },
    ...saved({ eid: 'soft', said: 'keep the pages soft', space: 'kitchen' }),
    ...saved({ eid: 'grams', said: 'use grams, never cups', space: 'kitchen' }),
    ...saved({ eid: 'away', said: 'pages pages pages', space: 'elsewhere' }),
  ], KERNEL)
  let recall = async (said: string) =>
    (await callStored(door, 'memory_recall', { said }, NOBODY, {
      space: 'kitchen',
    })).map((b) => b.entity.eid)
  // No memory holds every word, so only the vectors find them, nearest first,
  // and only this space's.
  await until(async () => (await recall('pages look friendly')).length > 0)
  assertEquals(await recall('pages look friendly'), ['soft', 'grams'])
})

test('deployment of vectors in another space re-embeds them all', async () => {
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
  let deployment = new Store(st, { AI })
  await deployment.fetch(
    new Request('http://store/vocab', {
      method: 'POST',
      headers: { 'x-store': 'ada/notes', 'x-yak-kernel': '1' },
      body: '{}',
    }),
  )
  let door = open(st)
  let near = (q: string) =>
    door.query(`${NOTES}&${q}`).then((rows) => rows.map((b) => b.entity.eid))
  await until(() => near('.near=hobbit').then((eids) => eids.length))
  assertEquals(await near('.near=hobbit&.order=similar'), ['flight', 'kitchen'])
  let spaces = () =>
    sql.query(select({
      cols: [col('model')],
      from: table(TABLE),
      distinct: true,
    }))
  // The notes becoming searchable does not mean the rest of the store's
  // migration has finished: schema documentation runs in the same sweep.
  await until(() => spaces().every((r) => r.model == SPACE))
  assertEquals(spaces(), [{ model: SPACE }])
})
