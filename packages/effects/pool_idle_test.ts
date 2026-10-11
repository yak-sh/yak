import { type Access, type Bundle, dead, detached, guard } from '@yaks/graph'
import { after } from '@yaks/fp'
import { matcher } from '@yaks/match'
import { equal, test } from '@yaks/testing'
import { loadVocab, pick } from '@yaks/vocab'
import { memory } from '../graph/testing.ts'
import { effectDoc, pool } from './pool.ts'
import { effects } from './registry.ts'

let vocab = loadVocab([pick(effectDoc, ['effect']), {
  $defs: { alpha: { effect: true, start: true } },
}])
let plans = new Map<string, ReturnType<typeof matcher>>()

let waiting = async (boundary: 'discovery' | 'claim') => {
  let storage = memory(), fx = effects(vocab)
  storage.tx((tx) =>
    tx.patch([{
      entity: { eid: 'run' },
      effect: {
        handler: 'alpha',
        target: 'run',
        kind: 'started',
        state: 'pending',
        attempts: 0,
      },
    }])
  )
  let reached = Promise.withResolvers<void>()
  let admitted = Promise.withResolvers<void>()
  let began = Promise.withResolvers<void>()
  let finished = Promise.withResolvers<void>()
  let errors: unknown[] = []
  let g: Access = {
    vocab,
    outside: detached(storage),
    get: storage.get,
    read: async (query, opts) => {
      if (boundary == 'discovery') {
        reached.resolve()
        await admitted.promise
      }
      let key = JSON.stringify([query, opts]), plan = plans.get(key)
      if (!plan) plans.set(key, plan = matcher(query, vocab, opts))
      return plan(await storage.get(['run']))
    },
    rows: () => [{ eid: 'run' }],
    apply: async (bundles) => {
      if (boundary == 'claim' && bundles.some((b) => b.$was && !dead(b))) {
        reached.resolve()
        await admitted.promise
      }
      return storage.tx((tx) =>
        after(guard(bundles, tx, vocab), (ready) => {
          tx.remove(ready.filter(dead).map((b) => b.entity))
          tx.patch(ready.filter((b) => !dead(b)))
          return ready
        })
      )
    },
  }
  let p = pool({
    slots: fx.slots,
    writer: () => (bundles) => g.apply(bundles),
    report: (error) => void errors.push(error),
  }, { singleOwner: true, startup: 'manual', max: 1 })
  fx.handle({
    alpha: async () => {
      began.resolve()
      await finished.promise
    },
  })
  let work = p.work(g, undefined, 1)
  await reached.promise
  let settled = false
  let idle = p.idle().then(() => settled = true)
  for (let n = 0; n < 10; n++) await Promise.resolve()
  equal(settled, false)
  admitted.resolve()
  await began.promise
  for (let n = 0; n < 10; n++) await Promise.resolve()
  equal(settled, false)
  finished.resolve()
  await idle
  await work
  equal(p.running(), [])
  equal(dead((await storage.get(['run']))[0] as Bundle), true)
  equal(errors, [])
}

for (let boundary of ['discovery', 'claim'] as const) {
  test(`idle waits for ${boundary} and the handler it admits`, () =>
    waiting(boundary))
}
