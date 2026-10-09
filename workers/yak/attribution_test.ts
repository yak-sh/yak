import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, graph, Stale, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, pick } from '@yaks/vocab'
import { spineDoc } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc'
import {
  attributed,
  attributionPlugin,
  registrationDoc,
} from './attribution.ts'
import { effectDoc, effects } from '@yaks/effects'
import { link } from '@yaks/edge'
import type { Namespace } from './door.ts'
import { platformVocab } from './vocab.ts'
import type { Stored } from './plugin.ts'

// Each boot gets a new registry over the same durable rows. The namespace
// answers locally; neither the app nor directory is a live store.
let registered = loadVocab([spineDoc, docDoc, effectDoc, registrationDoc])
let registrations = () => {
  let vocab = registered
  let storage = ram(vocab)
  let receipts: Bundle[][] = []
  let STORE: Namespace = {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (req) => {
        assertEquals(new URL(req.url).pathname, '/apply')
        let rows = await req.json() as Bundle[]
        receipts.push(rows)
        return Response.json(rows)
      },
    }),
  }
  return { vocab, storage, receipts, STORE }
}

let boot = (
  vocab: ReturnType<typeof loadVocab>,
  storage: Storage,
  STORE: Namespace,
  meta = false,
) => {
  let errors: unknown[] = []
  let selections = 0
  let owed = 0
  let fx = effects(vocab, {
    write: (rows) => g.apply(rows, { trusted: true }),
    report: (error) => void errors.push(error),
  })
  let g = graph({ vocab, storage, plugins: [fx] })
  for (let register of attributionPlugin.effects!) {
    register(fx, {
      graph: g,
      env: { STORE },
      app: 'app',
      meta,
    } as Stored)
  }
  let access = {
    ...g,
    apply: (...args: Parameters<typeof g.apply>) => {
      owed +=
        args[0].filter((r) => (r.effect as Comp)?.state == 'pending').length
      return g.apply(...args)
    },
    rows: (...args: Parameters<typeof g.rows>) => {
      selections++
      return g.rows(...args)
    },
  }
  return {
    g,
    fx,
    errors,
    drain: async () => {
      await fx.work(access)
      await fx.idle()
      assertEquals(errors, [])
    },
    measured: () => ({ selections, owed }),
  }
}

test('settled guest history owes zero registration work on repeated idle boots', async () => {
  let { vocab, storage, receipts, STORE } = registrations()
  let original = boot(vocab, storage, STORE)
  await original.g.apply(Array.from({ length: 107 }, (_, i) => ({
    entity: { eid: `guest-${i}` },
    doc: { title: `Guest ${i}` },
    $actor: { via: 'browser' },
  })))
  await original.drain()
  assertEquals(receipts.length, 107)
  await original.fx.stop()
  receipts.length = 0
  let measured = []
  for (let i = 0; i < 3; i++) {
    receipts.length = 0
    let idle = boot(vocab, storage, STORE)
    await idle.drain()
    await idle.fx.stop()
    measured.push({ ...idle.measured(), registrations: receipts.length })
  }
  assertEquals(
    measured,
    Array.from({ length: 3 }, () => ({
      selections: 0,
      owed: 0,
      registrations: 0,
    })),
  )
})

test('original guest writes owe durable registration, recovered once after restart', async () => {
  let { vocab, storage, receipts, STORE } = registrations()
  let writer = boot(vocab, storage, STORE)
  await writer.g.apply([{
    entity: { eid: 'signed-in' },
    doc: { title: 'Signed in' },
    $actor: {
      by: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      via: 'signed-browser',
    },
  }])
  assertEquals((await writer.g.read('.effect')).length, 0)
  await writer.g.apply([{
    entity: { eid: 'guest' },
    doc: { title: 'Guest' },
    $actor: { via: 'browser' },
  }], { now: '2026-10-04T00:00:00.000Z' })
  await writer.g.apply([{
    entity: { eid: 'guest' },
    doc: { title: 'Edited' },
    $actor: { via: 'editor-browser' },
  }], { now: '2026-10-04T00:00:01.000Z' })
  let pending = await writer.g.read('.effect.state=pending')
  assertEquals(pending.length, 2)
  assertEquals(receipts.length, 0)
  await writer.fx.stop()
  let recovery = boot(vocab, storage, STORE)
  await recovery.drain()
  // Both runs read the current stamps; each registers each distinct guest
  // browser. No additional run is invented at boot.
  assertEquals(receipts.map((r) => r[0].entity.eid).sort(), [
    'browser',
    'browser',
    'editor-browser',
    'editor-browser',
  ])
  assertEquals((await recovery.g.read('.effect.state=pending')).length, 0)
  assertEquals((await recovery.g.read('.effect')).length, 0)
  await recovery.g.apply([{
    entity: { eid: 'guest' },
    doc: { title: 'Edited again' },
    $actor: { via: 'editor-browser' },
  }], { now: '2026-10-04T00:00:02.000Z' })
  await recovery.fx.idle()
  assertEquals(receipts.length, 6)
  assertEquals((await recovery.g.read('.effect')).length, 0)
  await recovery.fx.stop()
  let idle = boot(vocab, storage, STORE)
  await idle.drain()
  await idle.fx.stop()
  assertEquals(receipts.length, 6)
})

