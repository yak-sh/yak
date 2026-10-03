/** Composition activity is observable before a graph exists, without changing
 * the host's success, refusal, or idle behavior. */
import { equal, ok, test, throws } from '@yaks/testing'
import { channel, type Event, peek } from '@yaks/trace'
import { compose, type Config } from './host.ts'

let config = (): Config => ({ db: ':memory:', plugins: [] })

test('composition records a complete process-start tree on its config channel', async () => {
  let c = config()
  let events: Event[] = []
  let off = channel(c).subscribe((e) => events.push(e))
  let host = await compose(c, ['graph'])
  try {
    let root = ok(
      events.find((e) => e.kind == 'process-start' && e.stage == 'start'),
    )
    let end = ok(events.find((e) => e.id == root.id && e.stage == 'end'))
    equal(end.outcome, 'ok')
    ok((end.duration ?? -1) >= 0)
    let parts = events.filter((e) => e.parent == root.id && e.stage == 'start')
    ok(parts.length > 1)
    for (let part of parts) {
      equal(part.kind, 'phase')
      equal(events.filter((e) => e.id == part.id && e.stage == 'end').length, 1)
    }
    ok(!JSON.stringify(events).includes(':memory:'))
    equal(await host.graph.read(''), [])
  } finally {
    off()
    await host.close()
  }
})

test('composition failure closes its root and active part without error text', async () => {
  let c = config()
  let events: Event[] = []
  let off = channel(c).subscribe((e) => events.push(e))
  try {
    await throws(() => compose(c, ['not-a-role']))
    let root = ok(
      events.find((e) => e.kind == 'process-start' && e.stage == 'end'),
    )
    equal(root.outcome, 'error')
    equal(
      events.filter((e) => e.stage == 'start').length,
      events.filter((e) => e.stage == 'end').length,
    )
    ok(!JSON.stringify(events).includes('not-a-role'))
  } finally {
    off()
  }
})

test('unsubscribed composition leaves its channel uncreated or idle', async () => {
  let c = config()
  equal(peek(c), undefined)
  let host = await compose(c, ['graph'])
  await host.close()
  equal(peek(c), undefined)
  let idle = channel(c)
  host = await compose(c, ['graph'])
  await host.close()
  equal(idle.history(), [])
})
