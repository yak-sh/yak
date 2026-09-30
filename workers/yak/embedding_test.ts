// A store keeps a vector beside each text it searches and ranks by meaning
// over them (embedding.ts, T-59101): `.near` in a query, and words through
// the kernel's `/meaning` door, which memory recall asks.
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { hashEmbedder } from '@yaks/embedding'
import { doorOf } from './door.ts'
import { Store } from './graph.ts'
import { KERNEL, metaOf } from './meta.ts'
import { state } from './testing.ts'
import { DIM } from './embedding.ts'

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

// An app's store holding three notes, embedded once their write committed.
let notes = async () => {
  let store = new Store(state(), { AI })
  let door = metaOf(doorOf((r) => store.fetch(r), 'ada/notes'))
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
