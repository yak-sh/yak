// A host must hear about writer-claimed work as well as pending work, so its
// lifetime promise holds every handler after the writer's transaction ends.
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, test, throws } from '@yaks/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { effectDoc } from './pool.ts'
import { effects } from './registry.ts'

let vocab = loadVocab([pick(effectDoc, ['effect']), {
  $defs: {
    item: { component: true },
    take: { effect: true, created: ['item'] },
  },
}])
let host = (max = 2, refuse = false) => {
  let id = 0, nudges = 0, done = false
  let snapshots: number[][] = [], ran: string[] = [], held: Promise<void>[] = []
  let storage = ram(vocab), gate = Promise.withResolvers<void>()
  let first = Promise.withResolvers<void>()
  let attempts = () =>
    (storage.get(['run-1', 'run-2']) as Bundle[])
      .flatMap((b) => b.effect ? [(b.effect as Comp).attempts as number] : [])
  let fx = effects(vocab, {
    singleOwner: true,
    // This checks completion, not timer scheduling: the drain's zero-delay
    // turn is a microtask, and the host's lifetime promises are awaited.
    clock: {
      now: () => 0,
      after: (ms, run) => {
        equal(ms, 0)
        queueMicrotask(run)
        return () => {}
      },
    },
    max,
    mint: () => `run-${++id}`,
    write: (bs) => g.apply(bs, { trusted: true }),
    nudge: () => {
      nudges++
      snapshots.push(attempts())
      held.push(fx.work(g).then(() => void (done = true)))
    },
  })
  let g = graph({
    vocab,
    storage,
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
    take: (e) => {
      ran.push(e.entity.eid)
      first.resolve()
      return gate.promise
    },
  })
  let seed = [{ entity: { eid: 'a' }, item: {} }, {
    entity: { eid: 'b' },
    item: {},
  }]
  return {
    fx,
    g,
    seed,
    gate,
    first,
    held,
    facts: () => ({
      nudges,
      snapshots: snapshots.map((s) => [...s]),
      ran: [...ran],
      done,
      attempts: attempts(),
    }),
  }
}
// Joining the empty pool is fixture setup; the write must start its own runs.
let joined = async (max = 2, refuse = false) => {
  let h = host(max, refuse)
  await h.fx.work(h.g, undefined, 0)
  return h
}
let notified = async (
  h: ReturnType<typeof host>,
  mixed = false,
  deferred = false,
) => {
  let queued: (() => void | Promise<void>)[] = []
  await h.g.apply(mixed ? h.seed : h.seed.slice(0, 1), {
    ...(deferred ? { deferEffects: (run) => void queued.push(run) } : {}),
  })
  let before = h.facts()
  for (let run of queued) await run()
  await h.first.promise
  let during = h.facts()
  h.gate.resolve()
  await Promise.all(h.held)
  if (h.held.length && !h.facts().done) throw Error('host work never settled')
  return { during, after: h.facts(), ...(deferred ? { before } : {}) }
}
for (let mixed of [false, true]) {
  await notified(await joined(mixed ? 1 : 2), mixed)
  let h = await joined(mixed ? 1 : 2)
  test(`a host holds committed writer claims until completion and hears once (${mixed})`, async () => {
    equal(await notified(h, mixed), {
      during: {
        nudges: 1,
        snapshots: [mixed ? [1, 0] : [1]],
        ran: ['a'],
        done: false,
        attempts: mixed ? [1, 0] : [1],
      },
      after: {
        nudges: 1,
        snapshots: [mixed ? [1, 0] : [1]],
        ran: mixed ? ['a', 'b'] : ['a'],
        done: true,
        attempts: [],
      },
    })
  })
}
let refused = await joined(2, true)
test('a rolled-back claim invokes no handler and sends no lifetime notification', async () => {
  await throws(() => refused.g.apply(refused.seed), 'refused')
  equal(refused.facts(), {
    nudges: 0,
    snapshots: [],
    ran: [],
    done: false,
    attempts: [],
  })
})

await notified(await joined(), false, true)
let deferred = await joined()
test('an enclosing transaction notifies and starts claims only when it releases observers', async () => {
  equal(await notified(deferred, false, true), {
    before: { nudges: 0, snapshots: [], ran: [], done: false, attempts: [1] },
    during: {
      nudges: 1,
      snapshots: [[1]],
      ran: ['a'],
      done: false,
      attempts: [1],
    },
    after: {
      nudges: 1,
      snapshots: [[1]],
      ran: ['a'],
      done: true,
      attempts: [],
    },
  })
})
let rolledBack = await joined()
test('discarding observers after an outer rollback starts and notifies nothing', async () => {
  let queued: (() => void | Promise<void>)[] = []
  await throws(() =>
    rolledBack.g.storage.tx(() => {
      rolledBack.g.apply(rolledBack.seed, {
        deferEffects: (run) => void queued.push(run),
      })
      throw Error('outer rollback')
    }), 'outer rollback')
  queued.length = 0
  equal(rolledBack.facts(), {
    nudges: 0,
    snapshots: [],
    ran: [],
    done: false,
    attempts: [],
  })
})
