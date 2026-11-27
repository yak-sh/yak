import { clock, test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { stored } from '@yaks/workerd/cache'
import { pageAt, UNKEPT } from '@yaks/platform/kept'
import { appStore, storeAt } from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { filed } from './uploads.ts'
import * as apps from './apps.ts'
import * as files from './files.ts'
import * as site from './site.ts'
import { type FrontEnv, serve } from './front/front.ts'
import { platform, seeded, visit } from './serving-probe.ts'

// The runtime's cache boundary, with expiry controlled by the caller. No
// stale answer is offered unless the origin explicitly permits one.
let cache = (draw: (req: Request) => Promise<Response>, now: () => number) => {
  let held = new Map<
    string,
    { bytes: ArrayBuffer; init: ResponseInit; until: number }
  >()
  let misses = 0
  let shelf = {
    match: (req: Request) => {
      let hit = held.get(req.url)
      return Promise.resolve(
        hit && hit.until > now()
          ? new Response(hit.bytes.slice(0), hit.init)
          : undefined,
      )
    },
    put: async (req: Request, answer: Response) => {
      let age = /max-age=(\d+)/.exec(answer.headers.get('cache-control') ?? '')
      if (age) {
        held.set(req.url, {
          bytes: await answer.arrayBuffer(),
          init: { status: answer.status, headers: new Headers(answer.headers) },
          until: now() + Number(age[1]) * 1000,
        })
      }
      return Promise.resolve()
    },
  }
  return {
    misses: () => misses,
    fetch: async (req: Request) => {
      // An incoming service request retains HTTP data, not Request.cache.
      req = new Request(req.url, { method: req.method, headers: req.headers })
      let pending: Promise<void>[] = []
      let answer = await stored(shelf, req, (req) => (misses++, draw(req)), {
        hold: (work) => pending.push(work),
        failed: (error) => {
          throw error
        },
      })
      await Promise.all(pending)
      return answer
    },
  }
}

let fixture = async (access = 'public', published = false) => {
  let time = clock(Date.now())
  let { env, ring } = platform({ CLOCK: time })
  let { dir, space, app } = await seeded(env, access)
  let mark = async () => (await dir.app(space, app.slug))?.withdrawn
  await dir.apply({
    entities: [{ entity: { eid: app.eid }, app: { worker: '' } }],
  }, KERNEL)
  if (published) {
    await dir.apply({
      entities: [{
        entity: { eid: app.eid },
        published: { name: 'cookbook', version: 1, at: '', about: '' },
      }],
    }, KERNEL)
  }
  let graph = metaOf(appStore(env.STORE, space, app, env))
  let bytes = new TextEncoder().encode('a visitor upload')
  let file = await filed(
    env,
    space,
    app,
    graph,
    bytes,
    'text/plain',
    'notes.txt',
  )
  await graph.apply(file.bundles, KERNEL)
  // Each time the app's store is asked whether an upload is served.
  let asked = 0
  let stores = env.STORE
  env.STORE = {
    ...stores,
    get: (id: never) => {
      let store = stores.get(id)
      return {
        ...store,
        fetch: (req: Request) => {
          if (req.url.includes('representation')) asked++
          return store.fetch(req)
        },
      }
    },
  } as Env['STORE']
  let inner = cache((req) => files.fetch(req, env), time.now)
  let edge = cache((req) => site.fetch(req, env), time.now)
  env.FILES = inner
  let forwarded = 0
  let front = {
    APEX: 'yaks.app',
    CLI: { fetch: () => Promise.resolve(new Response(null, { status: 404 })) },
    SITE: edge,
    KERNEL: { fetch: (req: Request) => (forwarded++, apps.fetch(req, env)) },
    USES: { used: () => {} },
    STORE: env.STORE!,
  } as FrontEnv
  return {
    env,
    space,
    app,
    file,
    time,
    inner,
    edge,
    forwarded: () => forwarded,
    asked: () => asked,
    ask: (init?: RequestInit) =>
      serve(visit(file.url, init), front, { waitUntil: () => {} }),
    origin: () =>
      site.fetch(new Request(pageAt('ada.yaks.app', file.url, null)), env),
    // Deleted, and the store's work after the write done, which runs in its
    // next alarm: until its app's mark moved (withdrawn.ts).
    drop: async () => {
      let was = await mark()
      await graph.apply(
        file.bundles.filter((b) => !b.representation).map((b) => ({
          entity: b.entity,
          $delete: true,
        })),
        KERNEL,
      )
      for (let n = 0; n < 100 && await mark() == was; n++) {
        await time.advance(100)
        await ring()
      }
    },
    restore: () => graph.apply(structuredClone(file.bundles), KERNEL),
  }
}

let publicBlob = await fixture()
let first = await publicBlob.ask()
let firstText = await first.text()
let policy = await publicBlob.origin()
let control = policy.headers.get('cache-control')
await policy.body?.cancel()

test('repeated upload reads, HEADs and validators are answered at the edge without a kernel or Files call', async () => {
  assertEquals(control, 'public, max-age=30, must-revalidate')
  let inner = publicBlob.inner.misses()
  for (let n = 0; n < 40; n++) {
    let answer = await publicBlob.ask()
    assertEquals(await answer.text(), firstText)
    assertEquals(answer.headers.get('set-cookie'), null)
    assertEquals(
      answer.headers.get('content-type'),
      first.headers.get('content-type'),
    )
    assertEquals(
      answer.headers.get('content-disposition'),
      first.headers.get('content-disposition'),
    )
    assertEquals(answer.headers.get('x-content-type-options'), 'nosniff')
    assertStringIncludes(
      answer.headers.get('content-security-policy')!,
      "script-src 'none'",
    )
    assertEquals(
      answer.headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    )
  }
  let head = await publicBlob.ask({ method: 'HEAD' })
  assertEquals([head.status, await head.text()], [200, ''])
  let conditional = await publicBlob.ask({
    headers: { 'if-none-match': first.headers.get('etag')! },
  })
  assertEquals([conditional.status, await conditional.text()], [304, ''])
  assertEquals([
    publicBlob.forwarded(),
    publicBlob.edge.misses(),
    publicBlob.inner.misses(),
  ], [0, 1, inner])
})

let expiring = await fixture('open')
let primed = await expiring.ask()
await primed.body?.cancel()
await expiring.drop()

test('an upload removed after an edge fill stops serving at expiry and a missing upload is never kept', async () => {
  let control = (await expiring.origin()).headers.get('cache-control')!
  assertEquals(control, UNKEPT)
  await expiring.time.advance(30_000)
  let gone = await expiring.ask()
  assertEquals(gone.status, 404)
  await gone.body?.cancel()
  await expiring.restore()
  let back = await expiring.ask()
  assertEquals(back.status, 200)
  assertEquals(await back.text(), firstText)
})

let stacked = await fixture()
await files.servableOf(
  stacked.env,
  stacked.app,
  storeAt(stacked.space, stacked.app, stacked.env),
  stacked.file.sha,
  stacked.file.path.split('/')[1],
)
await stacked.time.advance(29_000)
await stacked.drop()

test('a Site fill after an upload is deleted asks its store again, however recently Files heard yes', async () => {
  let answer = await stacked.origin()
  assertEquals(answer.status, 204)
  assertEquals(answer.headers.get('cache-control'), UNKEPT)
})

let lasting = await fixture()
let read = async () => {
  let answer = await lasting.ask()
  await answer.body?.cancel()
  return answer.status
}

test('a kept yes outlives every refill until the app withdraws an upload', async () => {
  let reads = [await read()]
  for (let n = 0; n < 3; n++) {
    await lasting.time.advance(31_000)
    reads.push(await read())
  }
  let asked = lasting.asked()
  await lasting.drop()
  await lasting.time.advance(31_000)
  reads.push(await read())
  assertEquals([reads, asked], [[200, 200, 200, 200, 404], 1])
})

let privateBlob = await fixture('private', true)
test('a published private app never exposes its uploads through Site', async () => {
  let answer = await privateBlob.ask()
  assertEquals(answer.status, 401)
  assertEquals(privateBlob.forwarded(), 1)
  assertEquals(privateBlob.inner.misses(), 0)
  await answer.body?.cancel()
})