test('directory attribution recovery still fills unfinished signed-in receipts', async () => {
  let app = held()
  await app.apply([{
    entity: { eid: 'guest' },
    doc: { title: 'Kept' },
    $actor: { via: 'browser' },
  }])
  let calls = 0
  let STORE: Namespace = {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (req) => {
        assertEquals(new URL(req.url).pathname, '/attribute')
        calls++
        let { via, by } = await req.json()
        return Response.json(await attributed(app, via, by))
      },
    }),
  }
  let vocab = loadVocab([
    ...platformVocab().docs,
    pick(effectDoc, ['effect', 'lease']),
  ])
  let storage = ram(vocab)
  let directory = graph({ vocab, storage })
  await directory.apply([
    { entity: { eid: 'space' }, space: { slug: 'ada' } },
    {
      entity: { eid: 'app' },
      app: { slug: 'guest', space: 'space', access: 'open', version: 1 },
    },
    {
      entity: { eid: 'browser' },
      browser: { by: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
    },
    link('browser', 'worked', 'app'),
  ], { trusted: true, stamp: false })
  let recovery = boot(vocab, storage, STORE, true)
  await recovery.drain()
  assertEquals(calls, 1)
  let [row] = await app.get(['guest'])
  assertEquals((row.created as Comp).by, 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa')
  let [receipt] = await recovery.g.read('.worked ?completed')
  assertEquals(!!receipt.completed, true)
  await recovery.fx.stop()
  let idle = boot(vocab, storage, STORE, true)
  await idle.drain()
  await idle.fx.stop()
  assertEquals(calls, 1)
})

let heldVocab = loadVocab([spineDoc, docDoc])
let held = () => graph({ vocab: heldVocab, storage: ram(heldVocab) })

test('attribution is bounded, repeatable, and leaves timestamps intact', async () => {
  let g = held()
  let now = '2026-10-03T00:00:00.000Z'
  g.apply(
    ['a', 'b', 'c'].map((eid) => ({
      entity: { eid },
      doc: { title: eid },
      $actor: { via: 'browser' },
    })),
    { now },
  )
  assertEquals(
    await attributed(g, 'browser', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 2),
    {
      filled: 2,
      more: true,
    },
  )
  assertEquals(
    await attributed(g, 'browser', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 2),
    {
      filled: 1,
      more: false,
    },
  )
  assertEquals(await attributed(g, 'browser', 'other', 2), {
    filled: 0,
    more: false,
  })
  for (let row of await g.read('.doc ?created ?updated')) {
    assertEquals(row.created, {
      at: now,
      via: 'browser',
      by: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    })
    assertEquals(row.updated, undefined)
  }
})

test('a byline that moved after selection cannot be assigned to the wrong browser', async () => {
  let g = held()
  g.apply([{
    entity: { eid: 'a' },
    doc: { title: 'First' },
    $actor: { via: 'browser' },
  }])
  g.apply([{
    entity: { eid: 'a' },
    doc: { title: 'Second' },
    $actor: { via: 'browser' },
  }])
  let changed = {
    ...g,
    read: async (...args: Parameters<typeof g.read>) => {
      let rows = await g.read(...args)
      g.apply([{
        entity: { eid: 'a' },
        doc: { title: 'Third' },
        $actor: { via: 'another' },
      }])
      return rows
    },
  }
  await assertRejects(
    () =>
      attributed(changed, 'browser', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'),
    Stale,
  )
  let [row] = await g.get(['a'])
  assertEquals((row.created as Comp)?.by, undefined)
  assertEquals((row.updated as Comp)?.via, 'another')
  assertEquals((row.updated as Comp)?.by, undefined)
})
