import { equal, test } from '@yaks/testing'
import { after } from '@yaks/fp'
import { ram } from '@yaks/ram'
import { graph } from './graph.ts'
import { books, comp } from './testing.ts'
import type { Committed } from './storage.ts'

let stores = () => {
  let owner = ram(books), other = ram(books)
  for (let [store, title] of [[owner, 'owner'], [other, 'reader']] as const) {
    store.tx((tx) => tx.patch([{ entity: { eid: 'x' }, doc: { title } }]))
  }
  return { owner, other }
}

// The lent graph already projected its answers; raw preflight reads must not
// pass through it, and transaction checks must see the owner's current rows.
let projectedReads = (() => {
  let { owner, other } = stores()
  let seen: string[] = []
  let projected = graph({
    storage: other,
    vocab: books,
    plugins: [{
      name: 'view',
      answer: (_ctx, rows) =>
        rows.map((b) => ({
          ...b,
          doc: { ...comp(b, 'doc'), title: `${comp(b, 'doc').title}!` },
        })),
    }],
  })
  let g = graph({
    storage: owner,
    vocab: books,
    reader: { ...projected, storage: other },
    plugins: [{
      name: 'check',
      hooks: {
        prepare: (bundles, tx) =>
          after(tx.get(['x'], ['doc']), ([b]) => {
            seen.push(String(comp(b, 'doc').title))
            return bundles
          }),
        precondition: (bundles, tx) =>
          after(tx.get(['x'], ['doc']), ([b]) => {
            seen.push(String(comp(b, 'doc').title))
            return bundles
          }),
      },
    }],
  })
  return { g, owner, seen }
})()

test('lent committed reads keep projections and write transaction reads separate', async () => {
  let { g, owner, seen } = projectedReads
  equal(comp((await g.get(['x']))[0], 'doc').title, 'reader!')
  equal(comp((await g.outside.get(['x'], ['doc']))[0], 'doc').title, 'reader')
  await g.apply([{ entity: { eid: 'x' }, doc: { title: 'written' } }], {
    trusted: true,
  })
  equal(seen, ['reader', 'owner'])
  equal(comp((await owner.get(['x']))[0], 'doc').title, 'written')
})

test('address resolution awaits each committed revision and invalidates cached names', async () => {
  let { owner, other } = stores()
  let revision: (value: unknown) => void = () => {}
  let reads = 0, target = 'x'
  let raw: Committed = {
    ...other,
    revision: () => new Promise((resolve) => revision = resolve),
  }
  let projected = graph({ storage: other, vocab: books })
  let g = graph({
    storage: owner,
    vocab: books,
    reader: { ...projected, storage: raw },
    plugins: [{
      name: 'names',
      address: (tx, ids) =>
        after(tx.get(['x']), () => {
          reads++
          return new Map(ids.map((id) => [id, target]))
        }),
    }],
  })
  let first = g.address(['name'])
  equal(reads, 0)
  revision(1)
  equal(await first, new Map([['name', 'x']]))
  let same = g.address(['name'])
  revision(1)
  await same
  equal(reads, 1)
  target = 'y'
  let changed = g.address(['name'])
  revision(2)
  equal(await changed, new Map([['name', 'y']]))
  equal(reads, 2)
})

test('lent grave and binding reads never acquire a write transaction', async () => {
  let { owner, other } = stores()
  let projected = graph({ storage: other, vocab: books })
  let g = graph({
    storage: {
      ...owner,
      tx: () => {
        throw Error('write acquired')
      },
    },
    vocab: books,
    reader: {
      ...projected,
      storage: {
        ...other,
        buried: () => Promise.resolve({ eids: ['x'], next: 'next' }),
        bindings: () => Promise.resolve([[]]),
      },
    },
  })
  equal(await g.outside.buried!('before', { limit: 1 }), {
    eids: ['x'],
    next: 'next',
  })
  equal(await g.outside.bindings!([], [], []), [[]])
})
