// Hook eligibility follows the batch as earlier hooks and cascades rewrite it.
import { equal, ok, test, throws } from '@yaks/testing'
import { record } from '@yaks/trace'
import { graph, hook } from './mod.ts'
import { books, memory } from './testing.ts'

test('hook keys see earlier rewrites and null removals before tracing', async () => {
  let seen: unknown[] = [], always = 0
  let g = graph({
    vocab: books,
    storage: memory(),
    plugins: [{
      name: 'rewrite',
      hooks: {
        normalize: (b) => {
          always++
          return Promise.resolve(
            b.map((b) =>
              b.entity.eid == 'added' ? { ...b, book: { pages: 3 } } : b
            ),
          )
        },
      },
    }, {
      name: 'books',
      hooks: {
        normalize: hook(['book'], (b) => {
          seen.push(b[0].book)
          return b
        }),
      },
    }],
  })
  let idle = await record(g, () =>
    g.apply([{
      entity: { eid: 'idle' },
      doc: { title: 'Untouched' },
    }]))
  ok(!idle.spans.some((e) => e.plugin == 'books'))
  let added = await record(g, () => g.apply([{ entity: { eid: 'added' } }]))
  ok(added.spans.some((e) => e.plugin == 'books'))
  equal(added.result[0].book, { pages: 3 })
  await g.apply([{ entity: { eid: 'idle' }, book: null }])
  equal(seen, [{ pages: 3 }, null])
  equal(always, 3)
})

test('eligible hooks preserve rollback and observe cascaded removals', async () => {
  let audited = 0, observed = 0, released: unknown[] = []
  let g = graph({
    vocab: books,
    storage: memory(),
    plugins: [{
      name: 'books',
      hooks: {
        commit: hook(['book'], (b) => {
          if (b.some((b) => (b.book as { pages?: number })?.pages == -1)) {
            throw new Error('refused')
          }
          return b
        }),
        audit: hook(['book'], (b, _tx, err) => {
          ok(err instanceof Error)
          audited++
          return b
        }),
        effect: hook(['book'], (b) => {
          observed++
          return b
        }),
        cascade: hook(['bookmark'], (b) => {
          released.push(...b.filter((b) => b.bookmark === null))
          return b
        }),
      },
    }],
  })
  await throws(() =>
    g.apply([
      { entity: { eid: 'refused' }, book: { pages: -1 } },
      { entity: { eid: 'also-refused' }, doc: { title: 'Rolled back' } },
    ]), 'refused')
  equal(await g.get(['refused', 'also-refused']), [])
  equal([audited, observed], [1, 0])
  await g.apply([
    { entity: { eid: 'book' }, book: { pages: 3 } },
    { entity: { eid: 'mark' }, bookmark: { of: 'book' } },
  ])
  await g.apply([{ entity: { eid: 'book' }, $delete: true }])
  equal(released, [{ entity: { eid: 'mark' }, bookmark: null }])
  equal([audited, observed], [1, 1])
})
