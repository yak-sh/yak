// Hook eligibility follows the batch as earlier hooks and cascades rewrite it.
import { equal, ok, test, throws } from '@yaks/testing'
import { record } from '@yaks/trace'
import { graph } from './mod.ts'
import { hook } from '@yaks/graph/plugin'
import { books, memory } from './testing.ts'

// A graph whose first normalize hook gives `added` a book, and whose second
// is keyed on book: what the keyed hook saw, under which graph, and how often
// the unkeyed one ran.
let rewriting = () => {
  let seen: unknown[] = [], contexts: unknown[] = [], runs = { always: 0 }
  let g = graph({
    vocab: books,
    storage: memory(),
    plugins: [{
      name: 'rewrite',
      hooks: {
        normalize: (b) => {
          runs.always++
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
        normalize: hook(['book'], (b, _tx, err, context) => {
          equal(err, undefined)
          contexts.push(context?.graph)
          seen.push(b[0].book)
          return b
        }),
      },
    }],
  })
  return { g, seen, contexts, runs }
}

let idle = rewriting(), added = rewriting(), removed = rewriting()
await removed.g.apply([{
  entity: { eid: 'idle' },
  doc: { title: 'Untouched' },
}])

test('a keyed hook skips a batch without its key, before tracing', async () => {
  let { g, seen, runs } = idle
  let out = await record(
    g,
    () => g.apply([{ entity: { eid: 'idle' }, doc: { title: 'Untouched' } }]),
  )
  ok(!out.spans.some((e) => e.plugin == 'books'))
  equal([seen, runs.always], [[], 1])
})

test('a keyed hook sees its key when an earlier hook writes it', async () => {
  let { g, seen, contexts } = added
  let out = await record(g, () => g.apply([{ entity: { eid: 'added' } }]))
  ok(out.spans.some((e) => e.plugin == 'books'))
  equal(out.result[0].book, { pages: 3 })
  equal(seen, [{ pages: 3 }])
  equal(contexts, [g])
})

test('a keyed hook sees a null removal of its key', async () => {
  let { g, seen, runs } = removed
  await g.apply([{ entity: { eid: 'idle' }, book: null }])
  equal([seen, runs.always], [[null], 2])
})

// A graph whose book hooks refuse a book of -1 pages at commit and count
// audits and effects, and whose bookmark cascade hook keeps what it released.
let watched = () => {
  let counts = { audited: 0, observed: 0 }, released: unknown[] = []
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
          counts.audited++
          return b
        }),
        effect: hook(['book'], (b) => {
          counts.observed++
          return b
        }),
        cascade: hook(['bookmark'], (b) => {
          released.push(...b.filter((b) => b.bookmark === null))
          return b
        }),
      },
    }],
  })
  return { g, counts, released }
}

let refusing = watched(), cascading = watched()
await cascading.g.apply([
  { entity: { eid: 'book' }, book: { pages: 3 } },
  { entity: { eid: 'mark' }, bookmark: { of: 'book' } },
])

test('a refused batch rolls back whole, audited and never observed', async () => {
  let { g, counts } = refusing
  await throws(() =>
    g.apply([
      { entity: { eid: 'refused' }, book: { pages: -1 } },
      { entity: { eid: 'also-refused' }, doc: { title: 'Rolled back' } },
    ]), 'refused')
  equal(await g.get(['refused', 'also-refused']), [])
  equal(counts, { audited: 1, observed: 0 })
})

test('a keyed cascade hook observes the removals a delete cascades', async () => {
  let { g, counts, released } = cascading
  await g.apply([{ entity: { eid: 'book' }, $delete: true }])
  equal(released, [{ entity: { eid: 'mark' }, bookmark: null }])
  equal(counts, { audited: 0, observed: 1 })
})
