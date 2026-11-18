// The generic restore tool reports an allocated alias beside its patches.
import { equal, test } from '@yaks/testing'
import { tier } from '@yaks/graph/tools'
import { cookbookGraph } from './testing.ts'

let g = cookbookGraph()
let named = async (title: string) => {
  let rows = await g.apply([{
    entity: { eid: '$note' },
    alias: { name: 'notes' },
    doc: { title },
  }])
  return rows.find((b) => b.$alias == '$note')!.entity.eid
}
let original = await named('Original')
await g.apply([{ entity: { eid: original }, $delete: true }])
let replacement = await named('Replacement')
let restore = tier().find((t) => t.name == 'graph_restore')!

test('the graph restore tool reports a free alias and preserves its new owner', async () => {
  let patches = await restore.run({
    entity: { eid: 'call' },
    call: { args: { ids: [original] } },
  }, g)
  let notice = patches.find((b) => b.output)
  equal(notice?.content, {
    body: 'Alias "notes" was taken; restored as "notes-2".',
  })
  equal(notice?.output, { source: 'call' })
  await g.apply(patches.filter((b) => !b.output))
  let names = await g.address(['notes', 'notes-2'])
  equal(names.get('notes'), replacement)
  equal(names.get('notes-2'), original)
})
