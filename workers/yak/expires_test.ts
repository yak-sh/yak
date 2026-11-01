import { clock, equal, test } from '@yaks/testing'
import { Store } from './graph.ts'
import { durable } from './testing.ts'
import type { Env } from './env.ts'
import { driver } from '@yaks/durable-object'
import { col, eq, lit, select, table } from '@yaks/sql'
import { within } from './defects.ts'

let fixture = (name = `preview/${crypto.randomUUID()}`, remove = () => {}) => {
  let time = clock(1_000)
  let storage = durable()
  let removed: string[] = []
  let privateFiles: string[] = []
  let ctx = { storage, getWebSockets: () => [], acceptWebSocket() {} }
  let env = {
    BLOBS: {
      delete: (key: string) => {
        remove()
        removed.push(...[key].flat())
        return Promise.resolve()
      },
      list: () =>
        Promise.resolve({
          objects: privateFiles.map((key) => ({ key, uploaded: new Date() })),
          truncated: false,
        }),
    },
  } as unknown as Env
  let open = () => new Store(ctx, env, [], { now: time.now })
  let store = open()
  let post = (path: string, body: unknown, kernel = true) =>
    store.fetch(
      new Request(`http://store${path}`, {
        method: 'POST',
        headers: {
          'x-store': name,
          ...(kernel ? { 'x-yak-kernel': '1' } : {}),
        },
        body: JSON.stringify(body),
      }),
    )
  return { time, storage, removed, privateFiles, store, open, post }
}

let pending = fixture()
let at = 61_000
let source = 'ada.123456/.releases/app-id/release-id'
pending.privateFiles.push(source + '/private/generated.png')
let scheduled = await pending.post('/expires', { at, source })
await pending.storage.deleteAlarm()
await pending.store.alarm()
let alarm = await pending.storage.getAlarm()
await pending.time.advance(at - pending.time.now())
await pending.open().alarm()
let after = await pending.storage.get('expires')
let dormant = await pending.storage.get('dormant')
let tables = driver(pending.storage).query(select({
  cols: [col('name')],
  from: table('sqlite_master'),
  where: eq(col('type'), lit('table')),
})).filter((r) => !String(r.name).startsWith('sqlite_'))
let closed = await pending.open().fetch(
  new Request('http://store/query?q=.doc'),
)

test('a temporary store keeps its expiry alarm across an earlier wake and eviction', () => {
  equal(scheduled.status, 200)
  equal(alarm, at)
})

test('expiry removes the private snapshot and store data and leaves it dormant', () => {
  equal(pending.removed, [source + '.json', source + '/private/generated.png'])
  equal(after, undefined)
  equal(dormant, true)
  equal(tables, [])
  equal(closed.status, 404)
})

let ordinary = fixture('ada/notes.123456')
let ordinaryStatus = (await ordinary.post('/expires', { at })).status
let untrusted = fixture()
let untrustedStatus = (await untrusted.post('/expires', { at }, false)).status
let malformed = fixture()
let malformedStatus =
  (await malformed.post('/expires', { at: 'tomorrow' })).status

test('only the kernel can expire a temporary store, and malformed deadlines schedule nothing', async () => {
  equal([ordinaryStatus, untrustedStatus], [404, 404])
  equal(malformedStatus, 400)
  equal(await ordinary.storage.get('expires'), undefined)
  equal(await untrusted.storage.get('expires'), undefined)
  equal(await malformed.storage.get('expires'), undefined)
})

let unavailable = true
let retry = fixture(undefined, () => {
  if (unavailable) throw new Error('bucket unavailable')
})
await retry.post('/expires', { at, source })
await retry.time.advance(at - retry.time.now())
let failures = 0
await within(
  {
    ERRORS: {
      send: () => {
        failures++
        return Promise.resolve()
      },
    },
  },
  {},
  () => retry.open().alarm(),
  retry.time,
)
let kept = await retry.storage.get('expires')
let again = await retry.storage.getAlarm()
unavailable = false
await retry.time.advance(Store.RETRY)
await retry.open().alarm()

test('failed expiry is reported and retried with the cleanup receipt intact', async () => {
  equal(failures, 1)
  equal(kept, { at, source })
  equal(again, at + Store.RETRY)
  equal(retry.removed, [source + '.json'])
  equal(await retry.storage.get('expires'), undefined)
})
