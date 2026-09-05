/// <reference lib="deno.ns" />
// Serving an app off the Store on the packages (T-33815): the page, the file
// beside it, and the `/api/*` doors its client speaks — over the workerd
// stand-in, with nothing stubbed between the request and the rows.
//
// The whole point is that TWO wires meet here and the door translates
// (wire.ts): a page sends `{entities: […]}` and reads `{ok, changes, aliases}`
// back, spells its filter as the query string itself, and folds a socket's
// frames — while the Store takes a bare array of bundles, answers the batch as
// applied, reads its line off `?q=`, and pushes `{id, bundles, gone}`. So the
// client is driven the way a page drives it, and what it gets back is what the
// guide says it gets back.
//
// The directory is a Store too, at `yak/platform`, so the space and the app
// this serves are real rows written the way `space_new` and `app_new` write
// them (platform_test.ts is that half on its own).
//
// The ROUTING ORDER is held here as well, at the end: which part answers a
// path — an app, the home app, the platform's own index — is the same door
// asked the same way, and the stand-in is where a home app with a worker can
// be stood up at all (apps.ts `served`, D-34197).
import { assert, assertEquals } from '@std/assert'
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/harness.ts'
import { sign } from '../../src/token.ts'
import * as apps from './apps.ts'
import { directory, storeName } from './directory.ts'
import * as dirPart from './directory.ts'
import { scriptName } from './dispatch.ts'
import type { Env } from './env.ts'
import { Store } from './graph.ts'
import { emptied } from './erase.ts'
import { openIn, serve } from './unseen.ts'
import { PLATFORM_STORE } from './vocab.ts'

// ---- the runtime this Worker is written against ----------------------------

// The streaming HTML rewriter, in the one shape apps.ts asks for it (`reported`
// weaves the reporter into every page): a tag prepended inside the first `head`
// or `body`, else appended to the document. Deno has none, and what a page
// carries out of this door is part of what the door does.
type El = { prepend(s: string, o: { html: boolean }): void }
class Rewriter {
  #on: [string, (el: El) => void][] = []
  #end: ((e: { append(s: string, o: { html: boolean }): void }) => void)[] = []
  on(selector: string, h: { element(el: El): void }) {
    this.#on.push([selector, h.element])
    return this
  }
  onDocument(h: { end(e: { append(s: string, o: unknown): void }): void }) {
    this.#end.push(h.end)
    return this
  }
  transform(res: Response) {
    let done = res.text().then((html) => {
      for (let [selector, element] of this.#on) {
        let at = new RegExp(`<${selector}[^>]*>`, 'i').exec(html)
        if (!at) continue
        element({
          prepend: (s) => {
            let cut = at.index + at[0].length
            html = html.slice(0, cut) + s + html.slice(cut)
          },
        })
      }
      for (let end of this.#end) end({ append: (s) => void (html += s) })
      return new TextEncoder().encode(html)
    })
    return new Response(
      new ReadableStream({
        async start(c) {
          c.enqueue(await done)
          c.close()
        },
      }),
      res,
    )
  }
}
;(globalThis as { HTMLRewriter?: unknown }).HTMLRewriter ??= Rewriter

// ---- the platform, in memory -----------------------------------------------

let state = () => {
  let live: Wire[] = []
  return {
    storage: durable(),
    live,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

// The bucket, as the slice `r2Blobs` asks for.
let bucket = () => {
  let held = new Map<string, Uint8Array>()
  return {
    held,
    r2: {
      head: (k: string) => Promise.resolve(held.get(k) ?? null),
      get: (k: string) =>
        Promise.resolve(
          held.has(k)
            ? { arrayBuffer: () => Promise.resolve(held.get(k)!.buffer) }
            : null,
        ),
      put: (k: string, v: ArrayBuffer | Uint8Array) =>
        Promise.resolve(
          void held.set(k, v instanceof Uint8Array ? v : new Uint8Array(v)),
        ),
      delete: (k: string) => Promise.resolve(void held.delete(k)),
      list: ({ prefix }: { prefix: string }) =>
        Promise.resolve({
          objects: [...held.keys()].filter((k) => k.startsWith(prefix))
            .map((key) => ({ key })),
          truncated: false,
        }),
    },
  }
}

let SECRET = 'a probe secret'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'

// One platform: a Store per name the kernel spells, the bucket the files are
// in, and the platform's own assets off disk (the client an app imports).
let platform = () => {
  let objects = new Map<string, Store>()
  let sockets = new Map<string, Wire[]>()
  let object = (name: string) => {
    let held = objects.get(name)
    if (!held) {
      let ctx = state()
      sockets.set(name, ctx.live)
      objects.set(name, held = new Store(ctx))
    }
    return held
  }
  let files = bucket()
  let env = {
    SESSION_SECRET: SECRET,
    BLOBS: files.r2,
    ASSETS: {
      fetch: async (req: Request) =>
        new Response(
          await Deno.readFile(
            new URL(`./public${new URL(req.url).pathname}`, import.meta.url),
          ),
          { headers: { 'content-type': 'text/javascript' } },
        ),
    },
    STORE: {
      idFromName: (n: string) => n,
      get: (n: unknown) => ({
        fetch: (r: Request) => Promise.resolve(object(String(n)).fetch(r)),
      }),
    },
    // Nobody is listening: a break is still written, and telling its members
    // about it is the half that may fail without taking the write with it.
    WIRE: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: () => Promise.resolve(new Response(null, { status: 204 })),
      }),
    },
  } as unknown as Env
  return { env, files, object, sockets }
}

