import { equal, test } from '@yaks/testing'
import { channel } from '@yaks/trace'
import { collector } from './box-lib.ts'

test('box trace samples keep each span CPU interval across nested work', () => {
  let cpu = 0
  let events = collector(() => {
    let start = cpu
    return () => ({ value: 0, cpu: cpu - start })
  })
  let trace = channel({})
  let stop = trace.subscribe(events.add)
  let outer = trace.begin({ kind: 'phase', name: 'outer' })!
  cpu += 3
  let inner = trace.begin({ kind: 'phase', name: 'inner', parent: outer.id })!
  cpu += 7
  inner.end()
  cpu += 2
  outer.end()
  stop()
  equal(events.take().map(({ name, cpu }) => ({ name, cpu })), [
    { name: 'outer', cpu: 12 },
    { name: 'inner', cpu: 7 },
  ])
  equal(events.take(), [])
})
