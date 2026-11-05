import { equal, test } from '@yaks/testing'
import { graph } from './graph.ts'
import type { Bundle } from './bundle.ts'
import { books, memory, slow } from './testing.ts'

let born = '2026-01-01T00:00:00.000Z'
let edited = '2026-01-02T00:00:00.000Z'
let delivered = '2026-01-03T00:00:00.000Z'
let author = '00000000-0000-4000-8000-000000000001'
let listener = '00000000-0000-4000-8000-000000000002'

for (let async of [false, true]) {
  for (let prior of [false, true]) {
    for (let remove of [false, true]) {
      let store = memory()
      let g = graph({ vocab: books, storage: async ? slow(store) : store })
      await g.apply([{
        entity: { eid: 'comment' },
        doc: { body: 'A comment' },
        ...remove ? { sold: {} } : {},
        $actor: { by: author },
      }], { now: born })
      if (prior) {
        await g.apply([{
          entity: { eid: 'comment' },
          doc: { body: 'An edited comment' },
          $actor: { by: author },
        }], { now: edited })
      }
      let [before] = await g.get(['comment'])
      test(`mark ${remove ? 'removal' : 'addition'} preserves ${prior ? 'existing' : 'absent'} edit (${async})`, async () => {
        await g.apply([{
          entity: { eid: 'comment' },
          sold: remove ? null : {},
          $actor: { by: listener },
        }], { now: delivered })
        let [after] = await g.get(['comment'])
        equal(after.updated, before.updated)
        equal(after.created, before.created)
        equal(after.doc, before.doc)
        equal(after.sold, remove ? undefined : { at: delivered, by: listener })
      })
    }
  }

  let store = memory()
  let g = graph({ vocab: books, storage: async ? slow(store) : store })
  await g.apply(
    ['mixed', 'marked', 'content'].map((eid) => ({
      entity: { eid },
      doc: { body: 'Original' },
    })),
    { now: born },
  )
  test(`content edits stamp independently of marks and other entities (${async})`, async () => {
    let patches: Bundle[] = [
      { entity: { eid: 'mixed' }, sold: {} },
      { entity: { eid: 'mixed' }, doc: { body: 'Edited' } },
      { entity: { eid: 'marked' }, sold: {} },
      { entity: { eid: 'content' }, doc: { body: 'Edited' } },
      { entity: { eid: 'new' }, sold: {} },
    ]
    await g.apply(patches.map((b) => ({ ...b, $actor: { by: author } })), {
      now: edited,
    })
    let rows = await g.get(['mixed', 'marked', 'content', 'new'])
    equal(rows.map((b) => b.updated), [
      { at: edited, by: author },
      undefined,
      { at: edited, by: author },
      undefined,
    ])
    equal(rows[3].created, { at: edited, by: author })
    equal(rows[3].sold, { at: edited, by: author })
  })
}