// A signed-in person, as the browser carries them.
let as = async (person: string) =>
  `yak_session=${await sign(
    { person, space: null, exp: Date.now() + 60_000 },
    SECRET,
  )}`

// The space and the app, written the way `space_new` and `app_new` write them.
let seeded = async (env: Env, access = 'public') => {
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: 'ada' },
        space: { slug: 'ada' },
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  let space = (await dir.space('ada'))!
  await dir.apply({
    entities: [{
      entity: { eid: '$app' },
      doc: { title: 'Cookbook' },
      app: { slug: 'cookbook', space: space.eid, version: 1, access },
      alias: { slug: 'ada/cookbook' },
    }],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  let app = (await dir.app(space, 'cookbook'))!
  return { dir, space, app }
}

// One request at the app's own address.
let visit = (path: string, init: RequestInit = {}) =>
  new Request(`https://ada.yaks.app${path}`, init)

// The app's own graph, driven the way `public/client.js` drives it.
let client = (env: Env, cookie?: string) => {
  let door = async (path: string, init: RequestInit = {}) => {
    let res = await apps.fetch(
      visit(`/cookbook/api/${path}`, {
        ...init,
        headers: { ...(init.headers as object), ...(cookie ? { cookie } : {}) },
      }),
      env,
    )
    let body = await res.text()
    if (!res.ok) throw new Error(`${res.status} ${body}`)
    return body ? JSON.parse(body) : null
  }
  return {
    apply: (bundles: unknown[]) =>
      door('apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entities: bundles }),
      }) as Promise<{
        ok: boolean
        changes: { eid: string; name: string }[]
        aliases: Record<string, string>
      }>,
    query: (filter = '') =>
      door(`query?${filter}`) as Promise<Record<string, unknown>[]>,
    search: (text: string, filter = '') =>
      door(
        `query?${encodeURIComponent(text)}${filter ? `&${filter}` : ''}`,
      ) as Promise<Record<string, unknown>[]>,
    me: () => door('me') as Promise<Record<string, unknown>>,
  }
}

let CAKE = 'c0000000-0000-4000-8000-00000000cake'.replace('cake', '0001')

// ---- the tests -------------------------------------------------------------

Deno.test('a page is served with its base and its reporter', async () => {
  let { env, files } = platform()
  await seeded(env)
  files.held.set(
    'ada/cookbook/index.html',
    new TextEncoder().encode('<!doctype html><head></head><body>hi</body>'),
  )
  let page = await apps.fetch(visit('/cookbook/'), env)
  assertEquals(page.status, 200)
  let html = await page.text()
  assert(html.includes('<base href="/cookbook/">'), html)
  assert(html.includes('src="/cookbook/api/report.js"'), html)
  // And the client an app imports is the platform's own file, beside the
  // doors it wraps.
  let js = await apps.fetch(visit('/cookbook/api/client.js'), env)
  assertEquals(js.status, 200)
  assert((await js.text()).includes('export let store ='))
})

