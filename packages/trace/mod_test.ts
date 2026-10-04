import { equal, ok, test, throws } from '@yaks/testing'
import {
  channel,
  context,
  during,
  link,
  parent,
  peek,
  record,
  scope,
  unlink,
} from './mod.ts'
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

test('record preserves synchronous results and captures beyond channel history', () => {
  let target = {}
  let captured = record(target, () => {
    let c = ok(peek(target))
    let root = ok(c.begin({ kind: 'bench', name: 'round' }))
    for (let i = 0; i < 300; i++) {
      c.begin({ kind: 'sql', name: 'book.select', parent: root.id })?.end({
        counts: { rows: i },
      })
    }
    c.instant({ kind: 'phase', name: 'done', parent: root.id })
    root.end()
    return 7
  })
  equal(captured.result, 7)
  equal(captured.spans.length, 302)
  equal(captured.spans[0].name, 'round')
  equal(captured.spans[300].counts, { rows: 299 })
  equal(captured.spans[301].stage, 'instant')
  ok(captured.spans.slice(0, -1).every((e) => e.duration! >= 0))
  equal(peek(target), undefined)
  equal(record(target, () => 0), { result: 0, spans: [] })
})

test('record leaves a concurrent subscriber and its history intact', async () => {
  let target = {}
  let c = channel(target)
  let seen: Event[] = []
  let stop = c.subscribe((e) => seen.push(e))
  try {
    c.instant({ kind: 'query', name: 'before' })
    let before = c.history()
    let wait = Promise.withResolvers<void>()
    let captured = record(target, () => {
      let own = c.begin({ kind: 'apply', name: 'own' })
      return wait.promise.then(() => {
        own?.end()
        return 9
      })
    })
    c.begin({ kind: 'apply', name: 'other' })?.end()
    wait.resolve()
    equal((await captured).spans.map((e) => e.name), ['own'])
    equal(c.history(), seen)
    equal(c.history().slice(0, before.length), before)
    ok(c.active)
    c.instant({ kind: 'query', name: 'after' })
    equal(c.history(), seen)
    equal(seen.map((e) => e.name), [
      'before',
      'own',
      'other',
      'other',
      'own',
      'after',
    ])
  } finally {
    stop()
  }
})

test('record owns its root before a subscriber reenters the channel', () => {
  let target = {}
  let c = channel(target)
  let stop = c.subscribe((e) => {
    if (e.name == 'own' && e.stage == 'start') {
      c.begin({ kind: 'apply', name: 'other' })?.end()
    }
  })
  try {
    let captured = record(target, () => {
      let root = c.begin({ kind: 'apply', name: 'own' })
      c.begin({ kind: 'phase', name: 'prepare', parent: root?.id })?.end()
      root?.end()
    })
    equal(captured.spans.map((e) => e.name), ['own', 'prepare'])
  } finally {
    stop()
  }
})

test('record disconnects on throws and rejections and restores nested calls', async () => {
  let target = {}
  let error = new Error('failure')
  let run = () => {
    let c = ok(peek(target))
    return during(c.begin({ kind: 'apply', name: 'apply' }), () => {
      throw error
    })
  }
  equal(await throws(() => record(target, run)), error)
  equal(peek(target), undefined)
  equal(
    await throws(() => record(target, () => Promise.reject(error))),
    error,
  )
  equal(peek(target), undefined)
  let outer = record(target, () =>
    record(target, () => {
      ok(peek(target)).begin({ kind: 'get', name: 'get' })?.end()
      return 3
    }))
  equal(outer.result.result, 3)
  equal(outer.spans, outer.result.spans)
  equal(peek(target), undefined)
})

test('synchronous scopes restore callers on returns, throws and awaits', async () => {
  let target = {}
  let c = channel(target)
  let stop = c.subscribe(() => {})
  try {
    let root = c.begin({ kind: 'apply', name: 'apply' })
    let pending = during(root, () => {
      let at = ok(context())
      equal(at.parent, root?.id)
      equal(peek(), c)
      during(undefined, () => equal(context(), at))
      throws(() =>
        scope(undefined, () => {
          throw new Error('failure')
        })
      )
      equal(context(), at)
      return Promise.resolve().then(() => {
        equal(context(), undefined)
        return scope(at, () => equal(context(), at))
      })
    })
    equal(context(), undefined)
    await pending
    equal(peek(), undefined)
  } finally {
    stop()
  }
})
