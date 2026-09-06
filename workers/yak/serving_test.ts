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
// The runtime this Worker is written against — the HTML rewriter, a Durable
// Object's state, the bucket, the Store namespace — is harness.ts's, shared
// with builder_test.ts.
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import type { Wire } from '@yaks/durable-object'
import { slow } from '../../src/testing.ts'
import { sign } from '../../src/token.ts'
import * as apps from './apps.ts'
import { directory, stamp, storeName } from './directory.ts'
import * as dirPart from './directory.ts'
import { scriptName } from './dispatch.ts'
import type { Env } from './env.ts'
import { added, asked } from './examples/shop/cart.js'
import { analytics, dataset, platform as inMemory } from './harness.ts'
import { emptied, trash, trashSpace } from './erase.ts'
import { signed, stripe } from './probe.ts'
import * as sell from './sell.ts'
import { call, type Ctx, wrote } from './tools.ts'
import { archive, openIn, serve } from './unseen.ts'
import { PLATFORM_STORE } from './vocab.ts'

let SECRET = 'a probe secret'

let platform = () => inMemory(SECRET)
let ADA = 'a0000000-0000-4000-8000-0000000000ad'

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
      former: { slug: 'ada/cookbook' },
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

Deno.test('an app is installable: the two links, the icon, the manifest', async () => {
  let { env, files } = platform()
  await seeded(env)
  files.held.set(
    'ada/cookbook/index.html',
    new TextEncoder().encode(
      '<!doctype html><head><meta name="theme-color" content="#1b3a2f">' +
        '</head><body>hi',
    ),
  )
  let html = await (await apps.fetch(visit('/cookbook/'), env)).text()
  assert(
    html.includes('<link rel="apple-touch-icon" href="/cookbook/icon.png">'),
    html,
  )
  assert(
    html.includes(
      '<link rel="manifest" href="/cookbook/manifest.webmanifest">',
    ),
    html,
  )

  // The app wrote no icon, so the address the head names is the platform's
  // own tile rather than a 404 — an installed app is never blank.
  let icon = await apps.fetch(visit('/cookbook/icon.png'), env)
  assertEquals(icon.status, 200)
  assertEquals(icon.headers.get('content-type'), 'image/png')
  let tile = await Deno.readFile(
    new URL('./public/connector-512.png', import.meta.url),
  )
  assertEquals(new Uint8Array(await icon.arrayBuffer()), tile)

  // And the manifest, generated from the app and the colour its page states.
  let got = await apps.fetch(visit('/cookbook/manifest.webmanifest'), env)
  assertEquals(got.status, 200)
  assertEquals(got.headers.get('content-type'), 'application/manifest+json')
  assertEquals(await got.json(), {
    name: 'Cookbook',
    short_name: 'Cookbook',
    start_url: '/cookbook/',
    scope: '/cookbook/',
    display: 'standalone',
    background_color: '#1b3a2f',
    theme_color: '#1b3a2f',
    icons: [
      { src: '/cookbook/icon.png', type: 'image/png', sizes: '512x512' },
      { src: '/cookbook/icon.png', type: 'image/png', sizes: '192x192' },
    ],
  })

  // An app that wrote its own is served its own, at both addresses: the
  // fallback is only ever what a miss answers.
  files.held.set('ada/cookbook/icon.png', new TextEncoder().encode('mine'))
  files.held.set(
    'ada/cookbook/manifest.webmanifest',
    new TextEncoder().encode('{"name":"Ours"}'),
  )
  let own = await apps.fetch(visit('/cookbook/icon.png'), env)
  assertEquals(await own.text(), 'mine')
  let theirs = await apps.fetch(visit('/cookbook/manifest.webmanifest'), env)
  assertEquals(await theirs.json(), { name: 'Ours' })
})

Deno.test('a page view is one data point, and it names no visitor', async () => {
  let seen = dataset()
  let { env, files } = inMemory(SECRET, { VIEWS: seen })
  let { app } = await seeded(env)
  files.held.set(
    'ada/cookbook/index.html',
    new TextEncoder().encode('<!doctype html><body>hi</body>'),
  )
  files.held.set('ada/cookbook/style.css', new TextEncoder().encode('b{}'))
  let visitor = {
    'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0.0.0',
    referer: 'https://news.example.com/a/story?q=my+search',
    // What a proxy in front of us would have added, and what an app's own
    // worker sees: neither may reach the dataset.
    'cf-connecting-ip': '203.0.113.7',
    cookie: await as(ADA),
  }
  let page = await apps.fetch(visit('/cookbook/', { headers: visitor }), env)
  assertEquals(page.status, 200)
  await page.text()
  assertEquals(seen.points.length, 1)
  assertEquals(seen.points[0], {
    indexes: [app.eid],
    blobs: [
      'ada',
      'cookbook',
      '/cookbook/',
      // The harness is not workerd, so a request carries no `cf` — the column
      // is there and empty, which is what an unknown country looks like.
      '',
      'news.example.com',
      'browser',
    ],
    doubles: [200],
  })
  // Nothing about the person who asked is anywhere in the point.
  let written = JSON.stringify(seen.points[0])
  for (let secret of ['203.0.113.7', ADA, 'Mozilla', 'yak_session', 'Chrome']) {
    assert(!written.includes(secret), `${secret} is in the data point`)
  }
  // A stylesheet is not a page, a wrong address is not a view, and the
  // platform's own space index is not an app's page.
  await (await apps.fetch(visit('/cookbook/style.css'), env)).text()
  await (await apps.fetch(visit('/cookbook/gone.html'), env)).text()
  await (await apps.fetch(visit('/'), env)).text()
  await (await apps.fetch(visit('/cookbook/api/query'), env)).text()
  assertEquals(seen.points.length, 1)
})

