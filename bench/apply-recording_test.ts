/** Timing bench consumption keeps every completed span beyond channel history
 * capacity and samples a whole root tree before disconnecting. */
import { equal, ok, test } from '@yaks/testing'
import { channel, during } from '@yaks/trace'
import { applyRecording } from './apply-recording.ts'

test('apply recording summarizes all spans and samples one ordinary tree', () => {
  let target = {}
  let c = channel(target)
  let recorder = applyRecording([target])
  for (let i = 0; i < 2; i++) {
    let root = c.begin({ kind: 'apply', name: 'apply' })!
    during(root, () => {
      for (let j = 0; j < 300; j++) {
        during(
          c.begin({
            kind: 'sql',
            name: 'doc select',
            parent: root.id,
          }),
          () => {},
        )
      }
    })
  }
  let { rows, traces } = recorder.finish()
  recorder.stop()
  equal(rows.find((r) => r.timing.op == 'apply')?.timing.n, 2)
  equal(rows.find((r) => r.timing.op == 'sql')?.timing.n, 600)
  // Slow roots can add traces, but the first ordinary tree is always retained.
  ok(traces.length >= 1)
  equal(traces[0].spans.length, 301)
  equal(traces[0].spans[0].kind, 'apply')
  equal(c.active, false)
})

test('recording shares one ordinary quota across channel-local IDs', () => {
  let targets = [{}, {}]
  let recorder = applyRecording(targets)
  for (let target of targets) {
    channel(target).instant({ kind: 'apply', name: 'apply' })
  }
  let { rows, traces } = recorder.finish()
  recorder.stop()
  equal(rows[0].timing.n, 2)
  equal(traces.length, 1)
})