Deno.test('the page wire: apply, query and search round-trip', async () => {
  let { env } = platform()
  await seeded(env)
  let page = client(env, await as(ADA))

  // The page's own envelope in, the page's own answer out — the shape the
  // guide documents and every deployed app reads.
  let wrote = await page.apply([{
    entity: { eid: '$cake' },
    doc: { title: 'Lemon drizzle', body: 'three lemons and a lemon' },
  }])
  assertEquals(wrote.ok, true)
  let eid = wrote.aliases.$cake
  assert(eid, 'the alias said what it minted')
  assert(wrote.changes.some((c) => c.eid == eid && c.name == 'doc'))

  // The filter grammar is the page's: the query string itself, and a row
  // carries the components the filter names, under the word it is called by.
  let [row] = await page.query('.doc!')
  assertEquals(row.kind, 'doc')
  assertEquals((row.entity as { eid: string }).eid, eid)
  assertEquals((row.doc as { title: string }).title, 'Lemon drizzle')

  // An address, in the page's own spelling.
  assertEquals((await page.query(`id=${eid}`)).length, 1)

  // Full text over the docs, and the platform's own rows stay out of the
  // answer: the store minted a `person` row for the writer.
  let hits = await page.search('drizzle')
  assertEquals(hits.length, 1)
  assertEquals((hits[0].entity as { eid: string }).eid, eid)
  // And over the BODY, which is the half a blob address could have eaten:
  // `doc.body` is swapped for its SHA-256 before the row is written
  // (@yaks/blob `store: "blob"`), so the index is told how to read one back
  // (T-33978) — a word only the body says still finds the doc, and the
  // snippet it comes back with is the prose, not the hash.
  let deep = await page.search('lemons')
  assertEquals(deep.length, 1)
  assertEquals((deep[0].entity as { eid: string }).eid, eid)
  assert(
    String((deep[0].rank as { snip: string }).snip).includes('lemons'),
    JSON.stringify(deep[0].rank),
  )
  // The store minted a `person` row for the writer, and it is the platform's
  // bookkeeping rather than anything anyone saved: it stays out of a question
  // that did not name it (C-32607 item 4 — `.created!` dragged every one in),
  // and comes back when one does.
  assertEquals((await page.query('.created!')).length, 1)
  assertEquals((await page.query('.person!')).length, 1)
})

Deno.test('a subscription is that query still answering', async () => {
  let { env, object, sockets } = platform()
  await seeded(env)
  let name = 'ada/cookbook'
  // The upgrade goes to the object itself, so the socket is driven the way the
  // runtime drives a hibernated one.
  let sent: Record<string, unknown>[] = []
  let ws: Wire = {
    send: (data: string) => void sent.push(JSON.parse(data)),
    serializeAttachment: () => {},
    deserializeAttachment: () => null,
  }
  // The object plants its tables when the kernel first names it, so the store
  // is reached the way every store is reached first: through a request.
  let page = client(env, await as(ADA))
  assertEquals(await page.query('.doc!'), [])
  sockets.get(name)!.push(ws)
  object(name).webSocketMessage(
    ws,
    JSON.stringify({ subscribe: '.doc!&.person=', id: '1:.doc!' }),
  )
  assertEquals(sent, [{ id: '1:.doc!', bundles: [] }])

  await page.apply([{ entity: { eid: CAKE }, doc: { title: 'Lemon drizzle' } }])
  assertEquals(sent.length, 2)
  let frame = sent[1] as { id: string; bundles: Record<string, unknown>[] }
  assertEquals(frame.id, '1:.doc!')
  // The same row `query()` answers with, kind and all — a page swaps one for
  // the other and nothing else changes.
  assertEquals(frame.bundles[0].kind, 'doc')
  assertEquals((frame.bundles[0].entity as { eid: string }).eid, CAKE)
})

Deno.test('an open app takes a write from nobody, and a public one does not', async () => {
  let open = platform()
  await seeded(open.env, 'open')
  let stranger = client(open.env)
  let wrote = await stranger.apply([
    { entity: { eid: CAKE }, doc: { title: 'a vote' } },
  ])
  assertEquals(wrote.ok, true)
  // Unattributed: nobody signed it, so nothing claims they did.
  let [row] = await stranger.query('.doc!&.created?')
  assertEquals((row.created as { by: string | null }).by, null)

  // The same write on a `public` app is the member guard's no, said in the
  // sentence a page shows its person.
  let shut = platform()
  await seeded(shut.env, 'public')
  let no = await apps.fetch(
    visit('/cookbook/api/apply', {
      method: 'POST',
      body: JSON.stringify({ entities: [{ entity: { eid: CAKE }, doc: {} }] }),
    }),
    shut.env,
  )
  assertEquals(no.status, 401)
  let said = await no.json()
  assertEquals(said.error.code, 'not_a_writer')
  assert(said.error.signIn.includes('/login'), said.error.signIn)
})