// What the fake SQL API answers each of the four queries with.
let ROWS: Record<string, Record<string, unknown>[]> = {
  day: [{ day: `${new Date().toISOString().slice(0, 10)} 00:00:00`, views: 5 }],
  path: [{ path: '/cookbook/dinner', views: '4' }],
  site: [{ site: 'news.example.com', views: 3 }],
  country: [{ country: 'US', views: 5 }],
}

let rowsFor = (sql: string) =>
  ROWS[Object.keys(ROWS).find((k) => sql.includes(` AS ${k},`)) ?? ''] ?? []

Deno.test("/api/stats answers the app's own people, and nobody else", async () => {
  let api = analytics(rowsFor)
  try {
    let { env } = inMemory(SECRET, {
      CF_ACCOUNT: 'acc0unt',
      ANALYTICS_TOKEN: 'a token',
    })
    await seeded(env)
    let mine = await apps.fetch(
      visit('/cookbook/api/stats', { headers: { cookie: await as(ADA) } }),
      env,
    )
    assertEquals(mine.status, 200)
    let said = await mine.json()
    assertEquals(said.on, true)
    assertEquals(said.total, 5)
    assertEquals(said.daily.length, 30)
    assertEquals(said.pages, [{ name: '/cookbook/dinner', views: 4 }])
    assertEquals(said.from, [{ name: 'news.example.com', views: 3 }])
    // Four queries, all of them scoped to this app and all of them sampled.
    assertEquals(api.asked.length, 4)
    for (let q of api.asked) assertStringIncludes(q, 'sum(_sample_interval)')

    // A public app's PAGES are the world's; its visitor counts are not.
    let theirs = await apps.fetch(visit('/cookbook/api/stats'), env)
    assertEquals(theirs.status, 401)
    await theirs.body?.cancel()
  } finally {
    api.done()
  }
})

