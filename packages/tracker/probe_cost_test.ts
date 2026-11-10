import { equal, ok, test } from '@yaks/testing'
import { storage } from '@yaks/sqlite'
import { stepping } from '../sqlite/testing.ts'
import { vocab } from './fixture_test.ts'

let meter = stepping(), store = storage(meter.driver, vocab)
store.install()
store.tx((tx) =>
  tx.patch([
    ...Array.from({ length: 1024 }, (_, i) => ({
      entity: { eid: `recent${i}` },
      probe: { grouped: '2026-11-10T12:00:00.000Z' },
    })),
    {
      entity: { eid: 'spent' },
      probe: { grouped: '2026-11-09T12:00:00.000Z' },
    },
    { entity: { eid: 'bare' } },
  ])
)
let q = '.probe.grouped<2026-11-10T10:00:00.000Z .fields=probe.grouped'
store.rows(q)
test('probe expiry seeks old receipts without reading newer probes', () => {
  let start = meter.steps()
  equal(store.rows(q), [{
    eid: 'spent',
    'probe.grouped': '2026-11-09T12:00:00.000Z',
  }])
  let steps = meter.steps() - start
  ok(steps < 500, `${steps} VM steps`)
})
