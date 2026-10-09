// A failed embedding pass must honor its retry interval, not an earlier
// crash-recovery alarm it armed before the provider answered.
import { assert, assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import { Store } from './graph.ts'
import { state } from './testing.ts'

const headers = {
  'x-store': 'ada/embedding-alarm',
  'x-yak-role': 'owner',
  'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
}
test('an embedding failure honors the store retry interval across reboot', async () => {
  let ctx = state()
  using _db = ctx.storage
  let failures = 0
  let bind = {
    AI: {
      gateway: () => ({
        getUrl: () => Promise.resolve('http://unused.invalid'),
      }),
      run: () => {
        failures++
        return Promise.reject(Error('provider unavailable'))
      },
    },
  }
  // This fixture isolates embedding retry from schema movers, which may
  // legitimately own an earlier alarm after a platform deployment.
  let store = new Store(ctx, bind, [])
  let post = (path: string, body: unknown) =>
    store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    )
  assertEquals((await post('/vocab', {})).status, 200)
  let began = Date.now()
  // A text the model is owed: an app's store holds none until it writes one.
  let note = [{ entity: { eid: 'note' }, doc: { title: 'A note' } }]
  assertEquals((await post('/apply', note)).status, 200)
  await until(() => failures > 0)
  // The provider rejects before the drain catches it and rearms the alarm.
  // Wait for that durable outcome, not just the attempted provider call.
  let alarm = await until(async () => {
    let at = await ctx.storage.getAlarm()
    return at != null && at >= began + Store.RETRY ? at : null
  })
  assert(alarm >= began + Store.RETRY, `${alarm - began}ms`)
  await ctx.storage.deleteAlarm()
  began = Date.now()
  let count = failures
  store = new Store(ctx, bind, [])
  await store.alarm()
  await until(() => failures > count)
  alarm = await until(async () => {
    let at = await ctx.storage.getAlarm()
    return at != null && at >= began + Store.RETRY ? at : null
  })
  assert(alarm >= began + Store.RETRY, `${alarm - began}ms`)
})
