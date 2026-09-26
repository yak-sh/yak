/// <reference lib="deno.ns" />
// Serving an app off the Store on the packages (T-33815): the page, the file
// beside it, and the `/api/*` doors its client speaks — over the workerd
// stand-in, with nothing stubbed between the request and the rows.
//
// The whole point is that two wires meet here and the door translates
// (wire.ts): a page sends `{entities: […]}` and reads `{ok, aliases, bundles}`
// back, writes its filter as the query string itself, and folds a socket's
// frames — while the Store takes a bare array of bundles, answers the batch as
// applied, reads its line off `?q=`, and pushes `{id, bundles, gone}`. So the
// client is driven the way a page drives it, and what it gets back is what the
// guide says it gets back.
//
// The directory is a Store too, at `yak/platform`, so the space and the app
// this serves are real rows written the way `space_new` and `app_new` write
// them (platform_test.ts is that half on its own).
//
// The routing order is held here as well, at the end: which part answers a
// path — an app, the home app, the platform's own index — is the same door
// asked the same way, and the stand-in is where a home app with a worker can
// be stood up at all (apps.ts `served`, D-34197).
// The runtime this Worker is written against — the HTML rewriter, a Durable
// Object's state, the bucket, the Store namespace — is testing.ts's, shared
// with builder_test.ts; Ada, her space and her app are serving-probe.ts's,
// shared with selling_test.ts, which sells from the same kind of space.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import type { Wire } from '@yaks/durable-object'
import { until } from '../../bin/testing.ts'
import * as apps from './apps.ts'
import { directory, stamp, storeName } from './directory.ts'
import * as dirPart from './directory.ts'
import { scriptName } from './dispatch.ts'
import type { Env } from './env.ts'
import { analytics, dataset } from './testing.ts'
import { emptied, trash, trashSpace } from './erase.ts'
import { call, type Ctx, wrote } from './tools.ts'
import { archive, openIn, serve } from './unseen.ts'
import { PLATFORM_STORE } from './door.ts'
import { sweep } from './usage.ts'
import { FREE, monthOf, PLUS, size } from './meter.ts'
import { ADA, ADA_OWNS, as, platform, seeded, visit } from './serving-probe.ts'

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
        aliases: Record<string, string>
        bundles: Record<string, unknown>[]
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
  using scenario = platform()
  let { env, files } = scenario
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

