// Recovered pending work runs in bounded, separate alarm events without a
// polling delay. A future retry remains scheduled rather than running early.
import { clock, equal, ok, test } from '@yaks/testing'
import { due, Store } from './graph.ts'
import { ADA_OWNS } from './serving-probe.ts'
import { platform, state } from './testing.ts'

let time = clock(Date.now())
let p = platform('effect-alarm', { CLOCK: time })
let name = 'ada/cookbook', ctx = state()
let store = p.register(
  name,
  ctx,
  () => new Store(ctx, {}, undefined, { now: time.now }),
)
let headers = {
  ...ADA_OWNS,
  'x-store': name,
  'x-yak-app': crypto.randomUUID(),
}
// Restore more runs than fit in the pool's default page of 32. Their
// original targets are gone, but each run still has to be settled.
let rows = Array.from({ length: 33 }, () => ({
  entity: { eid: crypto.randomUUID() },
  effect: {
    handler: 'delete_upload',
    target: crypto.randomUUID(),
    kind: 'removed',
    comp: 'blob',
    state: 'pending',
    attempts: 0,
  },
}))
let wrote = await store.fetch(
  new Request('http://store/apply', {
    method: 'POST',
    headers: { ...headers, 'x-yak-kernel': '1' },
    body: JSON.stringify(rows),
  }),
)
let unsettled = async () =>
  await (await store.fetch(
    new Request('http://store/query?q=.effect.handler=delete_upload', {
      headers,
    }),
  )).json()

await Promise.all(ctx.pending)
let queued = (await unsettled()).length
await p.ring()
await Promise.all(ctx.pending)
let remaining = (await unsettled()).length
await p.settled()
let drained = await unsettled()

test('a recovered backlog completes across fresh alarm batches without advancing time', () => {
  equal(wrote.status, 200)
  equal(queued, rows.length)
  ok(remaining < queued, 'the first alarm makes progress')
  ok(remaining > 0, 'the first alarm leaves work for the next alarm')
  equal(drained, [])
})

test('alarm selection preserves future retries and makes overdue work immediately ready', () => {
  let run = (next?: number) => ({
    entity: { eid: crypto.randomUUID() },
    effect: next == null ? {} : { next: new Date(next).toISOString() },
  })
  equal(due([], 100), null)
  equal(due([run(400), run(200)], 100), 200)
  equal(due([run(50)], 100), 100)
  equal(due([run(400), run()], 100), 100)
})