Deno.test('/api/stats with no analytics token is a sentence, not a failure', async () => {
  let { env } = platform()
  await seeded(env)
  let door = await apps.fetch(
    visit('/cookbook/api/stats', { headers: { cookie: await as(ADA) } }),
    env,
  )
  assertEquals(door.status, 200)
  let said = await door.json()
  assertEquals(said.on, false)
  assertStringIncludes(said.say, 'not switched on')
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

Deno.test('a bulk load is NDJSON in and NDJSON out, refusal and all', async () => {
  let { env } = platform()
  await seeded(env)
  let cookie = await as(ADA)
  let page = client(env, cookie)
  // The door counts the bytes and hands the load to the store as it came: one
  // bundle per line, applied in chunks (@yaks/api `pour`), and its answer
  // handed back the same way rather than folded into the page's envelope.
  let poured = (body: string) =>
    apps.fetch(
      visit('/cookbook/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/x-ndjson', cookie },
        body,
      }),
      env,
    )
  let lines = async (r: Response) =>
    (await r.text()).split('\n').filter((l) => l.trim()).map((l) =>
      JSON.parse(l)
    )

  let made = Array.from(
    { length: 3 },
    (_, i) =>
      JSON.stringify({
        entity: { eid: `$r${i}` },
        doc: { title: `Recipe ${i}` },
      }),
  )
  let wrote = await poured(made.join('\n'))
  assertEquals(wrote.status, 200)
  assertEquals(wrote.headers.get('content-type'), 'application/x-ndjson')
  let saved = await lines(wrote)
  assertEquals(saved.length, 3)
  assertEquals(saved[0].doc.title, 'Recipe 0')
  assertEquals((await page.query('.doc!')).length, 3)

  // A bad line is the LAST line of the answer, and it says which line it was.
  let no = await lines(
    await poured([
      JSON.stringify({ entity: { eid: '$ok' }, doc: { title: 'Fine' } }),
      JSON.stringify({ entity: { eid: '$no' }, doc: { name: 'not a column' } }),
    ].join('\n')),
  )
  assertEquals(no.length, 1)
  assertEquals(no[0].error, 'Refused')
  assertEquals(no[0].line, 2)
  assertEquals(no[0].committed, 0)
  // Its chunk rolled back whole: the good line beside it landed nothing.
  assertEquals((await page.query('.doc!')).length, 3)
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

Deno.test('writing the file a break named closes it (T-34338)', async () => {
  let { env } = platform()
  let { space, app } = await seeded(env)
  let who = { person: ADA, role: 'owner' as const }
  // The break the feedback letter was about: a page reporting that the script
  // it wanted never loaded, from before anyone had written that script.
  for (let url of ['/cookbook/app.js', '/cookbook/']) {
    await apps.fetch(
      visit('/cookbook/api/report', {
        method: 'POST',
        body: JSON.stringify({ message: `failed to load ${url}`, url }),
      }),
      env,
    )
  }
  assertEquals((await openIn(env, space, app, who, true)).length, 2)

  await wrote(env, space, app, who, [
    { path: 'app.js', bytes: new TextEncoder().encode('let go = 1') },
  ])

  // The one that named app.js is answered by those bytes; the one on the page
  // itself is not, and stays open.
  let open = await openIn(env, space, app, who, true)
  assertEquals(open.length, 1)
  assertEquals(open[0].exception?.request, 'page /cookbook/')
})

Deno.test('seen closes a whole deploy at once (T-34338)', async () => {
  let { env } = platform()
  let { space, app } = await seeded(env)
  let who = { person: ADA, role: 'owner' as const }
  for (let n of [1, 2]) {
    await apps.fetch(
      visit('/cookbook/api/report', {
        method: 'POST',
        body: JSON.stringify({ message: `boom ${n}`, url: '/cookbook/' }),
      }),
      env,
    )
  }
  // One word, no ids: everything up to and including the version they are on.
  assertEquals(await archive(env, space, app, who, ['v1']), 2)
  assertEquals((await openIn(env, space, app, who, true)).length, 0)
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
// with no worker, which is the message the runtime knows one by. `first` is a
// column of the `home` component the front page wears, written the way
// `app_set` writes it.
let router = async (
  worker?: (req: Request) => Response | Promise<Response>,
  first?: string[],
) => {
  let { env, files } = platform()
  let { dir, space, app } = await seeded(env)
  let by = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }
  await dir.apply({
    entities: [
      {
        entity: { eid: '$garden' },
        doc: { title: 'Garden' },
        app: { slug: 'garden', space: space.eid, version: 1, access: 'public' },
        former: { slug: 'ada/garden' },
      },
      {
        entity: { eid: app.eid },
        home: first ? { first: JSON.stringify(first) } : {},
      },
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
    dir,
    space,
    app,
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

// ---- rung 1½: `router.first` (T-34201) --------------------------------------

// The home app has named `/garden/*`, so the garden app's own paths are the
// home worker's first. Garden's page is what "the router was skipped" looks
// like: whatever else happened, the app that owns the path answered.
let ADA_OWNS = { 'x-yak-person': ADA, 'x-yak-role': 'owner' }
let OWNER = { person: ADA, role: 'owner' as const }

let fronted = async (
  worker: (req: Request) => Response | Promise<Response>,
) => {
  let k = await router(worker, ['/garden/*'])
  k.put('ada/garden/index.html', '<!doctype html><body>garden</body>')
  return k
}

Deno.test('rung 1½: a `first` glob hands the path to the home worker', async () => {
  let seen: string[] = []
  let k = await fronted((req) => {
    seen.push(new URL(req.url).pathname)
    return new Response('the router')
  })
  assertEquals(await (await k.at('/garden/print')).text(), 'the router')
  // The path as the visitor asked it, whole — not the `/print` the garden
  // app's own worker would have been handed.
  assertEquals(seen, ['/garden/print'])
})

Deno.test("rung 1½: the router's 404 passes, and the app answers", async () => {
  let k = await fronted(() => new Response('no', { status: 404 }))
  assertStringIncludes(await (await k.at('/garden/print')).text(), 'garden')
})

Deno.test('rung 1½: a router that throws is skipped, and written on the home app', async () => {
  let k = await fronted(() => {
    throw new Error('the router fell over')
  })
  assertStringIncludes(await (await k.at('/garden/print')).text(), 'garden')
  // The break is the HOME app's — its code fell over — and it names the path
  // it fell over on. The app that answered wears nothing.
  let open = await openIn(k.env, k.space, k.app, OWNER, true)
  assertEquals(open.length, 1)
  assertEquals(open[0].exception?.message, 'the router fell over')
  assertStringIncludes(open[0].exception?.request ?? '', '/garden/print')
  let garden = (await k.dir.app(k.space, 'garden'))!
  assertEquals((await openIn(k.env, k.space, garden, OWNER, true)).length, 0)
})

slow(
  'rung 1½: a router that hangs is skipped when its patience runs out',
  async () => {
    let k = await fronted(() => new Promise<Response>(() => {}))
    assertStringIncludes(await (await k.at('/garden/print')).text(), 'garden')
    let open = await openIn(k.env, k.space, k.app, OWNER, true)
    assertEquals(open.length, 1)
    assertStringIncludes(open[0].exception?.message ?? '', 'did not answer')
  },
)

Deno.test('rung 1½: a glob over a store door never takes it', async () => {
  let k = await fronted(() => new Response('the router'))
  // `/garden/*` covers `/garden/api/…` by its own shape, and the store doors
  // are the kernel's however the column is written (router.ts PLATFORM_PATHS).
  assertEquals(
    (await (await k.at('/garden/api/graph')).json()).db,
    'do:ada/garden',
  )
})

Deno.test('rung 1½: the router acts as the caller, not as the app it fronts', async () => {
  let env: Env
  let k = await fronted(async () => {
    let asked = await apps.fetch(visit('/garden/api/query?.doc!'), env)
    return new Response(String(asked.status))
  })
  env = k.env
  // Garden shuts its door: only its members see it at all.
  let garden = (await k.dir.app(k.space, 'garden'))!
  await k.dir.apply({
    entities: [{ entity: { eid: garden.eid }, app: { access: 'private' } }],
  }, ADA_OWNS)
  // The visitor is nobody, so the router is nobody: what it reads at another
  // app's store is the refusal the visitor would have read.
  assertEquals(await (await k.at('/garden/print')).text(), '401')
})

Deno.test("rung 1½: the router's own onward request is not intercepted again", async () => {
  let env: Env
  let ran = 0
  let k = await fronted(async (req) => {
    ran++
    // The grant the kernel handed it, forwarded — which is what the router's
    // own `env.STORE`/`env.FILES` calls carry (dispatch.ts SHIM). A request
    // wearing one lands on the app that owns the path, or this is a loop.
    let asked = await apps.fetch(
      new Request(visit('/garden/print'), { headers: req.headers }),
      env,
    )
    return new Response(`behind me: ${await asked.text()}`)
  })
  env = k.env
  assertStringIncludes(await (await k.at('/garden/print')).text(), 'garden')
  assertEquals(ran, 1)
})

// ---- the trash (T-34430) ----------------------------------------------------

// An app in the trash keeps its address and answers nothing at it. To the web
// that is the same nothing a wrong address gets — whether an app was ever here
// is not a stranger's business — and to the owner it is the one page that says
// where the app went and how long they have.
Deno.test('an app in the trash serves nothing, and says so to its owner', async () => {
  let k = await router()
  k.put('ada/garden/index.html', '<!doctype html><body>garden</body>')
  let garden = (await k.dir.app(k.space, 'garden'))!
  assertEquals((await k.at('/garden/')).status, 200)

  await trash(k.env, k.dir, k.space, garden, { person: ADA, role: 'owner' })
  let stranger = await k.at('/garden/')
  assertEquals(stranger.status, 404)
  assertStringIncludes(await stranger.text(), 'Nothing here yet')
  // Its files are not reachable underneath it either — the gate is the app,
  // not the page.
  assertEquals((await k.at('/garden/index.html')).status, 404)

  let cookie = await as(ADA)
  let mine = await apps.fetch(visit('/garden/', { headers: { cookie } }), k.env)
  assertEquals(mine.status, 404)
  let said = await mine.text()
  assertStringIncludes(said, 'Garden is in the trash')
  assertStringIncludes(said, '30 more days')
})

// The front page is a word ON the app (T-34227), so a trashed app that wears
// it is still wearing it — and the space is a space with no front page until
// it comes back. The restore itself is a form on that space's own page: no
// assistant, no script, one POST.
Deno.test("a trashed front page is nobody's, and the owner restores it there", async () => {
  let k = await router()
  k.put('ada/cookbook/index.html', '<!doctype html><body>cookbook</body>')
  k.put('ada/garden/index.html', '<!doctype html><body>garden</body>')
  await trash(k.env, k.dir, k.space, k.app, { person: ADA, role: 'owner' })

  // `/` is the space's index again, listing the app that is still here.
  let bare = await k.at('/')
  assertEquals(bare.status, 200)
  let listed = await bare.text()
  assert(listed.includes('href="/garden/"'))
  assertEquals(listed.includes('href="/cookbook/"'), false)
  // And a visitor is told nothing about what was deleted.
  assertEquals(listed.includes('In the trash'), false)

  // What the owner sees on that page instead — the trash under the pills, with
  // its restore button — is pages.ts's own, drawn straight in home_test.ts:
  // reaching the owner block through this stand-in would ask the OAuth
  // provider whether an agent has ever connected, and that is workerd's.
  //
  // The button itself is this door. One POST to the page it is on, and the
  // app is back — front page and all, because the word was never taken off it.
  let cookie = await as(ADA)
  let back = await apps.fetch(
    visit('/', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://ada.yaks.app',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ restore: 'cookbook' }).toString(),
    }),
    k.env,
  )
  assertEquals(back.status, 303)
  assertStringIncludes(await (await k.at('/')).text(), 'cookbook')
})

// A SPACE in the trash answers nothing at any of its addresses (T-34431) —
// ahead of every rung of the order above, since none of them is reached. Its
// owner is the exception, and the page they get carries the one button that
// brings the space back.
Deno.test('a space in the trash serves nothing, and its owner restores it', async () => {
  let k = await router()
  k.put('ada/cookbook/index.html', '<!doctype html><body>cookbook</body>')
  k.put('ada/garden/index.html', '<!doctype html><body>garden</body>')
  assertEquals((await k.at('/')).status, 200)

  await trashSpace(k.env, k.dir, k.space, { person: ADA, role: 'owner' })
  // Every address under it, whichever rung would have answered: the front
  // page, an app of its own, a file, and an app's store door.
  for (
    let path of ['/', '/garden/', '/cookbook/index.html', '/garden/api/query']
  ) {
    let out = await k.at(path)
    assertEquals(out.status, 404, path)
    assertStringIncludes(await out.text(), 'Nothing here yet')
  }

  // The owner, and only them: the page says where the space went, how long
  // they have, and it says it at every address rather than only at `/`.
  let cookie = await as(ADA)
  let mine = await apps.fetch(visit('/garden/', { headers: { cookie } }), k.env)
  assertEquals(mine.status, 404)
  let said = await mine.text()
  assertStringIncludes(said, 'ada is in the trash')
  assertStringIncludes(said, '30 more days')
  assertStringIncludes(said, 'name="restore-space" value="ada"')

  // The button. One POST to the page it is on, no script, and the space is
  // serving again — every app of it, exactly as it was.
  let back = await apps.fetch(
    visit('/', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://ada.yaks.app',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ 'restore-space': 'ada' }).toString(),
    }),
    k.env,
  )
  assertEquals(back.status, 303)
  assertEquals((await k.at('/garden/')).status, 200)
  assertStringIncludes(await (await k.at('/')).text(), 'cookbook')
})

// ---- env.APP: the worker as the app's own gatekeeper (T-34303) --------------

// The RSVP shape, end to end over the same stand-in: a `private` app nobody
// may read, and a worker route that checks an invitation code and writes the
// one row it names as the APP. The grant is spent the way the shim spends it
// (dispatch.ts SHIM) — under GRANT, on the app's own door — because the shim
// runs inside the dispatch namespace and this harness stands where that
// namespace would be.
Deno.test('env.APP: a private app is written by its own worker, and by nobody else', async () => {
  let env: Env
  let door = (req: Request, path: string, init: RequestInit = {}) =>
    apps.fetch(
      new Request(visit(path), {
        ...init,
        headers: {
          ...(init.headers as object),
          // `env.APP`: the app itself. `env.STORE` and `env.FILES` forward
          // `x-yak-grant`, which is this visitor.
          'x-yak-grant': req.headers.get('x-yak-app-grant') ?? '',
        },
      }),
      env,
    )
  let k = await router(async (req) => {
    let url = new URL(req.url)
    if (url.pathname == '/rsvp') {
      // THE CHECK COMES FIRST, and its refusal says nothing else.
      if (url.searchParams.get('code') != 'OPEN-SESAME') {
        return new Response('no invitation by that code', { status: 403 })
      }
      let wrote = await door(req, '/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entities: [{ doc: { title: 'The Okonkwos' } }],
        }),
      })
      return new Response(await wrote.text(), { status: wrote.status })
    }
    // The app's own page, which the gate would otherwise hide from the guest
    // holding the card: the worker reads it and decides.
    if (url.pathname == '/card') {
      return apps.fetch(
        new Request(visit('/index.html'), { headers: req.headers }),
        env,
      )
    }
    return new Response('no', { status: 404 })
  })
  env = k.env
  k.put('ada/cookbook/index.html', '<!doctype html><body>rsvp</body>')
  await k.dir.apply({
    entities: [{ entity: { eid: k.app.eid }, app: { access: 'private' } }],
  }, ADA_OWNS)

  // The guest holds a code and nothing else — no session, no role.
  assertEquals((await k.at('/rsvp?code=OPEN-SESAME')).status, 200)
  // A wrong code is the app's own no, and it reached nothing.
  assertEquals((await k.at('/rsvp?code=guess')).status, 403)
  // The worker read its own page for them; asking for it directly is the
  // sign-in bounce a private app gives a stranger.
  assertStringIncludes(await (await k.at('/card')).text(), 'rsvp')
  assertEquals((await k.at('/index.html')).status, 303)
  // And the store door is still shut: `env.APP` is a door on the worker's own
  // path, never a hole in the app's mode.
  assertEquals((await k.at('/api/query?.doc!')).status, 401)

  // One household row, signed by the APP — not by a guest, and not by Ada.
  let cookie = await as(ADA)
  let asAda = (path: string) =>
    apps.fetch(visit(path, { headers: { cookie } }), env)
  let rows = await (await asAda(
    '/api/query?.doc.title=The Okonkwos&.created?',
  )).json()
  assertEquals(rows.length, 1)
  // A bare eid, because the app is not a person and has no name in this store
  // to resolve one to (listing.ts `named`) — and it is the app's own entity,
  // so `.created.by=<the app>` finds everything the worker wrote.
  assertEquals(rows[0].created.by, k.app.eid)
  // And the app is not a person for having written (graph.ts `#vouching`).
  assertEquals((await (await asAda('/api/query?.person!')).json()).length, 0)
})

// ---- the shop example, deployed and shopped in (T-34517) --------------------

// `workers/yak/examples/shop/` is the store recipe the selling guide teaches
// (public/guide/selling.md), and this is the proof it is an app and not a
// listing: the same bytes go up through `app_files`, `app_deploy` plants the
// `product` word and writes the seeded shirts, the storefront is served with
// its base and its reporter, and the inside of the app stays inside.
//
// Then the buying half, as far as this side of it goes. Taking money is the
// PLATFORM's door — `POST /api/pay/checkout`, on the seller's connected Stripe
// account (T-34525) — so the app holds no key, writes no worker, and has
// exactly one obligation: the items it posts must name products this store
// has, and must carry no money, because the door reads `price_cents` off the
// row itself. `priced()` below stands in for that door until it lands, and
// asserts exactly that contract. The order row and the buyer's letter are
// written by the Connect webhook (T-34526) and belong to its own test.
let SHOP = new URL('./examples/shop/', import.meta.url)

// Every file of the example, the way `app_files` takes a whole app in one
// call: text as text, and bytes as base64 (tools.ts `bytesOf` reads it back).
let base64 = (bytes: Uint8Array) =>
  btoa([...bytes].map((b) => String.fromCharCode(b)).join(''))

let shopFiles = async () => {
  let out: { path: string; content?: string; base64?: string }[] = []
  let walk = async (at: URL, under: string) => {
    for await (let e of Deno.readDir(at)) {
      let path = `${under}${e.name}`
      if (e.isDirectory) {
        await walk(new URL(`${e.name}/`, at), `${path}/`)
        continue
      }
      let bytes = await Deno.readFile(new URL(e.name, at))
      out.push(
        e.name.endsWith('.png')
          ? { path, base64: base64(bytes) }
          : { path, content: new TextDecoder().decode(bytes) },
      )
    }
  }
  await walk(SHOP, '')
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

// The space, the shop, and the tools' own context — the doors `app_files` and
// `app_deploy` are reached through, so what is deployed here is deployed the
// way an agent deploys it.
let shopping = async () => {
  let { env, files } = platform()
  let { dir, space } = await seeded(env)
  await dir.apply({
    entities: [{
      entity: { eid: '$shop' },
      doc: { title: 'The Shop' },
      app: { slug: 'shop', space: space.eid, version: 0, access: 'public' },
      former: { slug: 'ada/shop' },
    }],
  }, ADA_OWNS)
  let app = (await dir.app(space, 'shop'))!
  let ctx = { env, dir, person: ADA } as unknown as Ctx
  let deploy = async () => {
    await call(ctx, 'app_files', {
      space: 'ada',
      app: 'shop',
      files: await shopFiles(),
    })
    return (await call(ctx, 'app_deploy', { space: 'ada', app: 'shop' })).text
  }
  let shirts = async () =>
    await (await apps.fetch(visit('/shop/api/query?.product!&.doc?'), env))
      .json() as {
        entity: { eid: string }
        doc: { title: string }
        product: { price_cents: number; sizes: string }
      }[]
  return { env, files, dir, space, app, ctx, deploy, shirts }
}

// The platform's checkout door, as T-34525 specifies it and until it exists:
// `{items: [{product, qty, options?}]}` in, `{url}` out, every price read off
// the app's own `product` rows. A shop that posted a price would have nothing
// read from it here, which is the whole point of asserting against this.
let priced = (
  rows: Awaited<ReturnType<Awaited<ReturnType<typeof shopping>>['shirts']>>,
  items: Record<string, string | number>[],
) => {
  let by = new Map(rows.map((r) => [r.entity.eid, r]))
  let lines = []
  for (let one of items) {
    let row = by.get(String(one.product))
    if (!row) throw new Error(`no product ${one.product}`)
    let cents = Number(row.product.price_cents)
    if (!cents) throw new Error('that product has no price')
    lines.push({
      name: one.options ? `${row.doc.title} (${one.options})` : row.doc.title,
      unit_amount: cents,
      quantity: Number(one.qty),
    })
  }
  return { lines, url: 'https://checkout.stripe.com/c/pay/cs_test_probe' }
}

Deno.test('the shop example deploys, seeds itself and serves its front', async () => {
  let k = await shopping()
  let out = await k.deploy()
  // The app's own word, planted from vocab.json — and `order` is NOT among
  // them: that one is the platform's, written when Stripe says money moved.
  assertStringIncludes(out, 'components: product')
  assertEquals(/\border\b/.test(out), false)

  let shirts = await k.shirts()
  assertEquals(
    shirts.map((r) => r.doc.title).sort(),
    ['Everyday Tee — Charcoal', 'Everyday Tee — Oat', 'Long Sleeve — Moss'],
  )
  // Priced in whole cents, with the sizes the seller wrote.
  let charcoal = shirts.find((r) => r.doc.title.endsWith('Charcoal'))!
  assertEquals(charcoal.product.price_cents, 2800)
  assertEquals(charcoal.product.sizes, 'S, M, L, XL')

  // The storefront, as a shopper gets it.
  let page = await (await apps.fetch(visit('/shop/'), k.env)).text()
  assert(page.includes('<base href="/shop/">'), page.slice(0, 200))
  assert(page.includes('./api/pay/checkout'))
  // It holds no key and asks for none: an app that sells writes no Stripe
  // code at all.
  assertEquals(/sk_test|whsec_|api\.stripe\.com/.test(page), false)
  // The module beside it is served; the app's inside is not.
  assertEquals((await apps.fetch(visit('/shop/cart.js'), k.env)).status, 200)
  for (let inside of ['/shop/vocab.json', '/shop/seed/01-shirts.json']) {
    assertEquals((await apps.fetch(visit(inside), k.env)).status, 404, inside)
  }
  // And the icon it shipped, rather than the platform's tile.
  let icon = await apps.fetch(visit('/shop/icon.png'), k.env)
  assertEquals(icon.headers.get('content-type'), 'image/png')
  assertEquals(
    new Uint8Array(await icon.arrayBuffer()),
    await Deno.readFile(new URL('icon.png', SHOP)),
  )
})

Deno.test('a cart off the shop page is an ask the checkout door can price', async () => {
  let k = await shopping()
  await k.deploy()
  let shirts = await k.shirts()
  let tee = shirts.find((r) => r.doc.title.endsWith('Charcoal'))!
  let long = shirts.find((r) => r.doc.title.startsWith('Long'))!

  // The cart, built the way the page builds one, through the example's own
  // module: two of a shirt in M, and one long sleeve, which has no size.
  let cart = added(
    added([], { product: tee.entity.eid, options: 'M', qty: 2 }),
    { product: long.entity.eid },
  )
  let items = asked(cart)
  // What goes to the door names rows this store HAS, and says nothing about
  // money.
  assertEquals(items.map((i: { product: string }) => i.product), [
    tee.entity.eid,
    long.entity.eid,
  ])
  assertEquals(/price|amount|cent/.test(JSON.stringify(items)), false)

  let paid = priced(shirts, items)
  // The door priced it off the store, and carried the size into the name the
  // buyer reads on Stripe's own page.
  assertEquals(paid.lines, [
    { name: 'Everyday Tee — Charcoal (M)', unit_amount: 2800, quantity: 2 },
    { name: 'Long Sleeve — Moss', unit_amount: 3600, quantity: 1 },
  ])
  assertStringIncludes(paid.url, 'checkout.stripe.com')

  // A product this store does not have is refused before Stripe is asked —
  // an eid off another app, or one somebody made up.
  assertThrows(
    () => priced(shirts, [{ product: CAKE, qty: 1 }]),
    Error,
    'no product',
  )
})

// ---- selling (sell.ts, T-34524) --------------------------------------------
//
// The Connect webhook against a real directory: what an event from a seller's
// account does to the space it belongs to. The account and the onboarding link
// go out through a stand-in Stripe on a free port (probe.ts `stripe`, aimed at
// with STRIPE_API), so what is asserted is the request that actually left
// rather than a mock's word for it.
//
// The SPACE PAGE's half of this — the three states an owner reads, and the
// button that posts back — is in mcp_test.ts instead: drawing that page reaches
// identity.ts for whether an assistant has ever connected, and the OAuth
// provider it carries imports `cloudflare:` modules that only workerd can load.
// So the page is driven where a runtime exists, and the door is driven here,
// where it costs nothing.

// Where the space stands with selling, read back off the directory.
let sold = async (env: Env) =>
  (await directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
    .space('ada'))?.stripe

// The button on that page, as its form posts it. The page it is on is drawn in
// mcp_test.ts; the POST is apps.ts `saved` and reaches nothing that needs a
// runtime.
let pressed = async (env: Env, sell: string) =>
  await apps.fetch(
    new Request('https://ada.yaks.app/', {
      method: 'POST',
      headers: {
        cookie: await as(ADA),
        origin: 'https://ada.yaks.app',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `sell=${sell}`,
    }),
    env,
  )

// One event at the Connect door, signed the way Stripe signs it.
let connectHook = async (
  env: Env,
  secret: string,
  event: Record<string, unknown>,
) => {
  let raw = JSON.stringify(event)
  let at = Math.floor(Date.now() / 1000)
  let res = await sell.fetch(
    new Request('https://yaks.app/stripe/connect', {
      method: 'POST',
      body: raw,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': await signed(secret, raw, at),
      },
    }),
    env,
  )
  return { status: res.status, body: await res.json() }
}

let WHSEC = 'whsec_a_connect_probe_secret'

let updated = (id: string, over: Record<string, unknown>) => ({
  id,
  type: 'account.updated',
  account: 'acct_probe',
  data: { object: { id: 'acct_probe', ...over } },
})

Deno.test('a space connects Stripe, and the webhook makes it ready', async () => {
  let fake = stripe(({ path }) =>
    path == '/v1/accounts'
      ? { id: 'acct_probe', charges_enabled: false, details_submitted: false }
      : path == '/v1/account_links'
      ? { url: 'https://connect.stripe.com/setup/c/acct_probe/TOKEN' }
      : null
  )
  let { env } = inMemory(SECRET, {
    STRIPE_KEY: 'sk_probe',
    STRIPE_API: fake.url,
    STRIPE_CONNECT_WEBHOOK_SECRET: WHSEC,
  })
  try {
    await seeded(env)
    // Nothing connected.
    assertEquals(await sold(env), null)

    // The button. It answers a redirect to STRIPE's own hosted form — the one
    // thing on that page that leaves the site.
    let went = await pressed(env, 'start')
    assertEquals(went.status, 303)
    assertEquals(
      went.headers.get('location'),
      'https://connect.stripe.com/setup/c/acct_probe/TOKEN',
    )

    // What actually went to Stripe: the four controller properties that ARE
    // the charge-merchants-directly model, and no `type` beside them.
    let made = fake.at('/v1/accounts')!
    assertEquals(made.sent.get('controller[fees][payer]'), 'account')
    assertEquals(made.sent.get('controller[losses][payments]'), 'stripe')
    assertEquals(made.sent.get('controller[stripe_dashboard][type]'), 'full')
    assertEquals(made.sent.get('controller[requirement_collection]'), 'stripe')
    assertEquals(made.sent.get('type'), null)
    // And the link comes back to the page the button is on, both ways.
    let asked = fake.at('/v1/account_links')!
    assertEquals(asked.sent.get('account'), 'acct_probe')
    assertEquals(asked.sent.get('type'), 'account_onboarding')
    assertEquals(asked.sent.get('return_url'), 'https://ada.yaks.app/')
    assertEquals(asked.sent.get('refresh_url'), 'https://ada.yaks.app/')

    // The id is written the moment Stripe answers with it, BEFORE the link is
    // asked for — so a person who wanders off mid-onboarding comes back to the
    // account they started rather than a second one.
    assertEquals(await sold(env), {
      account: 'acct_probe',
      chargesEnabled: false,
      detailsSubmitted: false,
    })

    // Pressing it again mints a NEW LINK on the SAME account — an account link
    // is single-use, and a second account would split one merchant's money
    // across books nobody can add up.
    await pressed(env, 'start')
    assertEquals(
      fake.calls.filter((c) => c.path == '/v1/accounts').length,
      1,
      'one account, ever',
    )
    assertEquals(
      fake.calls.filter((c) => c.path == '/v1/account_links').length,
      2,
    )

    // ---- account.updated, and they are ready ----
    let ready = await connectHook(
      env,
      WHSEC,
      updated('evt_1', { charges_enabled: true, details_submitted: true }),
    )
    assertEquals(ready.status, 200)
    assertEquals(ready.body.did, 'ada can sell')
    assertEquals(await sold(env), {
      account: 'acct_probe',
      chargesEnabled: true,
      detailsSubmitted: true,
    })

    // The SAME event again writes nothing at all: at-least-once delivery is
    // the normal case, and the row is derived rather than transitioned.
    assertEquals(
      (await connectHook(
        env,
        WHSEC,
        updated('evt_1', { charges_enabled: true, details_submitted: true }),
      )).body.did,
      'unchanged',
    )

    // ---- Stripe changes its mind: a flag it does not send is FALSE ----
    assertEquals(
      (await connectHook(
        env,
        WHSEC,
        updated('evt_2', {
          details_submitted: true,
        }),
      )).body.did,
      'ada cannot sell',
    )
    assertEquals((await sold(env))?.chargesEnabled, false)

    // ---- the seller revokes us from their own dashboard ----
    assertEquals(
      (await connectHook(env, WHSEC, {
        id: 'evt_3',
        type: 'account.application.deauthorized',
        account: 'acct_probe',
        data: { object: { id: 'ca_platform' } },
      })).body.did,
      'ada disconnected',
    )
    // Forgotten here, and untouched at Stripe: the row is gone, the merchant
    // still has their account, their money and their records.
    assertEquals(await sold(env), null)

    // An event for an account nobody here sells through is answered 200 and
    // nothing else: a second delivery would find the same nothing, and making
    // Stripe repeat an unanswerable question for three days helps no one.
    assertEquals(
      (await connectHook(env, WHSEC, {
        id: 'evt_4',
        type: 'account.updated',
        account: 'acct_someone_else',
        data: { object: { id: 'acct_someone_else', charges_enabled: true } },
      })).body.did,
      'no space sells through that account',
    )
  } finally {
    await fake.stop()
  }
})

Deno.test('the connect door refuses what Stripe did not sign', async () => {
  let { env } = inMemory(SECRET, { STRIPE_CONNECT_WEBHOOK_SECRET: WHSEC })
  await seeded(env)
  let raw = '{"type":"account.updated"}'
  let post = (headers: Record<string, string>) =>
    sell.fetch(
      new Request('https://yaks.app/stripe/connect', {
        method: 'POST',
        body: raw,
        headers: { 'content-type': 'application/json', ...headers },
      }),
      env,
    )
  assertEquals((await post({})).status, 400)
  assertEquals(
    (await (await post({ 'stripe-signature': 't=1,v1=beef' })).json())
      .error.code,
    'bad_signature',
  )
  // The PLATFORM's secret is not this door's secret. Two endpoints, two
  // `whsec_`, and a door that verified the wrong one is a door answering
  // nothing.
  let at = Math.floor(Date.now() / 1000)
  assertEquals(
    (await post({
      'stripe-signature': await signed('whsec_the_other_one', raw, at),
    })).status,
    400,
  )
  // GET is not how an event arrives.
  assertEquals(
    (await sell.fetch(new Request('https://yaks.app/stripe/connect'), env))
      .status,
    405,
  )
})

// The secret is the owner's to set (README.md). Until he has, the door says so
// in one sentence — and every other half of selling still works, which is the
// whole reason it is a 503 rather than a boot failure.
Deno.test('with no connect secret the door says so, and nothing else breaks', async () => {
  let { env } = inMemory(SECRET, { STRIPE_KEY: 'sk_probe' })
  await seeded(env)
  let res = await sell.fetch(
    new Request('https://yaks.app/stripe/connect', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }),
    env,
  )
  assertEquals(res.status, 503)
  assertEquals((await res.json()).error.code, 'no_selling')
})

// The one button a space can press without a Stripe key set is Stop, and it
// needs no Stripe call at all: forgetting an account is a write of ours.
Deno.test('stopping selling forgets the account and calls nothing', async () => {
  let fake = stripe(() => null)
  let { env } = inMemory(SECRET, {
    STRIPE_KEY: 'sk_probe',
    STRIPE_API: fake.url,
    STRIPE_CONNECT_WEBHOOK_SECRET: WHSEC,
  })
  try {
    let { space } = await seeded(env)
    await stamp(env, {
      entities: [{
        entity: { eid: space.eid },
        stripe: {
          account: 'acct_probe',
          charges_enabled: true,
          details_submitted: true,
        },
      }],
    })
    assertEquals((await sold(env))?.chargesEnabled, true)
    assertEquals((await pressed(env, 'stop')).status, 303)
    assertEquals(await sold(env), null)
    assertEquals(fake.calls.length, 0, 'nothing was asked of Stripe')
  } finally {
    await fake.stop()
  }
})
