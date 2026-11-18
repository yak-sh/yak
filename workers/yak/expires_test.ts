import { clock, equal, test } from '@yaks/testing'
import { Store } from './graph.ts'
import { durable } from './testing.ts'
import type { Env } from './env.ts'
import { driver } from '@yaks/durable-object'
import { col, eq, lit, select, table } from '@yaks/sql'

let fixture = (name = `preview/${crypto.randomUUID()}`) => {
  let time = clock(1_000)
  let storage = durable()
  let removed: string[] = []
  let privateFiles: string[] = []
  let ctx = { storage, getWebSockets: () => [], acceptWebSocket() {} }
  let env = {
    BLOBS: {
      delete: (key: string) => {
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
await pending.storage.put('saved-input', 'a person wrote this')
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

test('expiry keeps the private snapshot and saved data in dormant trash', async () => {
  equal(pending.removed, [])
  equal(await pending.storage.get('saved-input'), 'a person wrote this')
  equal(await pending.storage.get('trashed'), { at, source })
  equal(after, undefined)
  equal(dormant, true)
  equal(tables.length > 0, true)
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

let restored = await pending.post('/revive', {})

test('reviving temporary trash keeps its data and does not rearm expiry', async () => {
  equal(restored.status, 200)
  equal(await pending.storage.get('dormant'), false)
  equal(await pending.storage.get('saved-input'), 'a person wrote this')
  equal(await pending.storage.get('expires'), undefined)
})
