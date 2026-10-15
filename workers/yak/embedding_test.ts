// A store keeps a vector beside each text it searches and ranks by meaning
// over them (embedding.ts, T-59101): `.near` in a query, and words through the
// meaning it lends its host, which memory recall asks.
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  type Embedder,
  hashEmbedder,
  pack,
  schema,
  sweep,
  TABLE,
  unit,
} from '@yaks/embedding'
import { driver } from '@yaks/durable-object'
import { col, select, table, val } from '@yaks/sql'
import { doorOf } from './door.ts'
import { line, memoryDoc, saved } from '@yaks/memory'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { storage as sqliteStorage } from '@yaks/sqlite'
import { blobRead } from '@yaks/blob'
import { preparedDriver, snapshot } from '../../packages/sqlite/testing.ts'
import { Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import { state } from './testing.ts'
import { DIM, ranking, SPACE, texts } from './embedding.ts'

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

// A space's memories, as the directory keeps them: rows in a SQLite of their
// own with a vector beside each text, embedded once. The directory is a store
// like any other, so what ranks them is the Store's `meaning` (`ranking`) and
// the memory tools' recall over it.
// A small space of word buckets keeps the scan small.
let words64 = hashEmbedder(64)
let memories = await (async () => {
  let vocab = loadVocab([docDoc, memoryDoc, {
    $defs: {
      entity: {
        component: true,
        type: 'object',
        wire: false,
        properties: { num: { type: 'number', stamped: true } },
      },
      created: {
        component: true,
        type: 'object',
        properties: {
          at: { type: 'string', format: 'date-time', stamped: true },
          by: { type: 'string', stamped: true },
          via: { type: 'string', stamped: true },
        },
      },
    },
  }])
  let derived = blobRead(vocab)
  let drive = preparedDriver(snapshot(vocab, { derived }))
  for (let stmt of schema()) drive.query(stmt)
  let store = sqliteStorage(drive, vocab, { derived, schemaReady: () => true })
  let g = graph({ vocab, storage: store })
  await g.apply([
    { entity: { eid: 'kitchen' }, doc: { title: 'a space' } },
    { entity: { eid: 'elsewhere' }, doc: { title: 'another space' } },
    ...saved({ eid: 'soft', said: 'keep the pages soft', space: 'kitchen' }),
    ...saved({ eid: 'grams', said: 'use grams, never cups', space: 'kitchen' }),
    ...saved({ eid: 'away', said: 'pages pages pages', space: 'elsewhere' }),
  ])
  let fields = texts(vocab, derived)
  await sweep(store.statements, fields, words64)
  let held = {
    statements: store.statements,
    fields,
    screen: (q: string) => store.screen(q),
  }
  // A store that has been searched once: the first search loads its vectors.
  await ranking(() => words64, held)('pages', {
    within: line({ space: 'kitchen', limit: 8 }),
  })
  return held
})()

test("a recall ranks a space's memories by meaning", async () => {
  let rank = (model: Embedder | null) => ranking(() => model, memories)
  // What a recall asks the ranking to stay within: this space's memories.
  let within = line({ space: 'kitchen', limit: 8 })
  let nearest = async (said: string) =>
    (await rank(words64)(said, { within })).map((h) => h.entity)
  // No memory holds every word, so only the vectors find them, nearest first,
  // and only this space's.
  assertEquals(await nearest('pages look friendly'), ['soft', 'grams'])
  // A store with no model bound ranks nothing.
  assertEquals(await rank(null)('pages', { within }), [])
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
