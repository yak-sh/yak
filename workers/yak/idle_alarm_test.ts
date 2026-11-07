// The clock settles the initial lens mover, then leaves a schedule-free app
// asleep across alarms and evictions. No live object or store is contacted.
import { assert, assertEquals } from '@std/assert'
import { test, tick, until } from '@yaks/testing'
import { Store } from './graph.ts'
import { bucket, state } from './testing.ts'
import type { Env } from './env.ts'
import words from '../../apps/vale/vocab.json' with { type: 'json' }

const headers = {
  'x-store': 'ada/idle',
  'x-yak-access': 'private',
  'x-yak-role': 'owner',
  'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
}

let alarm = async (store: Store) => {
  await store.alarm()
  await tick()
}

let idle = async (ctx: ReturnType<typeof state>) => {
  let store = new Store(ctx)
  let post = (path: string, body: unknown) =>
    store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    )
  assertEquals((await post('/vocab', words)).status, 200)
  await ctx.storage.deleteAlarm()
  await alarm(store)
  await until(async () => {
    let res = await store.fetch(
      new Request('http://store/move', {
        method: 'POST',
        headers: { ...headers, 'x-yak-kernel': '1' },
      }),
    )
    let held = await res.json() as {
      rules: { done?: string; live?: boolean }[]
    }
    return held.rules.every((r) => !r.live || r.done)
  })
  await ctx.storage.deleteAlarm()
  await alarm(store)
  return { store, post }
}

test('an idle Vale-shaped store sleeps after the initial lens pass', async () => {
  let ctx = state()
  using _db = ctx.storage
  let { store } = await idle(ctx)
  assertEquals(await ctx.storage.getAlarm(), null)
  await alarm(store)
  assertEquals(await ctx.storage.getAlarm(), null)
  store = new Store(ctx)
  await alarm(store)
  assertEquals(await ctx.storage.getAlarm(), null)
})

test('a comment owes no unhandled effect and leaves its app store asleep', async () => {
  let ctx = state()
  using _db = ctx.storage
  let { store, post } = await idle(ctx)
  let target = crypto.randomUUID()
  assertEquals(
    (await post('/apply', [
      { entity: { eid: target }, doc: { title: 'A target' } },
      {
        entity: { eid: crypto.randomUUID() },
        comment: { target },
        doc: { body: 'A comment' },
      },
    ])).status,
    200,
  )
  await alarm(store)
  assertEquals(await ctx.storage.getAlarm(), null)
  let pending = await store.fetch(
    new Request(
      'http://store/query?q=.effect.state=pending',
      { headers },
    ),
  )
  assertEquals(await pending.json(), [])
})

test('old unhandled pending effects stay stored without waking an app', async () => {
  let ctx = state()
  using _db = ctx.storage
  let { store } = await idle(ctx)
  let eid = crypto.randomUUID()
  let wrote = await store.fetch(
    new Request('http://store/apply', {
      method: 'POST',
      headers: { ...headers, 'x-yak-kernel': '1' },
      body: JSON.stringify([{
        entity: { eid },
        effect: {
          handler: 'mail_inbox',
          kind: 'created',
          comp: 'comment',
          state: 'pending',
          next: new Date().toISOString(),
        },
      }]),
    }),
  )
  assertEquals(wrote.status, 200)
  await alarm(store)
  assertEquals(await ctx.storage.getAlarm(), null)
  let read = await store.fetch(
    new Request(
      `http://store/query?q=.effect.state=pending&.entity.eid=${eid}`,
      { headers },
    ),
  )
  assertEquals((await read.json()).length, 1)
  store = new Store(ctx)
  await alarm(store)
  assertEquals(await ctx.storage.getAlarm(), null)
})

