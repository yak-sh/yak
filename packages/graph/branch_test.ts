// A read or write naming a `branch` runs on that branch's graph, as its host
// gives it, through either kind of graph; a graph given none refuses it.

import { equal, test, throws } from '@yaks/testing'
import type { Bundle } from './bundle.ts'
import { graph, type GraphBranches } from './graph.ts'
import { graph as reading } from './read.ts'
import { books, memory } from './testing.ts'

let book = (title: string, eid = title): Bundle => ({
  entity: { eid },
  book: { pages: title.length },
})
let eids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)

// Main, and one branch as its host would give it: a graph of its own.
let main = memory(), forked = memory()
let fork = graph({ vocab: books, storage: forked })
let branches: GraphBranches = {
  make: () => Promise.resolve({ id: 1, fork: 0, at: '' }),
  list: () => Promise.resolve([]),
  drop: () => Promise.resolve(),
  changes: () => Promise.resolve([]),
  on: (id) =>
    id == 1 ? Promise.resolve(fork) : Promise.reject(new Error('none')),
}
let g = graph({ vocab: books, storage: main, branches })
let r = reading({ vocab: books, storage: main, branches })
await g.apply([book('main')])
await g.apply([book('draft')], { branch: 1 })

// The two books each side holds.
let both = ['main', 'draft']
let held = async (bs: Bundle[] | Promise<Bundle[]>) =>
  eids((await bs).filter((b) => b.book))

test('a write naming a branch lands on its graph, not main', async () =>
  equal({
    main: await held(g.get(both)),
    branch: await held(fork.get(both)),
  }, { main: ['main'], branch: ['draft'] }))

test('a read naming a branch reads its graph, through either kind of graph', async () =>
  equal([
    await held(g.get(both, undefined, { branch: 1 })),
    await held(r.get(both, undefined, { branch: 1 })),
    await held(r.get(both)),
  ], [['draft'], ['draft'], ['main']]))

test('a graph given no branches refuses a call naming one', async () => {
  let plain = graph({ vocab: books, storage: memory() })
  await throws(() => plain.get(['x'], undefined, { branch: 1 }))
  await throws(() => plain.apply([book('x')], { branch: 1 }))
})
