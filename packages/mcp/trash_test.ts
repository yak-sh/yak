// Saved graph deletions are read through the caller's tool door.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { valueIn } from '@yaks/tools/value'
import { connect, result, shopGraph } from './testing.ts'

let g = shopGraph()
await g.apply([
  {
    entity: { eid: 'book' },
    doc: { title: 'Saved book' },
    book: { price: 12 },
  },
  { entity: { eid: 'review' }, review: { book: 'book', stars: 5 } },
])
await g.apply([{ entity: { eid: 'book' }, $delete: true }])
let client = await connect({ graph: g })

test('graph trash reads a saved deletion cascade through MCP', async () => {
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
    equal(saved[0].bundles.find((b) => b.entity.eid == 'book')?.doc, {
      title: 'Saved book',
    })
    equal((await g.get(['book']))[0].tombstone, {})
  } finally {
    await client.close()
  }
})
