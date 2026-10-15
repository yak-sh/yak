// Healthy probes resolve outstanding faults once and leave settled history alone.
import type { Bundle } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { equal, test } from '@yaks/testing'
import { options, store, vocab } from './core.ts'
import { monitor } from './monitor.ts'

let now = Date.parse('2026-10-10T00:00:00Z')
let uptime = 'tracker|platform-uptime', heartbeat = 'tracker|box-heartbeat'
let fixture = async () => {
  let storage = ram(vocab, options)
  let tracker = store(storage, { sink: () => {} })
  await tracker.graph.apply([
    ...[uptime, heartbeat].flatMap((fault) =>
      ['open', 'resolved', 'archived'].map((state) => ({
        entity: { eid: `${fault}|${state}` },
        bug: { fault },
        ...state == 'open'
          ? {}
          : { [state]: state == 'resolved' ? { cause: 'c', recur: 'r' } : {} },
      }))
    ),
    { entity: { eid: 'unrelated' }, bug: { fault: 'other' } },
  ], { trusted: true })
  let writes: Bundle[] = [], selected: Bundle[] = []
  let read = tracker.graph.read
  tracker.mark = (eid, name, said) => {
    let patch = { entity: { eid }, [name]: { ...said } }
    writes.push(patch)
    storage.tx((tx) => tx.patch([patch]))
    return Promise.resolve()
  }
  tracker.graph.read = async (...args) => {
    let rows = await read(...args)
    selected.push(...rows)
    return rows
  }
  return { tracker, storage, writes, selected }
}
let healthy =
  (() => Promise.resolve(new Response(null, { status: 405 }))) as typeof fetch
let recovered = await fixture()
await monitor(recovered.tracker, now, healthy, now)
let recovering = await fixture()

test('healthy monitor after recovery reads no historical bugs and writes nothing', async () => {
  recovered.writes.length = 0
  recovered.selected.length = 0
  await monitor(recovered.tracker, now, healthy, now)
  equal(recovered.writes, [])
  equal(recovered.selected, [])
})

test('monitor recovery resolves only open faults and selects their identities', async () => {
  recovering.storage.tx((tx) =>
    tx.patch(
      [uptime, heartbeat].map((fault) => ({
        entity: { eid: `${fault}|open` },
        resolved: null,
      })),
    )
  )
  recovering.writes.length = 0
  recovering.selected.length = 0
  await monitor(recovering.tracker, now, healthy, now)
  equal(
    recovering.writes.map((b) => b.entity.eid).sort(),
    [uptime, heartbeat].map((fault) => `${fault}|open`).sort(),
  )
  equal(recovering.selected.length, 2)
  equal(recovering.selected.map((b) => Object.keys(b)), [['entity'], [
    'entity',
  ]])
})
