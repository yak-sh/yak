// The clock settles the initial lens mover, then leaves a schedule-free app
// asleep across alarms and evictions. No real object or store is contacted.
import { assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
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

test('an idle Vale-shaped store sleeps after the initial lens pass', async () => {
  let ctx = state()
  using _db = ctx.storage
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
  await store.alarm()
  await until(async () => {
    let res = await store.fetch(
      new Request('http://store/move', {
        method: 'POST',
        headers: { ...headers, 'x-yak-kernel': '1' },
      }),
    )
    let held = await res.json() as { rules: { done?: string }[] }
    return held.rules.every((r) => r.done)
  })
  await ctx.storage.deleteAlarm()
  await store.alarm()
  assertEquals(await ctx.storage.getAlarm(), null)
  await store.alarm()
  assertEquals(await ctx.storage.getAlarm(), null)
  store = new Store(ctx)
  await store.alarm()
  assertEquals(await ctx.storage.getAlarm(), null)
})
