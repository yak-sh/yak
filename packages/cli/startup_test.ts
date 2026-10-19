/** Composition activity is observable before a graph exists, without changing
 * the host's success, refusal, or idle behavior. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { equal, ok, test, throws } from '@yaks/testing'
import {
  channel,
  type Context,
  type Event,
  installContext,
  peek,
} from '@yaks/trace'
import { compose, type Config } from './host.ts'

let config = (): Config => ({ db: ':memory:', plugins: [] })

test('composition records a complete process-start tree on its config channel', async () => {
  let local = new AsyncLocalStorage<Context | undefined>()
  let restore = installContext({
    get: () => local.getStore(),
    run: (ctx, work) => local.run(ctx, work),
  })
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
    let starts = events.filter((e) => e.stage == 'start')
    let parts = starts.filter((e) => e.parent == root.id && e.kind == 'phase')
    ok(parts.length > 1)
    // An async carrier also makes nested SQL producers visible. Every producer
    // has one end and reaches this process-start root through recorded parents.
    ok(starts.some((e) => e.kind == 'sql'))
    let byId = new Map(starts.map((e) => [e.id, e]))
    for (let part of starts) {
      equal(events.filter((e) => e.id == part.id && e.stage == 'end').length, 1)
      let at = part
      let seen = new Set<string>()
      while (at.id != root.id) {
        ok(!seen.has(at.id))
        seen.add(at.id)
        at = ok(byId.get(ok(at.parent)))
      }
    }
    ok(!JSON.stringify(events).includes(':memory:'))
    equal(await host.graph.read(''), [])
  } finally {
    off()
    await host.close()
    restore()
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

let privateHost = await compose({ db: ':memory:', plugins: [] }, ['graph'])
let privateActive = peek(privateHost.graph)?.active ?? false
await privateHost.close()
test('a private memory host without a tracker leaves its graph channel idle', () => {
  equal(privateActive, false)
})

let declarationsRead = 0
let lazyHost = await compose(
  { db: ':memory:', plugins: ['lazy'] },
  ['graph'],
  ((_: string, facet: string) =>
    Promise.resolve(
      facet == 'vocab'
        ? {
          docs: [{
            $defs: {
              lazy_read: {
                tool: true,
                description: 'A lazy read',
                get input() {
                  declarationsRead++
                  return { type: 'object', properties: {} }
                },
              },
            },
          }],
        }
        : null,
    )) as import('@yaks/host').Load,
)
let readsAtOpen = declarationsRead
let offered = lazyHost.tools.some((tool) => tool.name == 'lazy_read')
let readsAfterOffer = declarationsRead
await lazyHost.close()
test('opening a graph does not validate tools nobody offered or ran', () => {
  equal(readsAtOpen, 0)
  equal(offered, true)
  ok(readsAfterOffer > readsAtOpen)
})
