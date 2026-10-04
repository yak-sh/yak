import { equal, test } from '@yaks/testing'
import { type Bundle, type Comp, graph, type Storage } from '@yaks/graph'
import { effectDoc, effects } from '@yaks/effects'
import { ram } from '@yaks/ram'
import { loadVocab, pick } from '@yaks/vocab'
import { platformVocab } from './vocab.ts'
import { trashPlugin } from './trash.ts'
import type { Namespace } from './door.ts'
import type { Stored } from './plugin.ts'

// Persistent directory rows, fresh effect registry each incarnation, and a
// controllable delivery door/clock. No production namespace or wall-clock wait.
let fixture = () => {
  let vocab = loadVocab([
    ...platformVocab().docs,
    pick(effectDoc, ['effect', 'lease']),
  ])
  let storage = ram(vocab)
  let now = Date.now()
  let failing = false
  let calls: { name: string; path: string }[] = []
  let dormant = new Map<string, boolean>()
  let arrived: (() => Promise<void>) | undefined
  let STORE: Namespace = {
    idFromName: (name) => name,
    get: (name) => ({
      fetch: async (req) => {
        equal(req.headers.get('x-yak-kernel'), '1')
        let path = new URL(req.url).pathname
        calls.push({ name: String(name), path })
        if (arrived) await arrived()
        if (failing) return new Response('offline', { status: 503 })
        dormant.set(String(name), path == '/dormant')
        return Response.json({ ok: true })
      },
    }),
  }
  let boot = (held: Storage = storage) => {
    let errors: unknown[] = []
    let fx = effects(vocab, {
      defer: true,
      now: () => now,
      report: (error) => void errors.push(error),
      write: (rows) => g.apply(rows, { trusted: true }),
    })
    let g = graph({ vocab, storage: held, plugins: [fx] })
    for (let register of trashPlugin.effects!) {
      register(fx, { meta: true, env: { STORE }, graph: g } as Stored)
    }
    return {
      g,
      fx,
      drain: async () => {
        await fx.work(g)
        await fx.idle()
        equal(errors, [])
      },
      runs: async () =>
        await g.read('.effect.handler=notify_trash .effect') as Bundle[],
    }
  }
  let seed = async (g: ReturnType<typeof boot>['g']) => {
    await g.apply([
      { entity: { eid: 'space' }, space: { slug: 'trash-delivery' } },
      ...['one', 'two'].map((eid) => ({
        entity: { eid },
        app: {
          slug: eid,
          space: 'space',
          store: `trash-delivery/${eid}.123456`,
          access: 'private',
        },
      })),
    ], { trusted: true })
  }
  return {
    boot,
    seed,
    calls,
    dormant,
    fail: (v: boolean) => failing = v,
    advance: () => now += 60001,
    arriving: (f: () => Promise<void>) => arrived = f,
  }
}

test('trash and restore notifications survive directory restart and more than three failed deliveries', async () => {
  let p = fixture()
  let first = p.boot()
  await p.seed(first.g)
  await first.g.apply([{ entity: { eid: 'one' }, trashed: {} }], {
    trusted: true,
  })
  equal(p.calls, [])
  equal((await first.runs()).map((r) => (r.effect as Comp).state), ['pending'])
  await first.fx.stop()

  let recovery = p.boot()
  p.fail(true)
  for (let i = 0; i < 5; i++) {
    await recovery.drain()
    equal((await recovery.runs()).map((r) => (r.effect as Comp).state), [
      'pending',
    ])
    p.advance()
  }
  equal(p.calls.length, 5)
  p.fail(false)
  await recovery.drain()
  equal(p.dormant.get('trash-delivery/one.123456'), true)
  equal(await recovery.runs(), [])

  // A restore is also owed in the same commit, then retried after a restart.
  p.fail(true)
  await recovery.g.apply([{ entity: { eid: 'one' }, trashed: null }], {
    trusted: true,
  })
  await recovery.drain()
  equal(
    (await recovery.runs()).filter((r) => (r.effect as Comp).state == 'pending')
      .length,
    1,
  )
  await recovery.fx.stop()
  let restored = p.boot()
  p.fail(false)
  p.advance()
  await restored.drain()
  equal(p.dormant.get('trash-delivery/one.123456'), false)
  equal(
    (await restored.runs()).length == 0,
    true,
  )
  await restored.fx.stop()
})

test('a failed trash retry reads a newer restore instead of putting the store back to sleep', async () => {
  let p = fixture()
  let writer = p.boot()
  await p.seed(writer.g)
  await writer.g.apply([{ entity: { eid: 'one' }, trashed: {} }], {
    trusted: true,
  })
  p.fail(true)
  await writer.drain()
  await writer.g.apply([{ entity: { eid: 'one' }, trashed: null }], {
    trusted: true,
  })
  await writer.fx.stop()
  let recovery = p.boot()
  p.calls.length = 0
  p.fail(false)
  p.advance()
  await recovery.drain()
  equal(p.calls.map((r) => r.path), ['/revive', '/revive'])
  equal(p.dormant.get('trash-delivery/one.123456'), false)
  await recovery.fx.stop()
})

test('a restore committed during an in-flight trash delivery is delivered before settling', async () => {
  let p = fixture()
  let writer = p.boot()
  await p.seed(writer.g)
  await writer.g.apply([{ entity: { eid: 'one' }, trashed: {} }], {
    trusted: true,
  })
  let changed = false
  p.arriving(async () => {
    if (changed) return
    changed = true
    await writer.g.apply([{ entity: { eid: 'one' }, trashed: null }], {
      trusted: true,
    })
  })
  await writer.drain()
  equal(p.calls[0].path, '/dormant')
  equal(p.calls.some((r) => r.path == '/revive'), true)
  equal(p.dormant.get('trash-delivery/one.123456'), false)
  await writer.fx.stop()
})

test('space trash retries every affected app and space restore preserves each app own trash', async () => {
  let p = fixture()
  let writer = p.boot()
  await p.seed(writer.g)
  await writer.g.apply([
    { entity: { eid: 'one' }, trashed: {} },
    { entity: { eid: 'space' }, trashed: {} },
  ], { trusted: true })
  p.fail(true)
  await writer.drain()
  await writer.fx.stop()
  let recovery = p.boot()
  p.fail(false)
  p.advance()
  await recovery.drain()
  equal([...p.dormant.entries()].sort(), [
    ['trash-delivery/one.123456', true],
    ['trash-delivery/two.123456', true],
  ])
  await recovery.g.apply([{ entity: { eid: 'space' }, trashed: null }], {
    trusted: true,
  })
  await recovery.drain()
  equal([...p.dormant.entries()].sort(), [
    ['trash-delivery/one.123456', true],
    ['trash-delivery/two.123456', false],
  ])
  await recovery.fx.stop()
})
