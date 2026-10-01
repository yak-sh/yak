// The app gateway decides who may read before asking Files for cached bytes.
// The versioned representation, conditions and seeks all use that one door.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import * as apps from './apps.ts'
import * as files from './files.ts'
import { storage } from '@yaks/durable-object'
import { Store } from './graph.ts'
import { state } from './testing.ts'
import { doorOf } from './door.ts'
import { KERNEL, metaOf } from './meta.ts'
import { appVocab } from './vocab.ts'
import { ADA, ADA_OWNS, as, platform, seeded, visit } from './serving-probe.ts'

test('private app blobs keep the cache behind authorization', async () => {
  using scenario = platform()
  let { env } = scenario
  await seeded(env, 'private')
  let cookie = await as(ADA)
  let body = new Uint8Array([0, 1, 2, 3, 4, 5])
  let upload = await apps.fetch(
    visit('/cookbook/api/blob', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      body,
    }),
    env,
  )
  assertEquals(upload.status, 200)
  let file: { url: string } = await upload.json()
  let calls: Request[] = []
  env.FILES = {
    fetch: (req) => {
      calls.push(req)
      return files.fetch(req, env)
    },
  }
  let get = (headers: Record<string, string> = {}, method = 'GET') =>
    apps.fetch(
      visit(file.url, { method, headers: { cookie, ...headers } }),
      env,
    )

  let stranger = await apps.fetch(visit(file.url), env)
  assertEquals(stranger.status, 401)
  assertEquals(calls.length, 0)

  let whole = await get()
  assertEquals(whole.status, 200)
  assertEquals(whole.headers.get('cache-control'), 'private, no-store')
  let etag = whole.headers.get('etag')!
  assertEquals(new Uint8Array(await whole.arrayBuffer()), body)
  assertEquals(calls.length, 1)

  let part = await get({ range: 'bytes=2-4', 'if-range': etag })
  assertEquals(part.status, 206)
  assertEquals(part.headers.get('content-range'), 'bytes 2-4/6')
  assertEquals(new Uint8Array(await part.arrayBuffer()), body.slice(2, 5))
  assertEquals(calls[1].url, calls[0].url)
  assertEquals(calls[1].headers.get('range'), 'bytes=2-4')

  let fresh = await get({ 'if-none-match': etag })
  assertEquals(fresh.status, 304)
  assertEquals(calls.length, 2)

  let stale = await get({ range: 'bytes=2-', 'if-range': '"old"' })
  assertEquals(stale.status, 200)
  assertEquals(calls[2].headers.get('range'), null)
  assertEquals(new Uint8Array(await stale.arrayBuffer()), body)

  let head = await get({}, 'HEAD')
  assertEquals(head.status, 200)
  assertEquals(head.headers.get('content-length'), '6')
  assertEquals(await head.text(), '')
})

test('an anonymous blob read revives a removed immutable representation', async () => {
  using scenario = platform()
  let { env } = scenario
  let { space, app } = await seeded(env, 'open')
  let ctx = state()
  let object = new Store(ctx, env)
  let store = doorOf((req) => object.fetch(req), 'ada/cookbook.aaa111', {
    eid: app.eid,
    access: app.access,
  })
  let words = {
    $defs: {
      counter: {
        component: true,
        properties: { value: { type: 'number' } },
        constraints: [{
          name: 'cap',
          value: { sum: [{ product: [{ field: 'value' }] }] },
          maximum: 10,
          message: 'too much',
        }],
      },
    },
  }
  assertEquals(
    (await store('/vocab', {
      method: 'POST',
      body: JSON.stringify(words),
    }, ADA_OWNS)).status,
    200,
  )
  let ns = env.STORE
  let get = ns.get.bind(ns)
  ns.get = (id) =>
    String(id) == 'ada/cookbook.aaa111'
      ? { fetch: (req) => object.fetch(req) }
      : get(id)
  let graph = metaOf(store)
  let body = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 1, 2, 3])
  let file = await apps.filed(
    env,
    space,
    app,
    graph,
    body,
    'audio/mpeg',
    'song.mp3',
  )
  await graph.apply(file.bundles, KERNEL)
  let rep = file.url.split('/').pop()!
  // Older storage operations could remove rows without the current blob
  // immutability guard. The read must heal those graves, not rename them.
  let rows = storage(ctx.storage, appVocab(words))
  rows.tx((tx) => tx.remove([{ eid: rep }]))
  let bare = await apps.fetch(visit(`/cookbook/api/blob/${file.sha}`), env)
  assertEquals(bare.status, 302)
  assertEquals(new URL(bare.headers.get('location')!).pathname, file.url)
  let served = await apps.fetch(visit(file.url), env)
  assertEquals(served.status, 200)
  assertEquals(new Uint8Array(await served.arrayBuffer()), body)
  assertEquals(rows.tx((tx) => tx.get([rep]))[0].tombstone, undefined)
})