Deno.test('an app is installable: the five tags, the icon, the manifest', async () => {
  using scenario = platform()
  let { env, files } = scenario
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
  // The page named its own theme-color, so the kernel defers rather than
  // injecting a second one — but it still gives the app the two Apple words,
  // which the page named neither of.
  assertEquals(html.match(/theme-color/g)?.length, 1)
  assert(
    html.includes(
      '<meta name="apple-mobile-web-app-capable" content="yes">',
    ),
    html,
  )
  assert(
    html.includes(
      '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
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

  // And the manifest, generated from the app: no colour of its own set
  // through `app_set`, so the platform's own answers rather than a guess off
  // the page (T-33055) — the page's own theme-color meta is about the page,
  // not the manifest a wholly separate resource names.
  let got = await apps.fetch(visit('/cookbook/manifest.webmanifest'), env)
  assertEquals(got.status, 200)
  assertEquals(got.headers.get('content-type'), 'application/manifest+json')
  assertEquals(await got.json(), {
    name: 'Cookbook',
    short_name: 'Cookbook',
    start_url: '/cookbook/',
    scope: '/cookbook/',
    display: 'standalone',
    background_color: apps.PLATFORM_BACKGROUND,
    theme_color: apps.PLATFORM_THEME,
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

Deno.test("an app's own colours, set through app_set, win over the platform's", async () => {
  using scenario = platform()
  let { env, files } = scenario
  let { dir } = await seeded(env)
  files.held.set(
    'ada/cookbook/index.html',
    new TextEncoder().encode('<!doctype html><head></head><body>hi'),
  )
  let ctx = { env, dir, person: ADA } as unknown as Ctx
  await call(ctx, 'app_set', {
    space: 'ada',
    app: 'cookbook',
    theme_color: '#1b3a2f',
    background_color: '#fff8ec',
  })

  let html = await (await apps.fetch(visit('/cookbook/'), env)).text()
  assert(
    html.includes('<meta name="theme-color" content="#1b3a2f">'),
    html,
  )

  let got =
    await (await apps.fetch(visit('/cookbook/manifest.webmanifest'), env))
      .json()
  assertEquals(
    (got as Record<string, unknown>).theme_color,
    '#1b3a2f',
  )
  assertEquals(
    (got as Record<string, unknown>).background_color,
    '#fff8ec',
  )
})

Deno.test('a page view is one data point, and it names no visitor', async () => {
  let seen = dataset()
  using scenario = platform({ VIEWS: seen })
  let { env, files } = scenario
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
    using scenario = platform({
      CF_ACCOUNT: 'acc0unt',
      CF_ANALYTICS_TOKEN: 'a token',
    })
    let { env } = scenario
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

    // A public app's pages are the world's; its visitor counts are not.
    let theirs = await apps.fetch(visit('/cookbook/api/stats'), env)
    assertEquals(theirs.status, 401)
    await theirs.body?.cancel()
  } finally {
    api.done()
  }
})

Deno.test('/api/stats with no analytics token is a sentence, not a failure', async () => {
  using scenario = platform()
  let { env } = scenario
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
  using scenario = platform()
  let { env } = scenario
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
  let [cake] = wrote.bundles.filter((b) =>
    (b.entity as { eid: string }).eid == eid
  )
  assertEquals(cake.$alias, '$cake')
  assertEquals((cake.doc as { title: string }).title, 'Lemon drizzle')

  // The filter grammar is the page's: the query string itself, and a row
  // carries the components the filter names, under the word it is called by.
  let [row] = await page.query('.doc')
  assertEquals(row.kind, 'doc')
  assertEquals((row.entity as { eid: string }).eid, eid)
  assertEquals((row.doc as { title: string }).title, 'Lemon drizzle')

  // An address, in the page's own grammar.
  assertEquals((await page.query(`id=${eid}`)).length, 1)

  // Full text over the docs, and the platform's own rows stay out of the
  // answer: the store minted a `person` row for the writer.
  let hits = await page.search('drizzle')
  assertEquals(hits.length, 1)
  assertEquals((hits[0].entity as { eid: string }).eid, eid)
  // And over the body, which is the half a blob address could have eaten:
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
  // that did not name it (C-32607 item 4 — `.created` dragged every one in),
  // and comes back when one does.
  assertEquals((await page.query('.created')).length, 1)
  assertEquals((await page.query('.person')).length, 1)
})

Deno.test('a store tells the directory what it holds once a write moves it', async () => {
  using scenario = platform()
  let { env, states } = scenario
  let { dir, space, app } = await seeded(env)
  assertEquals(app.meter, null)
  let page = client(env, await as(ADA))
  await page.apply([{
    entity: { eid: CAKE },
    doc: { title: 'Lemon cake', body: 'lemons '.repeat(4_000) },
  }])
  // Nobody asked the store: it said so itself, after the write committed
  // (graph.ts `#tell`), and what it said is what it weighs.
  let held = () => states.get(storeName(space, app))!.storage.sql.databaseSize
  let told = await until(async () =>
    (await dir.app(space, 'cookbook'))!.meter?.bytes
  )
  assertEquals(told, held())
  assert(held() > 0)
})

Deno.test('a bulk load is NDJSON in and NDJSON out, refusal and all', async () => {
  using scenario = platform()
  let { env } = scenario
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
  assertEquals((await page.query('.doc')).length, 3)

  // A bad line is the last line of the answer, and it says which line it was.
  let no = await lines(
    await poured([
      JSON.stringify({ entity: { eid: '$ok' }, doc: { title: 'Fine' } }),
      JSON.stringify({
        entity: { eid: '$no' },
        doc: { name: 'not a property' },
      }),
    ].join('\n')),
  )
  assertEquals(no.length, 1)
  assertEquals(no[0].error, 'Refused')
  assertEquals(no[0].line, 2)
  assertEquals(no[0].committed, 0)
  // Its chunk rolled back whole: the good line beside it landed nothing.
  assertEquals((await page.query('.doc')).length, 3)
})

Deno.test('a subscription is that query still answering', async () => {
  using scenario = platform()
  let { env, object, sockets } = scenario
  await seeded(env)
  let name = 'ada/cookbook.aaa111'
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
  assertEquals(await page.query('.doc'), [])
  sockets.get(name)!.push(ws)
  object(name).webSocketMessage(
    ws,
    JSON.stringify({ subscribe: '.doc&!person', id: '1:.doc' }),
  )
  assertEquals(sent, [{ id: '1:.doc', bundles: [], transientReset: [] }])

  await page.apply([{ entity: { eid: CAKE }, doc: { title: 'Lemon drizzle' } }])
  assertEquals(sent.length, 2)
  let frame = sent[1] as { id: string; bundles: Record<string, unknown>[] }
  assertEquals(frame.id, '1:.doc')
  // The same row `query()` answers with, kind and all — a page swaps one for
  // the other and nothing else changes.
  assertEquals(frame.bundles[0].kind, 'doc')
  assertEquals((frame.bundles[0].entity as { eid: string }).eid, CAKE)
})

Deno.test('an open app takes a write from nobody, and a public one does not', async () => {
  using open = platform()
  await seeded(open.env, 'open')
  let stranger = client(open.env)
  let wrote = await stranger.apply([
    { entity: { eid: CAKE }, doc: { title: 'a vote' } },
  ])
  assertEquals(wrote.ok, true)
  // Unattributed: nobody signed it, so nothing claims they did.
  let [row] = await stranger.query('.doc&?created')
  assertEquals((row.created as { by: string | null }).by, null)

  // The same write on a `public` app is the member guard's no, said in the
  // sentence a page shows its person.
  using shut = platform()
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
  using scenario = platform()
  let { env } = scenario
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
  using scenario = platform()
  let { env } = scenario
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
  using scenario = platform()
  let { env } = scenario
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
  using scenario = platform()
  let { env, object, files } = scenario
  let { space, app } = await seeded(env)
  let page = client(env, await as(ADA))
  await page.apply([{ entity: { eid: CAKE }, doc: { title: 'Lemon drizzle' } }])
  assertEquals((await page.query('.doc')).length, 1)
  files.held.set('ada/cookbook/index.html', new Uint8Array([1]))

  await emptied(env, space, app, { person: ADA, role: 'owner' })

  // The bytes went with it, and the store is a planted, empty graph — not one
  // with no tables at all, which is what an app made later here would wake in.
  assertEquals(files.held.size, 0)
  assertEquals((await page.query('.doc')).length, 0)
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

// One rung a test, over the same stand-in: which part answers a path is the
// whole of what these hold, so each one asks an address whose answer only the
// rung it names can give.
//
// The home app's worker is a stub. A dispatch namespace is remote-only — there
// is no workerd implementation and `wrangler dev` leaves the binding undefined
// (dispatch.ts) — so what the seam itself does with a grant is dispatch_test.ts
// and what is proved here is that the kernel asks it, and where in the order.
// The `/.well-known/` half of rung 1 is decided before this part (route.ts
// `platform`, index.ts) and is held in route_test.ts and home_test.ts.

// The space, `cookbook` as its home app, `garden` beside it, and a home worker
// where one is given: an app answering `.get` for no other script is an app
// with no worker, which is the message the runtime knows one by. `first` is a
// property of the `home` component the front page wears, written the way
// `app_set` writes it.
let router = async (
  worker?: (req: Request) => Response | Promise<Response>,
  first?: string[],
) => {
  let scenario = platform()
  let { env, files } = scenario
  let { dir, space, app } = await seeded(env)
  await dir.apply({
    entities: [
      {
        entity: { eid: '$garden' },
        doc: { title: 'Garden' },
        app: {
          slug: 'garden',
          space: space.eid,
          version: 1,
          access: 'public',
          store: 'ada/garden.bbb222',
        },
        former: { slug: 'garden' },
      },
      {
        entity: { eid: app.eid },
        home: first ? { first: JSON.stringify(first) } : {},
      },
    ],
  }, ADA_OWNS)
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
    [Symbol.dispose]: () => scenario[Symbol.dispose](),
    env,
    dir,
    space,
    app,
    at: (path: string) => apps.fetch(visit(path), env),
    put: (key: string, body: string) =>
      files.held.set(key, new TextEncoder().encode(body)),
  }
}

Deno.test('monthly visit quota stops all app serving before dispatch or files', async () => {
  for (let tier of ['free', 'plus'] as const) {
    let calls = 0
    using k = await router(() => {
      calls++
      return new Response('the router')
    }, ['/garden/*'])
    k.put('ada/garden/index.html', '<!doctype html><body>garden</body>')
    let limit = tier == 'plus' ? PLUS.requests : FREE.requests
    let meter = async (requests: number, month = monthOf(new Date())) =>
      await stamp(k.env, {
        entities: [{
          entity: { eid: k.space.eid },
          plan: { tier },
          meter: { month, requests },
        }],
      })
    await meter(limit - 1)
    assertEquals(await (await k.at('/')).text(), 'the router')
    assertEquals(calls, 1)
    await meter(limit)
    for (
      let path of [
        '/',
        '/garden/',
        '/cookbook/style.css',
        '/api/graph',
        '/garden/api/query',
      ]
    ) {
      let res = await k.at(path)
      assertEquals(res.status, 429, path)
      assertStringIncludes(await res.text(), 'monthly visits')
    }
    // Neither a claimed internal request nor a socket upgrade skips the gate.
    for (
      let headers of [
        new Headers({ 'x-yak-grant': 'forged' }),
        new Headers({ upgrade: 'websocket' }),
      ]
    ) {
      let res = await apps.fetch(visit('/garden/api/ws', { headers }), k.env)
      assertEquals(res.status, 429)
      await res.body?.cancel()
    }
    assertEquals(calls, 1, 'over-quota traffic invoked app code')
    // Strangers spent the visits; the space's own people still get their app.
    let mine = await apps.fetch(
      visit('/', { headers: { cookie: await as(ADA) } }),
      k.env,
    )
    assertEquals(await mine.text(), 'the router')
    calls--
    // The dashboard's old address still moves to the apex, over quota.
    let manage = await k.at('/_yaks')
    assertEquals(manage.status, 301)
    assertStringIncludes(
      manage.headers.get('location')!,
      'https://yaks.app/manage?space=',
    )
    await manage.body?.cancel()
    // A prior month's count cannot keep serving blocked before the next sweep.
    await meter(limit, '2020-01')
    assertEquals(await (await k.at('/')).text(), 'the router')
    await meter(limit)
    await stamp(k.env, {
      entities: [{ entity: { eid: k.space.eid }, space: { slug: 'yourname' } }],
    })
    let comped = await apps.fetch(
      new Request('https://yourname.yaks.app/'),
      k.env,
    )
    assertEquals(await comped.text(), 'the router')
  }
})

Deno.test("a stranger's reads are held to a rate per source, a member's are not", async () => {
  using k = await router()
  let spent = 0
  k.env.API_RATE = { limit: () => Promise.resolve({ success: ++spent <= 2 }) }
  let from = (cookie?: string) =>
    apps.fetch(
      visit('/garden/api/query', {
        headers: {
          'cf-connecting-ip': '203.0.113.9',
          ...(cookie ? { cookie } : {}),
        },
      }),
      k.env,
    )
  for (let want of [200, 200, 429]) {
    let res = await from()
    assertEquals(res.status, want)
    await res.body?.cancel()
  }
  let member = await from(await as(ADA))
  assertEquals(member.status, 200)
  await member.body?.cancel()
  assertEquals(spent, 3, 'a member spent the stranger allowance')
})

Deno.test('rung 1: a platform path never reaches an app', async () => {
  using k = await router(() => new Response('the router', { status: 200 }))
  // The store doors are the kernel's, under an app's slug and at the home
  // app's bare root alike: a home worker that answers everything else does not
  // answer these.
  for (let path of ['/cookbook/api/graph', '/api/graph']) {
    assertEquals((await (await k.at(path)).json()).db, 'do:ada/cookbook.aaa111')
  }
  // And `/<x>/api/…` at an app that is not here is a 404 rather than the home
  // app's page: a page asking a store at a wrong address must not be handed
  // HTML it cannot parse.
  assertEquals((await k.at('/gone/api/query')).status, 404)
})

Deno.test("rung 2: an app's slug wins over the home app", async () => {
  using k = await router(() => new Response('the router', { status: 200 }))
  k.put('ada/garden/index.html', '<!doctype html><body>garden</body>')
  let page = await k.at('/garden/')
  assertEquals(page.status, 200)
  assert((await page.text()).includes('garden'))
  // Even where the app has nothing there: the segment is the garden app's, so
  // the home app and its worker are not asked at all.
  assertEquals((await k.at('/garden/nothing.txt')).status, 404)
})

Deno.test("rung 3: the home app's files answer the bare hostname", async () => {
  using k = await router()
  k.put('ada/cookbook/index.html', '<!doctype html><body>cookbook</body>')
  k.put('ada/cookbook/photo.png', 'not really a png')
  assertEquals(await (await k.at('/photo.png')).text(), 'not really a png')
  // A path behind no file whose last segment names no file type is a route,
  // not a miss: the app's own page answers it (files.ts `pretty`).
  assert((await (await k.at('/about')).text()).includes('cookbook'))
})

Deno.test("rung 4: the space's index is `/`'s last word", async () => {
  // A home app with a front page keeps `/`.
  using k = await router()
  k.put('ada/cookbook/index.html', '<!doctype html><body>cookbook</body>')
  assert((await (await k.at('/')).text()).includes('cookbook'))

  // Without one, `/` is the index — the space EXISTS, so its own address is a
  // door and not a 404 — while a path under it is still nothing.
  using bare = await router()
  let listed = await bare.at('/')
  assertEquals(listed.status, 200)
  assert((await listed.text()).includes('href="/garden/"'))
  assertEquals((await bare.at('/nothing.txt')).status, 404)

  // A home worker that passes on `/` (its 404 is the pass verdict) leaves the
  // index to answer, and one that owns it wins: the index is what is left when
  // neither half of the home app has anything there.
  using passing = await router(() => new Response('no', { status: 404 }))
  assert((await (await passing.at('/')).text()).includes('href="/garden/"'))
  using own = await router(() => new Response('the router', { status: 200 }))
  assertEquals(await (await own.at('/')).text(), 'the router')
})

Deno.test('rung 5: everything else is the home worker, else 404', async () => {
  using k = await router((req) =>
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
  using some = await router((req) =>
    new URL(req.url).pathname == '/menu'
      ? new Response('the menu')
      : new Response('no', { status: 404 })
  )
  some.put('ada/cookbook/photo.png', 'not really a png')
  assertEquals(await (await some.at('/menu')).text(), 'the menu')
  assertEquals(await (await some.at('/photo.png')).text(), 'not really a png')
  // No worker and no file is the 404 at the end of the order.
  using plain = await router()
  assertEquals((await plain.at('/nothing.txt')).status, 404)
})

// ---- rung 1½: `router.first` (T-34201) --------------------------------------

// The home app has named `/garden/*`, so the garden app's own paths are the
// home worker's first. Garden's page is what "the router was skipped" looks
// like: whatever else happened, the app that owns the path answered.
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
  using k = await fronted((req) => {
    seen.push(new URL(req.url).pathname)
    return new Response('the router')
  })
  assertEquals(await (await k.at('/garden/print')).text(), 'the router')
  // The path as the visitor asked it, whole — not the `/print` the garden
  // app's own worker would have been handed.
  assertEquals(seen, ['/garden/print'])
})

Deno.test("rung 1½: the router's 404 passes, and the app answers", async () => {
  using k = await fronted(() => new Response('no', { status: 404 }))
  assertStringIncludes(await (await k.at('/garden/print')).text(), 'garden')
})

Deno.test('rung 1½: a router that throws is skipped, and written on the home app', async () => {
  using k = await fronted(() => {
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

Deno.test(
  'rung 1½: a router that hangs is skipped when its patience runs out',
  async () => {
    using k = await fronted(() => new Promise<Response>(() => {}))
    assertStringIncludes(await (await k.at('/garden/print')).text(), 'garden')
    let open = await openIn(k.env, k.space, k.app, OWNER, true)
    assertEquals(open.length, 1)
    assertStringIncludes(open[0].exception?.message ?? '', 'did not answer')
  },
)

Deno.test('rung 1½: a glob over a store door never takes it', async () => {
  using k = await fronted(() => new Response('the router'))
  // `/garden/*` covers `/garden/api/…` by its own shape, and the store doors
  // are the kernel's however the property is written (router.ts
  // PLATFORM_PATHS).
  assertEquals(
    (await (await k.at('/garden/api/graph')).json()).db,
    'do:ada/garden.bbb222',
  )
})

Deno.test('rung 1½: the router acts as the caller, not as the app it fronts', async () => {
  let env: Env
  using k = await fronted(async () => {
    let asked = await apps.fetch(visit('/garden/api/query?.doc'), env)
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
  using k = await fronted(async (req) => {
    ran++
    // The grant the kernel handed it, forwarded — which is what the router's
    // own `env.STORE`/`env.FILES` calls carry (dispatch.ts shim). A request
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
  using k = await router()
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

// The front page is a word on the app (T-34227), so a trashed app that wears
// it is still wearing it — and the space is a space with no front page until
// it comes back. The restore itself is a form on that space's own page: no
// assistant, no script, one POST.
Deno.test("a trashed front page is nobody's, and the owner restores it there", async () => {
  using k = await router()
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

  // Where the owner restores it is the dashboard's trash page, drawn straight
  // in home_test.ts: reaching it through this stand-in would ask the OAuth
  // provider whether an agent has ever connected, and that is the whole kernel's.
  //
  // The button itself is this door. One POST to the page it is on, and the
  // app is back — front page and all, because the word was never taken off it.
  let cookie = await as(ADA)
  let back = await apps.fetch(
    new Request('https://yaks.app/manage/trash?space=ada', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://yaks.app',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ restore: 'cookbook' }).toString(),
    }),
    k.env,
  )
  assertEquals(back.status, 303)
  assertStringIncludes(await (await k.at('/')).text(), 'cookbook')
})

// A space in the trash answers nothing at any of its addresses (T-34431) —
// ahead of every rung of the order above, since none of them is reached. Its
// owner is the exception, and the page they get carries the one button that
// brings the space back.
Deno.test('a space in the trash serves nothing, and its owner restores it', async () => {
  using k = await router()
  k.put('ada/cookbook/index.html', '<!doctype html><body>cookbook</body>')
  k.put('ada/garden/index.html', '<!doctype html><body>garden</body>')
  assertEquals((await k.at('/')).status, 200)

  await trashSpace(k.env, k.dir, k.space, { person: ADA, role: 'owner' })
  // Every page address under it, whichever rung would have answered: the
  // front page, an app of its own, and a file.
  for (let path of ['/', '/garden/', '/cookbook/index.html']) {
    let out = await k.at(path)
    assertEquals(out.status, 404, path)
    assertStringIncludes(await out.text(), 'Nothing here yet')
  }
  // Its store door is machine-facing even when the space is unavailable.
  let missing = await k.at('/garden/api/query')
  assertEquals(missing.status, 404)
  assertEquals(await missing.json(), {
    error: { code: 'not_found', message: 'no app at that address' },
  })

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
// one row it names as the app. The grant is spent the way the shim spends it
// (dispatch.ts shim) — under grant, on the app's own door — because the shim
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
  using k = await router(async (req) => {
    let url = new URL(req.url)
    if (url.pathname == '/rsvp') {
      // The check comes first, and its refusal says nothing else.
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
  assertEquals((await k.at('/api/query?.doc')).status, 401)

  // One household row, signed by the app — not by a guest, and not by Ada.
  let cookie = await as(ADA)
  let asAda = (path: string) =>
    apps.fetch(visit(path, { headers: { cookie } }), env)
  let rows = await (await asAda(
    '/api/query?.doc.title="The Okonkwos"&?created',
  )).json()
  assertEquals(rows.length, 1)
  // A bare eid, because the app is not a person and has no name in this store
  // to resolve one to (listing.ts `named`) — and it is the app's own entity,
  // so `.created.by=<the app>` finds everything the worker wrote.
  assertEquals(rows[0].created.by, k.app.eid)
  // And the app is not a person for having written (graph.ts `#vouching`).
  assertEquals((await (await asAda('/api/query?.person')).json()).length, 0)
})

Deno.test('photo and file uploads enforce space R2 limits from actual bytes', async () => {
  using scenario = platform()
  let { env, files } = scenario
  let { dir, space, app } = await seeded(env)
  let cookie = await as(ADA)
  env.FILES = {
    fetch: () => Promise.resolve(new Response(null, { status: 204 })),
  }
  let list = env.BLOBS.list.bind(env.BLOBS)
  let occupied = 0
  // Synthetic size metadata exercises GB ceilings without allocating GBs.
  env.BLOBS.list = async (opts) => {
    let page = await list(opts)
    page.objects.push({
      key: 'ada/another/blob',
      size: occupied,
      uploaded: new Date(),
    })
    return page
  }
  let upload = (path: string, body: string, length?: string) =>
    apps.fetch(
      visit(`/cookbook/api/${path}`, {
        method: path == 'blob' ? 'POST' : 'PUT',
        body,
        headers: { cookie, ...(length ? { 'content-length': length } : {}) },
      }),
      env,
    )
  for (let tier of ['free', 'plus'] as const) {
    await stamp(env, {
      entities: [{ entity: { eid: space.eid }, plan: { tier } }],
    })
    let cap = tier == 'plus' ? 50 * 1024 ** 3 : 1024 ** 3
    files.held.clear()
    occupied = cap - 3
    // No length header, and an understated length: both are refused on bytes.
    for (let length of [undefined, '1']) {
      for (let path of ['blob', 'files/new.txt']) {
        let no = await upload(path, 'four', length)
        assertEquals(no.status, 413)
        let error = (await no.json()).error
        assertEquals(error.code, 'space_full')
        assertStringIncludes(
          error.message,
          `${tier == 'plus' ? 50 : 1} GB of photos and files`,
        )
        assertEquals(files.held.size, 0)
      }
    }
    let yes = await upload('blob', 'abc')
    assertEquals(yes.status, 200)
    let photo = await yes.json()
    assertEquals(files.held.size, 1)
    // At the limit, the same content is free and reads remain available.
    let duplicate = await upload('blob', 'abc')
    assertEquals(duplicate.status, 200)
    assertEquals((await duplicate.json()).eid, photo.eid)
    let read = await apps.fetch(visit(photo.url), env)
    assertEquals(await read.text(), 'abc')
    let no = await upload('blob', 'x')
    assertEquals(no.status, 413)
    await no.body?.cancel()
    files.held.clear()
    let put = await upload('files/new.txt', 'abc')
    assertEquals(put.status, 200)
    await put.body?.cancel()
    let smaller = await upload('files/new.txt', 'a')
    assertEquals(smaller.status, 200)
    await smaller.body?.cancel()
    let bigger = await upload('files/new.txt', 'four')
    assertEquals(bigger.status, 413)
    await bigger.body?.cancel()
    // The connector, ZIP drop and sandbox share this write seam.
    let current = (await dir.space(space.slug))!
    await assertRejects(
      () =>
        wrote(env, current, app, { person: ADA, role: 'owner' }, [
          { path: 'one.txt', bytes: new Uint8Array(2) },
          { path: 'two.txt', bytes: new Uint8Array(2) },
        ]),
      Error,
      'photos and files',
    )
    assertEquals(files.held.has('ada/cookbook/one.txt'), false)
    await sweep(env)
    let listing = await call({ env, dir, person: ADA }, 'app_list', {
      space: 'ada',
    })
    // What the space stands at, in the listing's own words (meter.ts
    // `standing`) — the structured copy of it went with the output schemas.
    assertStringIncludes(
      listing.text,
      `${size(cap - 2)} of ${size(cap)} photos and files`,
    )
  }
})
