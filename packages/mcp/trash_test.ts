// Graph deletions can be read and restored through the caller's tool door.
import { equal, test } from '@yaks/testing'
import { type Bundle, derivedEid, Refused } from '@yaks/graph'
import { connect, result, shopGraph } from './testing.ts'
import { valueIn } from '@yaks/tools/value'
import { assert } from '@std/assert'

let actor = derivedEid('fixture:trash-restorer')
let g = shopGraph()
await g.apply([
  {
    entity: { eid: 'book' },
    doc: { title: 'Saved book' },
    book: { price: 12 },
  },
  { entity: { eid: 'review' }, review: { book: 'book', stars: 5 } },
])
let [original] = await g.get(['book'])
await g.apply([{ entity: { eid: 'book' }, $delete: true }])
let client = await connect({ graph: g, actor: { by: actor } })

test('graph trash and restore recover a deletion cascade through MCP', async () => {
  try {
    let answer = result(
      await client.callTool({
        name: 'graph_trash',
        arguments: { ids: ['book'] },
      }),
    ) as Bundle[]
    let saved = valueIn(answer) as unknown as {
      id: string
      at: string
      bundles: Bundle[]
    }[]
    equal(saved.length, 1)
    equal(saved[0].bundles.map((b) => b.entity.eid).sort(), ['book', 'review'])
    let restored = await client.callTool({
      name: 'graph_restore',
      arguments: { ids: ['book'] },
    })
    assert(!restored.isError, JSON.stringify(restored))
    let rows = await g.get(['book', 'review'])
    equal(rows[0].doc, { title: 'Saved book' })
    equal(rows[1].review, { book: 'book', stars: 5 })
    equal(rows[0].created, original.created)
    equal((rows[0].updated as { by: string }).by, actor)
  } finally {
    await client.close()
  }
})

let protectedGraph = shopGraph()
await protectedGraph.apply([{
  entity: { eid: 'protected' },
  doc: { title: 'Protected book' },
  book: { price: 20 },
}])
await protectedGraph.apply([{ entity: { eid: 'protected' }, $delete: true }])
protectedGraph.use({
  name: 'writer-permission',
  authorize: (bundles, _tx, _error, context) => {
    if (!context?.trusted && bundles.some((b) => b.entity.eid == 'protected')) {
      throw new Refused('this caller cannot write the protected book')
    }
    return bundles
  },
})
let protectedClient = await connect({
  graph: protectedGraph,
  actor: { by: actor },
})

test('graph restore retains ordinary caller write authorization', async () => {
  try {
    let answer = await protectedClient.callTool({
      name: 'graph_restore',
      arguments: { ids: ['protected'] },
    })
    equal(answer.isError, true)
    equal((await protectedGraph.get(['protected']))[0].tombstone, {})
  } finally {
    await protectedClient.close()
  }
})

let paged = shopGraph()
await paged.apply(['one', 'two'].map((eid) => ({
  entity: { eid },
  doc: { title: eid },
})))
for (let eid of ['one', 'two']) {
  await paged.apply([{ entity: { eid }, $delete: true }])
}
let pageClient = await connect({ graph: paged })
let groups = async (args: Record<string, unknown>) =>
  valueIn(result(
    await pageClient.callTool({
      name: 'graph_trash',
      arguments: args,
    }),
  ) as Bundle[]) as unknown as { id: string; bundles: Bundle[] }[]

test('graph trash pages older deletions and reads a chosen group by id', async () => {
  try {
    let [first] = await groups({ limit: 1 })
    let [second] = await groups({ limit: 1, after: first.id })
    equal(
      [first, second].flatMap((x) => x.bundles.map((b) => b.entity.eid)).sort(),
      [
        'one',
        'two',
      ],
    )
    equal((await groups({ id: second.id }))[0], second)
    let restored = await pageClient.callTool({
      name: 'graph_restore',
      arguments: { id: second.id },
    })
    assert(!restored.isError, JSON.stringify(restored))
    let eid = second.bundles[0].entity.eid
    equal((await paged.get([eid]))[0].doc, { title: eid })
  } finally {
    await pageClient.close()
  }
})
