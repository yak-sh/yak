// The duty, and the contest for it.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { until as soon } from '../../bin/testing.ts'
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

// Another process's take, written the way it lands: the row names it, with an
// expiry this process cannot argue with.
let seize = (graph: Graph, name: string, holder: string, until: number) =>
  graph.apply([{
    entity: { eid: leaseEid(name) },
    [LEASE]: { name, holder, until: new Date(until).toISOString() },
  } as Bundle])

Deno.test('a lease lost mid-work stops the work, and the loser waits to take it back', async () => {
  let graph = g()
  let stop = new AbortController()
  let runs: AbortSignal[] = []
  let running = holding(
    graph,
    'clock',
    { holder: 'p1', hold: 60, poll: 5, signal: stop.signal },
    (signal) => {
      runs.push(signal)
      return until(signal)
    },
  )
  await soon(() => runs.length == 1)
  // Another process has it now: p1 lapsed while it was busy, say.
  await seize(graph, 'clock', 'p2', Date.now() + 60_000)
  await soon(() => runs[0].aborted, { label: 'the work to stop' })
  assertEquals(stop.signal.aborted, false)
  // Not p1's to release: p2 keeps it.
  assertEquals((await held(graph, 'clock'))?.holder, 'p2')
  // And when p2's take lapses, p1 is still there to have it back.
  await seize(graph, 'clock', 'p2', 0)
  await soon(() => runs.length == 2, { label: 'the work to run again' })
  assertEquals((await held(graph, 'clock'))?.holder, 'p1')
  stop.abort()
  await running
  assertEquals((await held(graph, 'clock'))?.holder, null)
})

Deno.test('a take the store fails is asked again, and the duty is not given up', async () => {
  let base = g()
  let fails = 1
  let flaky: Graph = {
    ...base,
    apply: (bundles, opts) => {
      if (fails-- > 0) throw new Error('database is locked')
      return base.apply(bundles, opts)
    },
  }
  let told: unknown[] = []
  let stop = new AbortController()
  let took = false
  let running = holding(
    flaky,
    'clock',
    {
      holder: 'p1',
      poll: 5,
      signal: stop.signal,
      report: (e) => void told.push(e),
    },
    (signal) => {
      took = true
      return until(signal)
    },
  )
  await soon(() => took, { label: 'the duty to be taken' })
  assertEquals(told.length, 1)
  stop.abort()
  await running
})
