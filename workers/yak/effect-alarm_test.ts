// Recovered pending work runs in bounded, separate alarm events without a
// polling delay. A future retry remains scheduled rather than running early.
import { equal, test } from '@yaks/testing'
import { due } from './graph.ts'
import { appStore, storeName } from './directory.ts'
import { ADA_OWNS, platform, seeded } from './serving-probe.ts'

let p = platform()
let { space, app } = await seeded(p.env)
await p.settled()
let store = appStore(p.env.STORE, space, app)
let object = p.object(storeName(space, app))
let alarm = object.alarm.bind(object), events = 0
object.alarm = () => {
  events++
  return alarm()
}
// Restore a backlog whose original targets are gone. Each effect must still
// be settled; a bounded admission leaves some for the next event.
let rows = Array.from({ length: 5 }, () => ({
  entity: { eid: crypto.randomUUID() },
  effect: {
    handler: 'register_writes',
    target: crypto.randomUUID(),
    kind: 'created',
    comp: 'doc',
    state: 'pending',
    attempts: 0,
  },
}))
await store('/apply', {
  method: 'POST',
  body: JSON.stringify(rows),
}, { ...ADA_OWNS, 'x-yak-kernel': '1' })
await p.settled()
let pending =
  await (await store('/query?q=.effect.state=pending', {}, ADA_OWNS))
    .json()

test('a recovered backlog completes across fresh alarm batches without advancing time', () => {
  equal(pending, [])
  equal(events >= 3, true)
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
