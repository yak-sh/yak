// The app gateway decides who may read before asking Files whether a blob is
// still served or for its cached bytes. The versioned representation,
// conditions and seeks all use that one door.
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
import { type App, appStore, type Space } from './directory.ts'
import { representation } from '@yaks/blob'
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
  let asked: Request[] = [], calls: Request[] = []
  env.FILES = {
    fetch: (req) => {
      asked.push(req)
      if (new URL(req.url).pathname.startsWith('/blob/')) calls.push(req)
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
  assertEquals(asked.length, 0)

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
  let inspected = await store(`/inspect?eid=${rep}`, {}, KERNEL)
  let buried = await inspected.json()
  assertEquals(buried.identity.tombstoned, true)
  assertEquals(buried.identity.tables.includes('representation'), false)
  let bare = await apps.fetch(visit(`/cookbook/api/blob/${file.sha}`), env)
  assertEquals(bare.status, 302)
  assertEquals(new URL(bare.headers.get('location')!).pathname, file.url)
  let served = await apps.fetch(visit(file.url), env)
  assertEquals(served.status, 200)
  assertEquals(new Uint8Array(await served.arrayBuffer()), body)
  assertEquals(rows.tx((tx) => tx.get([rep]))[0].tombstone, undefined)
  let live = await (await store(`/inspect?eid=${rep}`, {}, KERNEL)).json()
  assertEquals(live.identity.tombstoned, false)
  assertEquals(live.identity.tables.includes('representation'), true)
})

test('a dropped representation write never redirects to an absent file', async () => {
  using scenario = platform()
  let { env } = scenario
  let { space, app } = await seeded(env, 'open')
  let graph = metaOf(appStore(env.STORE, space, app, env))
  let bytes = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 1, 2, 3])
  let file = await apps.filed(
    env,
    space,
    app,
    graph,
    bytes,
    'audio/mpeg',
    'song.mp3',
  )
  await graph.apply(file.bundles.filter((b) => !b.representation), KERNEL)
  let ns = env.STORE
  let get = ns.get.bind(ns)
  ns.get = (id) => {
    let stub = get(id)
    return {
      fetch: async (req) => {
        if (
          new URL(req.url).pathname == '/apply' &&
          (await req.clone().text()).includes('representation')
        ) {
          return Response.json([])
        }
        return stub.fetch(req)
      },
    }
  }
  let result = await apps.fetch(visit(`/cookbook/api/blob/${file.sha}`), env)
  assertEquals(result.status, 503)
  assertEquals(result.headers.get('location'), null)
  assertEquals(await graph.query('.representation'), [])
})

// What the store says about one upload, each way it can.
let sha = 'a'.repeat(64)
let { eid, row } = representation('app', sha, 'image/png')
let overloaded = 'Durable Object is overloaded. Requests queued for too long.'
let answers = {
  yes: () => Promise.resolve(row),
  no: () => Promise.resolve(null),
  failed: () => Promise.reject(new Error(overloaded)),
}

// Files keeps a yes to whether an app's bytes are served, and never a no or a
// failure (files.ts `servedAs`).
test('a yes to whether a blob is served is kept, a no or a failure is not', async () => {
  let kept = (r: Response) =>
    r.headers.get('cache-control')!.startsWith('public')
  let yes = await files.servedAs(answers.yes)
  assertEquals([yes.status, kept(yes), (await yes.json()).address], [
    200,
    true,
    sha,
  ])
  let no = await files.servedAs(answers.no)
  assertEquals([no.status, kept(no)], [404, false])
  let failed = await files.servedAs(answers.failed)
  assertEquals([failed.status, kept(failed)], [503, false])
})

// The gateway asks Files first for an app anyone may read, and the store
// itself for a private app or when Files has no yes; a Files that could not
// say is a throw, which the gateway answers with a 503 (apps.ts `servedTo`).
test('the gateway asks Files about an app anyone may read, and the store when Files says no', async () => {
  let asked = 0
  let graph = {
    query: () => {
      asked++
      return Promise.resolve([
        { entity: { eid }, representation: row },
        { entity: { eid: sha }, blob: {} },
      ])
    },
  }
  let gateway = (said: keyof typeof answers, access = 'public') =>
    apps.servedTo(
      { FILES: { fetch: () => files.servedAs(answers[said]) } } as never,
      { eid: 'space', slug: 'ada' } as Space,
      { eid: 'app', slug: 'cookbook', space: 'space', access } as App,
      graph,
      sha,
      eid,
    )
  assertEquals([(await gateway('yes'))?.address, asked], [sha, 0])
  assertEquals(
    String(await gateway('failed').catch((e) => e)),
    `Error: ${overloaded}`,
  )
  assertEquals([(await gateway('no'))?.address, asked], [sha, 1])
  assertEquals([(await gateway('failed', 'private'))?.address, asked], [
    sha,
    2,
  ])
})
