import { AsyncLocalStorage } from 'node:async_hooks'
import { equal, ok, test, throws } from '@yaks/testing'
import {
  channel,
  context,
  during,
  installContext,
  link,
  measure,
  parent,
  peek,
  record,
  scope,
  shareChannel,
  unlink,
} from './mod.ts'
import type { Context, Event } from './mod.ts'

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

test('async carrier keeps interleaved requests and inclusive metrics separate', async () => {
  let carrier = new AsyncLocalStorage<Context | undefined>()
  let restore = installContext({
    get: () => carrier.getStore(),
    run: (ctx, run) => carrier.run(ctx, run),
  })
  let target = {}
  let gate = Promise.withResolvers<void>()
  let entered = Promise.withResolvers<void>()
  let run = (name: string, n: number, wait?: Promise<void>) =>
    record(target, () => {
      let c = ok(peek(target))
      return during(c.begin({ kind: 'request', name }), async () => {
        if (wait) {
          entered.resolve()
          await wait
        }
        await Promise.resolve()
        let root = ok(context()).parent
        return during(c.begin({ kind: 'phase', name: 'work' }), async () => {
          await Promise.resolve()
          during(c.begin({ kind: 'sql', name: 'book select' }), () => {
            measure({ rowsRead: n, rowsWritten: 0, statements: 1 })
          })
          during(c.begin({ kind: 'sql', name: 'book insert' }), () => {
            measure({ rowsRead: 0, rowsWritten: n + 1, statements: 1 })
          })
          equal(context(root)?.parent, context()?.parent)
          return name
        })
      })
    })
  try {
    let first = run('first', 3, gate.promise)
    await entered.promise
    let second = await run('second', 7)
    gate.resolve()
    let captured = await first
    for (let [out, n] of [[captured, 3], [second, 7]] as const) {
      equal(out.spans.map((e) => e.name), [
        out.result,
        'work',
        'book select',
        'book insert',
      ])
      equal(out.spans[1].parent, out.spans[0].id)
      equal(out.spans[2].parent, out.spans[1].id)
      equal(out.spans[3].parent, out.spans[1].id)
      equal(out.spans[0].counts, {
        rowsRead: n,
        rowsWritten: n + 1,
        statements: 2,
      })
      equal(out.spans[1].counts, out.spans[0].counts)
      equal(out.spans[2].counts, { rowsRead: n, rowsWritten: 0, statements: 1 })
      equal(out.spans[3].counts, {
        rowsRead: 0,
        rowsWritten: n + 1,
        statements: 1,
      })
    }
    equal(context(), undefined)
    equal(peek(target), undefined)
  } finally {
    gate.resolve()
    restore()
  }
})

test('shared channel keeps replacements in one trace, never another graph', () => {
  let host = {}
  let first = {}
  let replacement = {}
  let other = {}
  shareChannel(first, host)
  shareChannel(replacement, host)
  let otherStop = channel(other).subscribe(() => {})
  try {
    let captured = record(host, () => {
      let c = ok(peek(host))
      return during(c.begin({ kind: 'request', name: 'request' }), () => {
        during(
          ok(peek(first)).begin({ kind: 'get', name: 'first' }),
          () => measure({ statements: 1 }),
        )
        during(
          ok(peek(replacement)).begin({ kind: 'get', name: 'replacement' }),
          () => measure({ statements: 2 }),
        )
        during(
          ok(peek(other)).begin({ kind: 'get', name: 'other' }),
          () => measure({ statements: 9 }),
        )
      })
    })
    equal(captured.spans.map((e) => e.name), [
      'request',
      'first',
      'replacement',
    ])
    equal(captured.spans[0].counts, { statements: 3 })
    equal(channel(other).history().at(-1)?.parent, undefined)
    equal(channel(other).history().at(-1)?.counts, { statements: 9 })
    equal(peek(first), undefined)
  } finally {
    otherStop()
  }
})

test('record explicitly links its root while keeping the complete nested tree', () => {
  let target = {}
  let nested: ReturnType<typeof record<unknown>> | undefined
  let captured = record(target, () => {
    let c = ok(peek(target))
    return during(c.begin({ kind: 'request', name: 'request' }), () => {
      let parent = context()?.parent
      nested = record(
        target,
        () =>
          during(c.begin({ kind: 'apply', name: 'apply' }), () => {
            during(
              c.begin({ kind: 'sql', name: 'book select' }),
              () => measure({ rowsRead: 2 }),
            )
          }),
        { parent },
      )
    })
  })
  equal(captured.spans.map((e) => e.name), ['request', 'apply', 'book select'])
  equal(nested?.spans.map((e) => e.name), ['apply', 'book select'])
  equal(captured.spans[1].parent, captured.spans[0].id)
  equal(captured.spans[0].counts, { rowsRead: 2 })
})

test('private captures discard events without suppressing another subscriber history', () => {
  let target = {}, c = channel(target)
  let captured = record(
    target,
    () => during(c.begin({ kind: 'request', name: 'private' }), () => 1),
    { history: false },
  )
  equal(captured.spans.length, 1)
  equal(c.history(), [])
  let stop = c.subscribe(() => {})
  record(
    target,
    () => during(c.begin({ kind: 'request', name: 'shared' }), () => 2),
    { history: false },
  )
  equal(c.history().length, 2)
  stop()
  record(
    target,
    () => during(c.begin({ kind: 'request', name: 'discarded' }), () => 3),
    { history: false },
  )
  equal(c.history().length, 2)
  equal(c.active, false)
})
