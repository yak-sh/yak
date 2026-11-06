import { equal, test } from '@yaks/testing'
import { ram } from '@yaks/ram'
import type { Bundle } from './bundle.ts'
import { graph } from './graph.ts'
import { held } from './held.ts'
import { books } from './testing.ts'

let native = { native: true }
let byEid = (rows: Bundle[]) =>
  rows.toSorted((a, b) => a.entity.eid.localeCompare(b.entity.eid))

// A shop with held reads over it: `ask` reads every query held, `commit`
// writes, tells the held reads what moved, checks they answer what storage
// answers, and says how many storage reads that took and whether any held
// answer changed.
let shop = async (queries: string[]) => {
  let g = graph({ vocab: books, storage: ram(books) })
  await g.install()
  await g.apply([
    {
      entity: { eid: 'b1' },
      book: { pages: 120, status: 'stocked' },
      doc: { title: 'Dune' },
    },
    { entity: { eid: 'b2' }, book: { pages: 80, status: 'draft' } },
    {
      entity: { eid: 'r1' },
      review: { stars: 4, book: 'b1' },
      doc: { title: 'Fine' },
    },
  ])
  let reads = 0
  let h = held({
    read: (q, o) => (reads++, g.read(q, o)),
    get: (eids, comps, o) => (reads++, g.get(eids, comps, o)),
  }, books)
  let counted = async (f: () => Promise<unknown>) => {
    let before = reads
    await f()
    return reads - before
  }
  let ask = (qs = queries, opts: object = native) =>
    Promise.all(qs.map((q) => h.read(q, opts)))
  let commit = async (bundles: Bundle[]) => {
    await g.apply(bundles)
    let changed = false
    let n = await counted(async () => {
      changed = await h.moved(bundles.map((b) => b.entity.eid))
      equal(
        (await ask()).map(byEid),
        (await Promise.all(queries.map((q) => g.read(q, native)))).map(byEid),
      )
    })
    return { reads: n, changed }
  }
  return { h, ask, commit, counted }
}

test('held reads read each commit once, and every answer takes what it touched as it stands', async () => {
  let s = await shop([
    '.book.pages>100',
    '.book&.fields=entity.eid,book.status',
    '.review.book=b1&?doc',
    '(.book.status=sold)|(.review.stars=5)',
    '.doc&.fields=entity.eid,doc.title&.entity.eid=b1,b2,r1,r2',
  ])
  await s.ask()
  let moved = { reads: 1, changed: true }
  equal(
    [
      await s.commit([{ entity: { eid: 'b2' }, book: { pages: 150 } }]),
      await s.commit([{
        entity: { eid: 'r2' },
        review: { stars: 5, book: 'b1' },
        doc: { title: 'Great' },
      }]),
      await s.commit([{ entity: { eid: 'b1' }, doc: null }]),
      await s.commit([{ entity: { eid: 'b1' }, book: { status: 'sold' } }]),
      await s.commit([{ entity: { eid: 'r1' }, $delete: true }]),
      await s.commit([{ entity: { eid: 'm1' }, bookmark: { of: 'b1' } }]),
    ],
    [moved, moved, moved, moved, moved, { reads: 1, changed: false }],
  )
})

test('a query naming its entities reads only the ones it does not hold', async () => {
  let s = await shop([])
  let q = (ids: string) => [`.doc&.fields=entity.eid&.entity.eid=${ids}`]
  equal(
    [
      await s.counted(() => s.ask(q('b1,b2'))),
      await s.counted(() => s.ask(q('b2,b1,r1'))),
      await s.counted(() => s.ask(q('r1,b1'))),
    ],
    [1, 1, 0],
  )
  equal((await s.ask(q('b1,b2,r1')))[0].map((b) => b.entity.eid), ['b1', 'r1'])
})

test('a query held reads cannot keep current is read every time', async () => {
  let s = await shop([])
  let twice = (q: string, opts?: object) =>
    s.counted(async () => {
      await s.ask([q], opts)
      await s.ask([q], opts)
    })
  equal(
    [
      await twice('.book .order=book.pages'),
      await twice('.review.book.book.pages>100'),
      await twice('.created.at>"1 hour ago"'),
      await twice('.book', {}),
      await twice('.book'),
    ],
    [2, 2, 2, 2, 1],
  )
})

test('an answer a pass that asked did not ask for is let go', async () => {
  let s = await shop([])
  let ask = (q: string) => s.counted(() => s.ask([q]))
  let a = await ask('.book')
  await s.h.moved([])
  await s.h.moved([])
  let b = await ask('.review')
  await s.h.moved([])
  equal([a, b, await ask('.book'), await ask('.review')], [1, 1, 1, 0])
})