test('a handled pending effect arms the app alarm for its next attempt', async () => {
  let ctx = state()
  using _db = ctx.storage
  let { store } = await idle(ctx)
  let next = Date.now() + 120_000
  let wrote = await store.fetch(
    new Request('http://store/apply', {
      method: 'POST',
      headers: { ...headers, 'x-yak-kernel': '1' },
      body: JSON.stringify([{
        entity: { eid: crypto.randomUUID() },
        effect: {
          handler: 'call_ready',
          kind: 'matched',
          comp: 'call',
          state: 'pending',
          next: new Date(next).toISOString(),
        },
      }]),
    }),
  )
  assertEquals(wrote.status, 200)
  await alarm(store)
  await until(async () => await ctx.storage.getAlarm() == next)
})

// An instance a deploy cut off spent its alarm without arming the next one.
let effect = (next: number) => ({
  entity: { eid: crypto.randomUUID() },
  effect: {
    handler: 'call_ready',
    kind: 'matched',
    comp: 'call',
    state: 'pending',
    next: new Date(next).toISOString(),
  },
})

let kernel = (store: Store, body: unknown) =>
  store.fetch(
    new Request('http://store/apply', {
      method: 'POST',
      headers: { ...headers, 'x-yak-kernel': '1' },
      body: JSON.stringify(body),
    }),
  )

test('a new incarnation re-arms the alarm its pending effects owe', async () => {
  let ctx = state()
  using _db = ctx.storage
  let { store } = await idle(ctx)
  let next = Date.now() + 120_000
  assertEquals((await kernel(store, [effect(next)])).status, 200)
  await ctx.storage.deleteAlarm()
  store = new Store(ctx)
  let read = await store.fetch(
    new Request('http://store/query?q=.effect.state=pending', { headers }),
  )
  assertEquals((await read.json()).length, 1)
  // Re-armed behind the answer, which waits for none of it.
  await new Promise((r) => setTimeout(r, 0))
  assertEquals(await ctx.storage.getAlarm(), next)
})

test('a run holds the alarm a minute out while it is in flight', async () => {
  let ctx = state()
  using _db = ctx.storage
  // An upload's deletion asks the directory where the app lives, and the
  // directory answers once the test lets it.
  let asked = false, answer = () => {}
  let held = new Promise<void>((r) => answer = r)
  let STORE = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async () => {
        asked = true
        await held
        return Response.json(null)
      },
    }),
  }
  let bind = { STORE, BLOBS: bucket().r2 } as unknown as Env
  let store = new Store(ctx, bind, [])
  let sha = '1'.repeat(64)
  assertEquals(
    (await kernel(store, [{ entity: { eid: sha }, blob: { bytes: 3 } }]))
      .status,
    200,
  )
  let before = Date.now()
  await ctx.storage.deleteAlarm()
  assertEquals(
    (await kernel(store, [{ entity: { eid: sha }, $delete: true }])).status,
    200,
  )
  await until(() => asked)
  assert((await ctx.storage.getAlarm() ?? 0) >= before + 60_000)
  await ctx.storage.deleteAlarm()
  await alarm(store)
  assert((await ctx.storage.getAlarm() ?? 0) >= before + 60_000)
  answer()
})

test('a failed effect run the kernel retries is worked again', async () => {
  let ctx = state()
  using _db = ctx.storage
  let { store } = await idle(ctx)
  let failed = effect(Date.now())
  failed.effect.state = 'failed'
  assertEquals((await kernel(store, [failed])).status, 200)
  let retry = (kernel: boolean) =>
    store.fetch(
      new Request('http://store/effects?of=call_ready', {
        method: 'POST',
        headers: kernel ? { ...headers, 'x-yak-kernel': '1' } : headers,
      }),
    )
  assertEquals((await retry(false)).status, 404)
  assertEquals(await (await retry(true)).json(), { retried: 1 })
  await until(async () => {
    let read = await store.fetch(
      new Request(
        `http://store/query?q=.entity.eid=${failed.entity.eid}&.fields=effect.attempts`,
        { headers },
      ),
    )
    let [row] = await read.json()
    return row?.effect?.attempts == 1
  })
})