Deno.test('a break is the platform writing about the app, not in it', async () => {
  let { env } = platform()
  let { space, app } = await seeded(env, 'private')
  // The report door takes anyone: a break belongs to whoever was looking.
  let filed = await apps.fetch(
    visit('/cookbook/api/report', {
      method: 'POST',
      body: JSON.stringify({
        message: 'x is not a function',
        url: '/cookbook/',
      }),
    }),
    env,
  )
  assertEquals(filed.status, 204)
  // It landed under the kernel's own door — no person vouched, no level held,
  // and the member guard stands down for the platform's own row.
  let who = { person: ADA, role: 'owner' as const }
  let open = await openIn(env, space, app, who, true)
  assertEquals(open.length, 1)
  assertEquals(open[0].kind, 'exception')
  assertEquals(open[0].exception?.message, 'x is not a function')
  assertEquals(open[0].exception?.version, 1)
  // Served once, and marked so the next reply is quiet about it.
  assertEquals((await serve(env, space, who, app)).length, 1)
  assertEquals((await openIn(env, space, app, who)).length, 0)
})

Deno.test('DELETE / empties the app store and bears it again', async () => {
  let { env, object, files } = platform()
  let { space, app } = await seeded(env)
  let page = client(env, await as(ADA))
  await page.apply([{ entity: { eid: CAKE }, doc: { title: 'Lemon drizzle' } }])
  assertEquals((await page.query('.doc!')).length, 1)
  files.held.set('ada/cookbook/index.html', new Uint8Array([1]))

  await emptied(env, space, app, { person: ADA, role: 'owner' })

  // The bytes went with it, and the store is a planted, empty graph — not one
  // with no tables at all, which is what an app made later here would wake in.
  assertEquals(files.held.size, 0)
  assertEquals((await page.query('.doc!')).length, 0)
  assertEquals(
    (await object(storeName(space, app)).fetch(
      new Request('http://store/graph', {
        headers: { 'x-store': storeName(space, app) },
      }),
    ).then((r) => r.json())).db,
    `do:${storeName(space, app)}`,
  )
  // And the directory is untouched: emptying a store is not burying a row.
  assert(
    await directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
      .space('ada'),
  )
  assert(PLATFORM_STORE)
})

// ---- the routing order (apps.ts `served`, D-34197) --------------------------

// One rung a test, over the same stand-in: which PART answers a path is the
// whole of what these hold, so each one asks an address whose answer only the
// rung it names can give.
//
// The home app's worker is a stub. A dispatch namespace is remote-only — there
// is no workerd implementation and `wrangler dev` leaves the binding undefined
// (dispatch.ts) — so what the seam itself does with a grant is dispatch_test.ts
// and what is proved here is that the kernel ASKS it, and where in the order.
// The `/.well-known/` half of rung 1 is decided before this part (route.ts
// `platform`, index.ts) and is held in route_test.ts and home_test.ts.

// The space, `cookbook` as its home app, `garden` beside it, and a home worker
// where one is given: an app answering `.get` for no other script is an app
// with no worker, which is the message the runtime knows one by.
let router = async (worker?: (req: Request) => Response) => {
  let { env, files } = platform()
  let { dir, space, app } = await seeded(env)
  let by = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }
  await dir.apply({
    entities: [
      {
        entity: { eid: '$garden' },
        doc: { title: 'Garden' },
        app: { slug: 'garden', space: space.eid, version: 1, access: 'public' },
        alias: { slug: 'ada/garden' },
      },
      { entity: { eid: space.eid }, space: { home: app.eid } },
    ],
  }, by)
  let script = scriptName(storeName(space, app))
  ;(env as { DISPATCH?: unknown }).DISPATCH = {
    get: (name: string) => {
      if (!worker || name != script) {
        throw new Error('Worker not found: ' + name)
      }
      return { fetch: (r: Request) => Promise.resolve(worker(r)) }
    },
  }
  return {
    env,
    at: (path: string) => apps.fetch(visit(path), env),
    put: (key: string, body: string) =>
      files.held.set(key, new TextEncoder().encode(body)),
  }
}

