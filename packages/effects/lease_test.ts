// The duty, and the contest for it.

import { assert, assertEquals } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { blogGraph, pooledBlog } from './testing.ts'
import { drop, held, holding, LEASE, leaseEid, take, until } from './lease.ts'

let g = () => blogGraph([], pooledBlog)

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
  // The row stays — what the duty is outlives who was doing it.
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

// Doing a duty: the same call for a process that stays and one passing
// through, and the only difference is what its signal already says.

Deno.test('a signal already aborted is one pass, and the duty is handed back', async () => {
  let graph = g()
  let passes = 0
  await holding(graph, 'sweep', { holder: 'p1' }, () => void passes++)
  assertEquals(passes, 1)
  assertEquals((await held(graph, 'sweep'))?.holder, null)
})

Deno.test('a line passing through leaves a duty somebody is already doing', async () => {
  let graph = g()
  await take(graph, 'sweep', { holder: 'p1', hold: 10_000 })
  let passes = 0
  await holding(graph, 'sweep', { holder: 'p2' }, () => void passes++)
  assertEquals(passes, 0)
  assertEquals((await held(graph, 'sweep'))?.holder, 'p1')
})

Deno.test('a process that stays holds the duty until it goes', async () => {
  let graph = g()
  let stop = new AbortController()
  let holder: string | null = null
  let running = holding(
    graph,
    'clock',
    { holder: 'p1', signal: stop.signal },
    (signal) => until(signal),
  )
  for (let i = 0; i < 200 && !holder; i++) {
    holder = (await held(graph, 'clock'))?.holder ?? null
    if (!holder) await new Promise((go) => setTimeout(go, 5))
  }
  assertEquals(holder, 'p1')
  stop.abort()
  await running
  assertEquals((await held(graph, 'clock'))?.holder, null)
})

Deno.test('a second process waits, and takes over when the first lapses', async () => {
  let graph = g()
  // A holder that was killed: it never renews and never lets go.
  await take(graph, 'clock', { holder: 'gone', hold: 30 })
  let stop = new AbortController()
  let took = false
  let running = holding(
    graph,
    'clock',
    { holder: 'p2', hold: 500, poll: 5, signal: stop.signal },
    (signal) => {
      took = true
      return until(signal)
    },
  )
  for (let i = 0; i < 200 && !took; i++) {
    await new Promise((go) => setTimeout(go, 5))
  }
  assert(took, 'nobody took over a lease that lapsed')
  assertEquals((await held(graph, 'clock'))?.holder, 'p2')
  stop.abort()
  await running
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
