// The clock settles the initial lens mover, then leaves a schedule-free app
// asleep across alarms and evictions. No live object or store is contacted.
import { assertEquals } from '@std/assert'
import { test, tick, until } from '@yaks/testing'
import { Store } from './graph.ts'
import { state } from './testing.ts'
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
