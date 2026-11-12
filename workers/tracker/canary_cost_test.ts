import { equal, ok, test } from '@yaks/testing'
import { storage } from '@yaks/sqlite'
import { stepping } from '../../packages/sqlite/testing.ts'
import { capture } from '@yaks/tracker/report'
import type { Bundle } from '@yaks/graph'
import { options, store, vocab } from './core.ts'
import { canary } from './deploy.ts'
import { json } from './door.ts'
import { type Stub, worker } from './worker.ts'

// A deploy's publication, queue delivery and confirmation over the tracker
// graph. Reading when grouping is due must leave room for intake even behind
// the backlog that delayed the 2026-11-12 deploy's canary past ten minutes.
let confirming = async (reports: number) => {
  let meter = stepping(), saved = storage(meter.driver, vocab, options)
  saved.install()
  let tracker = store(saved, { sink: () => {} })
  for (let i = 0; i < reports; i++) {
    await tracker.ingest(capture(Error(`fault ${i}`), { sink: () => {} }))
  }
  let hash = 'c'.repeat(64), queued: Bundle[][] = []
  let stub = {
    fetch: async (request: Request) => {
      let url = new URL(request.url)
      return url.pathname == '/bundle'
        ? json({ hash })
        : json(await tracker.graph.read(url.searchParams.get('q')!))
    },
    ingest: tracker.ingest,
  } as Stub
  let w = worker({
    BUNDLE_HASH: hash,
    TRACKER_SECRET: 'scratch',
    ERRORS: { send: (rows) => Promise.resolve(void queued.push(rows)) },
    TRACKERS: { getByName: () => stub },
  })
  let probe = canary(
    'https://tracker.test',
    hash,
    (input, init) => w.fetch(new Request(input, init)),
    () => new AbortController().signal,
  )
  let arrived = [await probe.arrived()], acknowledged = false
  await w.queue([{
    body: queued[0],
    ack: () => void (acknowledged = true),
    retry: () => {},
  }])
  let start = meter.steps(), due = await tracker.next(0)
  arrived.push(await probe.arrived())
  let reads = meter.steps() - start
  // One bounded pass can leave earlier reports ahead of the probe.
  for (let i = 0; i < Math.ceil((reports + 1) / 32); i++) await tracker.drain()
  arrived.push(await probe.arrived())
  return { arrived, acknowledged, due, reads }
}
let [few, many] = [await confirming(2), await confirming(200)]

test('a queued deploy canary confirms without reading the grouping backlog', () => {
  for (let result of [few, many]) {
    equal(result.arrived, [false, false, true])
    equal(result.acknowledged, true)
    equal(result.due, 1000)
  }
  ok(many.reads <= few.reads * 1.5, `${few.reads} then ${many.reads} VM steps`)
})
