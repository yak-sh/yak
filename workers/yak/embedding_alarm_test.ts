// A failed embedding pass must honor its retry interval, not an earlier
// crash-recovery alarm it armed before the provider answered.
import { assert, assertEquals } from '@std/assert'
import { driver } from '@yaks/durable-object'
import { retries, TABLE } from '@yaks/embedding'
import { col, eq, join, select, table } from '@yaks/sql'
import { test, until } from '@yaks/testing'
import { Store } from './graph.ts'
import { DIM } from './embedding.ts'
import { state } from './testing.ts'

retries.waits = [0]

const headers = {
  'x-store': 'ada/embedding-alarm',
  'x-yak-role': 'owner',
  'x-yak-person': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  'x-yak-app': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
}
test('an embedding failure honors the store retry interval across reboot', async () => {
  let ctx = state()
  using _db = ctx.storage
  let failures = 0, up = false
  let bind = {
    AI: {
      gateway: () => ({
        getUrl: () => Promise.resolve('http://unused.invalid'),
      }),
      run: (_: string, input: unknown) => {
        if (up) {
          let { text } = input as { text: string[] }
          let one = Array.from({ length: DIM }, (_, i) => i == 0 ? 1 : 0)
          return Promise.resolve({ data: text.map(() => one) })
        }
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
  // Schema setup can leave an earlier continuation alarm. Delivering that
  // alarm is outside this fixture: isolate the failed write's retry below.
  await ctx.storage.deleteAlarm()
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
  // The embedder asked again before it gave up, and gave up once: a write
  // before the retry is due queues its text and leaves the model alone.
  assertEquals(failures, 2)
  let more = [{ entity: { eid: 'more' }, doc: { title: 'Another note' } }]
  assertEquals((await post('/apply', more)).status, 200)
  await store.alarm()
  while (ctx.pending.size) await Promise.allSettled([...ctx.pending])
  assertEquals(failures, 2)
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
  // However long it was down, the texts waited: the model answering again
  // embeds every one of them.
  up = true
  await ctx.storage.deleteAlarm()
  store = new Store(ctx, bind, [])
  await store.alarm()
  let o = (c: string) => col(c, 'o')
  let held = () =>
    driver(ctx.storage).query(select({
      cols: [o('eid')],
      from: table(TABLE, 'e'),
      joins: [join(table('entity', 'o'), eq(o('id'), col('owner', 'e')))],
    })).map((r) => r.eid)
  await until(() => ['note', 'more'].every((eid) => held().includes(eid)))
})
