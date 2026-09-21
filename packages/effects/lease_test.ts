// The duty, and the contest for it.

import { assert, assertEquals } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { blogGraph, durableBlog } from './harness.ts'
import { drop, held, LEASE, leaseEid, take } from './lease.ts'

let g = () => blogGraph([], durableBlog)

// A clock the test moves by hand, so nothing waits.
let at = (ms: number) => () => ms

Deno.test('a duty is one row, whoever asks for it', () => {
  assertEquals(leaseEid('@yaks/wake'), leaseEid('@yaks/wake'))
  assert(leaseEid('@yaks/wake') != leaseEid('@yaks/spawn'))
})

Deno.test('the first process to ask gets it, and the second is told no', async () => {
  let graph = g()
  assertEquals(await take(graph, 'sweep', { holder: 'p1', now: at(0) }), true)
  assertEquals(await take(graph, 'sweep', { holder: 'p2', now: at(0) }), false)
  let row = await held(graph, 'sweep')
  assertEquals(row?.holder, 'p1')
  assertEquals(row?.name, 'sweep')
})

Deno.test('the holder renews its own, and a rival has to wait out the lapse', async () => {
  let graph = g()
  await take(graph, 'sweep', { holder: 'p1', hold: 100, now: at(0) })
  // Its own again is a renewal, whatever the clock says.
  assertEquals(
    await take(graph, 'sweep', { holder: 'p1', hold: 100, now: at(50) }),
    true,
  )
  assertEquals((await held(graph, 'sweep'))?.until, new Date(150).toISOString())
  // Still held at 120 because the renewal pushed it out…
  assertEquals(
    await take(graph, 'sweep', { holder: 'p2', hold: 100, now: at(120) }),
    false,
  )
  // …and free once it lapses, with nobody reaping anything.
  assertEquals(
    await take(graph, 'sweep', { holder: 'p2', hold: 100, now: at(200) }),
    true,
  )
})

Deno.test('letting go hands it over without waiting, and only the holder may', async () => {
  let graph = g()
  await take(graph, 'sweep', { holder: 'p1', hold: 1000, now: at(0) })
  // Not ours to give up: the row is untouched.
  await drop(graph, 'sweep', { holder: 'p2' })
  assertEquals((await held(graph, 'sweep'))?.holder, 'p1')
  await drop(graph, 'sweep', { holder: 'p1' })
  assertEquals((await held(graph, 'sweep'))?.holder, null)
  // The row stays — what the duty IS outlives who was doing it.
  assertEquals((await held(graph, 'sweep'))?.name, 'sweep')
  assertEquals(
    await take(graph, 'sweep', { holder: 'p2', now: at(1) }),
    true,
  )
})

Deno.test('a graph with no lease word has nobody to contend with', async () => {
  let graph = blogGraph()
  assertEquals(graph.vocab.comp(LEASE), undefined)
  assertEquals(await take(graph, 'sweep', { holder: 'p1' }), true)
  assertEquals(await take(graph, 'sweep', { holder: 'p2' }), true)
  assertEquals(await held(graph, 'sweep'), undefined)
})

Deno.test('the take is a precondition, so two askers at one instant cannot both win', async () => {
  let graph = g()
  // Both read the same free row, then both write. The second carries a `$was`
  // naming a holder that has moved, and is refused inside the transaction.
  let both = await Promise.all([
    take(graph, 'sweep', { holder: 'p1', now: at(0) }),
    take(graph, 'sweep', { holder: 'p2', now: at(0) }),
  ])
  assertEquals(both.filter(Boolean).length, 1)
  let row = (await graph.read(`.${LEASE}`))[0][LEASE] as Comp
  assert(row.holder == 'p1' || row.holder == 'p2', String(row.holder))
})