Deno.test('rung 1: a platform path never reaches an app', async () => {
  let k = await router(() => new Response('the router', { status: 200 }))
  // The store doors are the kernel's, under an app's slug and at the home
  // app's bare root alike: a home worker that answers everything else does not
  // answer these.
  for (let path of ['/cookbook/api/graph', '/api/graph']) {
    assertEquals((await (await k.at(path)).json()).db, 'do:ada/cookbook')
  }
  // And `/<x>/api/…` at an app that is not here is a 404 rather than the home
  // app's page: a page asking a store at a wrong address must not be handed
  // HTML it cannot parse.
  assertEquals((await k.at('/gone/api/query')).status, 404)
})

Deno.test("rung 2: an app's slug wins over the home app", async () => {
  let k = await router(() => new Response('the router', { status: 200 }))
  k.put('ada/garden/index.html', '<!doctype html><body>garden</body>')
  let page = await k.at('/garden/')
  assertEquals(page.status, 200)
  assert((await page.text()).includes('garden'))
  // Even where the app has nothing there: the segment is the garden app's, so
  // the home app and its worker are not asked at all.
  assertEquals((await k.at('/garden/nothing.txt')).status, 404)
})

Deno.test("rung 3: the home app's files answer the bare hostname", async () => {
  let k = await router()
  k.put('ada/cookbook/index.html', '<!doctype html><body>cookbook</body>')
  k.put('ada/cookbook/photo.png', 'not really a png')
  assertEquals(await (await k.at('/photo.png')).text(), 'not really a png')
  // A path behind no file whose last segment names no file type is a route,
  // not a miss: the app's own page answers it (files.ts `pretty`).
  assert((await (await k.at('/about')).text()).includes('cookbook'))
})

Deno.test("rung 4: the space's index is `/`'s last word", async () => {
  // A home app with a front page keeps `/`.
  let k = await router()
  k.put('ada/cookbook/index.html', '<!doctype html><body>cookbook</body>')
  assert((await (await k.at('/')).text()).includes('cookbook'))

  // Without one, `/` is the index — the space EXISTS, so its own address is a
  // door and not a 404 — while a path under it is still nothing.
  let bare = await router()
  let listed = await bare.at('/')
  assertEquals(listed.status, 200)
  assert((await listed.text()).includes('href="/garden/"'))
  assertEquals((await bare.at('/nothing.txt')).status, 404)

  // A home worker that PASSES on `/` (its 404 is the pass verdict) leaves the
  // index to answer, and one that owns it wins: the index is what is left when
  // neither half of the home app has anything there.
  let passing = await router(() => new Response('no', { status: 404 }))
  assert((await (await passing.at('/')).text()).includes('href="/garden/"'))
  let own = await router(() => new Response('the router', { status: 200 }))
  assertEquals(await (await own.at('/')).text(), 'the router')
})

Deno.test('rung 5: everything else is the home worker, else 404', async () => {
  let k = await router((req) =>
    new Response(`ran ${new URL(req.url).pathname}`)
  )
  // Its files do not shadow it: the worker is asked first, exactly as it is
  // under an app's own slug, so it sees every path no other app claims.
  k.put('ada/cookbook/index.html', '<!doctype html><body>cookbook</body>')
  k.put('ada/cookbook/photo.png', 'not really a png')
  for (let path of ['/about', '/photo.png', '/deep/anything']) {
    assertEquals(await (await k.at(path)).text(), `ran ${path}`, path)
  }
  // And where the worker passes, its files answer behind it.
  let some = await router((req) =>
    new URL(req.url).pathname == '/menu'
      ? new Response('the menu')
      : new Response('no', { status: 404 })
  )
  some.put('ada/cookbook/photo.png', 'not really a png')
  assertEquals(await (await some.at('/menu')).text(), 'the menu')
  assertEquals(await (await some.at('/photo.png')).text(), 'not really a png')
  // No worker and no file is the 404 at the end of the order.
  let plain = await router()
  assertEquals((await plain.at('/nothing.txt')).status, 404)
})
