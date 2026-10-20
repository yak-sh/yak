// Committed work must reach a sleeping worker without its polling timer.
import { graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, test, throws } from '@yaks/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { stub } from '@std/testing/mock'
import { CAP, effectDoc, type PoolOpts } from './pool.ts'
import { effects } from './registry.ts'

let vocab = loadVocab([pick(effectDoc, ['effect']), {
  $defs: {
    item: { component: true },
    take: { effect: true, created: ['item'] },
  },
}])
let fixture = (
  refuse = false,
  o: { storage?: Storage; watch?: PoolOpts['watch'] } = {},
) => {
  let ran = Promise.withResolvers<void>(), count = 0
  let fx = effects(vocab, {
    singleOwner: true,
    defer: true,
    now: () => 0,
    write: (bs) => g.apply(bs, { trusted: true }),
    watch: o.watch,
  })
  let g = graph({
    vocab,
    storage: o.storage ?? ram(vocab),
    plugins: [
      fx,
      ...(refuse
        ? [{
          name: 'refuse',
          hooks: {
            commit: () => {
              throw Error('refused')
            },
          },
        }]
        : []),
    ],
  })
  fx.handle({
    take: () => {
      count++
      ran.resolve()
    },
  })
  return { fx, g, ran, count: () => count }
}
let seed = [{ entity: { eid: 'a' }, item: {} }]
type Fixture = ReturnType<typeof fixture>
// Work the pool until its first nap, then `act`, told how many times that nap
// was cut short. The polling timer never fires: only a wake ends the nap.
let napping = async <T>(
  h: Fixture,
  act: (cleared: () => number) => Promise<T>,
): Promise<T> => {
  let asleep = Promise.withResolvers<void>(), cleared = 0
  using _timer = stub(globalThis, 'setTimeout', (run, ms) => {
    if (ms === 0) queueMicrotask(run as () => void)
    else {
      equal(ms, CAP)
      asleep.resolve()
    }
    return (ms === CAP ? 1 : 0) as unknown as ReturnType<typeof setTimeout>
  })
  using _clear = stub(globalThis, 'clearTimeout', (id) => {
    if (Number(id) === 1) cleared++
  })
  let stop = new AbortController(), loop = h.fx.work(h.g, stop.signal)
  try {
    await asleep.promise
    return await act(() => cleared)
  } finally {
    stop.abort()
    await loop
    await h.fx.stop()
  }
}
let committed = (h: Fixture, deferred: boolean) =>
  napping(h, async (cleared) => {
    let observers: (() => void | Promise<void>)[] = []
    await h.g.apply(
      seed,
      deferred ? { deferEffects: (run) => void observers.push(run) } : {},
    )
    if (deferred) {
      equal(cleared(), 0)
      equal(h.count(), 0)
      for (let run of observers) await run()
    }
    let interrupted = cleared()
    // Fail before awaiting a handler when the wake is broken: the fake clock
    // deliberately never releases the worker's polling nap.
    equal(interrupted, 1, 'the commit must interrupt the polling nap')
    await h.ran.promise
    return { interrupted, count: h.count() }
  })
for (let deferred of [false, true]) {
  let warm = fixture()
  await warm.fx.work(warm.g, undefined, 0)
  await committed(warm, deferred)
  let h = fixture()
  await h.fx.work(h.g, undefined, 0)
  let outcome = await committed(h, deferred)
  test(`a committed effect wakes the sleeping local worker (deferred observers: ${deferred})`, () => {
    equal(outcome, { interrupted: 1, count: 1 })
  })
}

// Another process's commit passes no observer here; the store hears it land.
let storage = ram(vocab), hear = () => {}
let heard = fixture(false, {
  storage,
  watch: (heard) => {
    hear = heard
    return () => {}
  },
})
let elsewhere = graph({
  vocab,
  storage,
  plugins: [effects(vocab, { owes: 'declared' })],
})
await heard.fx.work(heard.g, undefined, 0)
let fromElsewhere = await napping(heard, async (cleared) => {
  await elsewhere.apply(seed)
  let before = cleared()
  hear()
  equal(cleared(), 1, 'hearing the run must interrupt the polling nap')
  await heard.ran.promise
  return { before, count: heard.count() }
})
test('a run another process commits wakes the worker that hears it', () => {
  equal(fromElsewhere, { before: 0, count: 1 })
})

let refused = fixture(true)
await refused.fx.work(refused.g, undefined, 0)
test('a refused transaction leaves the local worker asleep', () =>
  napping(refused, async (cleared) => {
    await throws(() => refused.g.apply(seed), 'refused')
    equal(cleared(), 0)
    equal(refused.count(), 0)
  }))
