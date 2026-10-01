import { equal, ok, test, throws } from '@yaks/testing'
import { channel, during, link, parent, peek, unlink } from './mod.ts'
import type { Event } from './mod.ts'

test('trace is subscriber-owned, finite and preserves zero duration', () => {
  let graph = {}
  equal(peek(graph), undefined)
  let c = channel(graph)
  equal(c.begin({ kind: 'apply', name: 'apply' }), undefined)
  equal(c.history(), [])
  let records: Event[] = []
  let listener = (e: Event) => records.push(e)
  let first = c.subscribe(listener)
  let second = c.subscribe(listener)
  let span = ok(c.begin({ kind: 'apply', name: 'apply' }))
  span.end({ counts: { zero: 0, nan: NaN, infinite: Infinity } })
  span.end()
  equal(records.length, 4)
  equal(records[0].id, records[2].id)
  ok(Object.isFrozen(records[2]))
  equal(records[2].counts, { zero: 0 })
  ok(records[2].duration! >= 0)
  first()
  ok(peek(graph))
  second()
  equal(peek(graph), undefined)
  equal(c.history(0), [])
  equal(c.history(NaN), [])
})

test('trace ring bounds, stale spans and callback links do not cross recordings', () => {
  let graph = {}
  let c = channel(graph)
  let off = c.subscribe(() => {})
  let span = ok(c.begin({ kind: 'effect', name: 'send_receipt' }))
  let carrier = {}
  link(graph, carrier, span.id)
  equal(parent(graph, carrier), span.id)
  off()
  equal(span.active, false)
  off = c.subscribe(() => {})
  equal(parent(graph, carrier), undefined)
  link(graph, carrier, span.id)
  equal(parent(graph, carrier), undefined)
  let before = c.history().length
  span.end()
  equal(c.history().length, before)
  for (let i = 0; i < 300; i++) c.instant({ kind: 'query', name: 'read' })
  equal(c.history().length, 256)
  let fresh = ok(c.begin({ kind: 'effect', name: 'send_receipt' }))
  link(graph, carrier, fresh.id)
  equal(parent({}, carrier), undefined)
  equal(parent(graph, carrier), fresh.id)
  unlink(graph, carrier)
  equal(parent(graph, carrier), undefined)
  off()
})

test('during keeps synchronous answers and classifies async failures', async () => {
  let c = channel({})
  let off = c.subscribe(() => {})
  equal(during(c.begin({ kind: 'get', name: 'get' }), () => 0), 0)
  equal(
    await during(
      c.begin({ kind: 'query', name: 'read' }),
      () => Promise.resolve(2),
    ),
    2,
  )
  await throws(() =>
    during(c.begin({ kind: 'apply', name: 'apply' }), () => {
      throw Object.assign(new Error('private value'), { name: 'Refused' })
    })
  )
  equal(c.history().at(-1)?.outcome, 'refused')
  ok(!JSON.stringify(c.history()).includes('private value'))
  let span = c.begin({ kind: 'effect', name: 'send_receipt' })
  off()
  let counted = false
  equal(
    during(span, () => 4, 'ok', () => {
      counted = true
      return { rows: 4 }
    }),
    4,
  )
  equal(counted, false)
})
