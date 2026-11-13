// A wake that watches a query fires only when its rows changed: each look is
// a tick, and a tick that finds nothing new moves the wake on unfired.

import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { HOUR, store, T0, woken } from './testing.ts'
import { tick } from './tick.ts'
import { look } from './watch.ts'

let iso = (t: number) => new Date(t).toISOString()
let g = woken(store())
await g.apply([{ entity: { eid: 'fern' }, plant: { name: 'fern' } }])
let { seen } = await look({}, await g.read('.plant'))
await g.apply([{
  entity: { eid: 'w' },
  wake: { at: iso(T0), every: '1h' },
  watch: { query: '.plant', seen },
}])

// Each step: a write (or none), then a tick an hour on.
let steps: [string, Bundle[]][] = [
  ['nothing new', []],
  ['a plant arrives', [{ entity: { eid: 'ivy' }, plant: { name: 'ivy' } }]],
  ['nothing new again', []],
  ['a plant changes', [{ entity: { eid: 'fern' }, plant: { name: 'Fern' } }]],
  ['a plant leaves', [{ entity: { eid: 'ivy' }, $delete: true }]],
]
let seenAt: [string, boolean, string, string][] = []
for (let [i, [name, write]] of steps.entries()) {
  if (write.length) await g.apply(write)
  let { fired } = await tick(g, T0 + i * HOUR)
  let [w] = await g.get(['w'])
  let changes = String((w.watch as { changes?: string }).changes ?? '')
  seenAt.push([
    name,
    fired.length == 1,
    changes.split('\n')[0],
    (w.wake as { at: string }).at,
  ])
}

test('a watching wake fires only for a change, and says what changed', () => {
  let at = (h: number) => iso(T0 + h * HOUR)
  equal(seenAt, [
    ['nothing new', false, '', at(1)],
    ['a plant arrives', true, 'What changed (1 new):', at(2)],
    ['nothing new again', false, 'What changed (1 new):', at(3)],
    ['a plant changes', true, 'What changed (1 changed):', at(4)],
    ['a plant leaves', true, 'What changed (1 gone):', at(5)],
  ])
})

test('a host reads what a wake watches its own way', async () => {
  let h = woken(store())
  await h.apply([{
    entity: { eid: 'w' },
    wake: { at: iso(T0) },
    watch: { query: '.elsewhere' },
  }])
  let asked: string[] = []
  let { fired } = await tick(h, T0, {
    watching: (_, w) => (asked.push(w.query), [{ entity: { eid: 'far' } }]),
  })
  equal([asked, fired.length], [['.elsewhere'], 1])
})
