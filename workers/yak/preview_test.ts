import { equal, ok, test, throws } from '@yaks/testing'
import { appStore, releaseOf, storeName } from './directory.ts'
import { declarationOf, keepDeclaration } from './declaration.ts'
import { handler } from './kernel.ts'
import { fetch as preview, viewport } from './preview.ts'
import { sealedAt as linked } from './preview-probe.ts'
import { opened, seal } from './lib/token.ts'
import { LASTS, type Ticket } from '@yaks/platform/preview'
import { system } from '@yaks/fp'
import { tools } from './preview-tools.ts'
import { ADA, ADA_OWNS, as, SECRET, seeded } from './serving-data-probe.ts'
import { platform } from './directory-rows-probe.ts'
import { operators } from './operator-service-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { digest } from '@yaks/graph/sha256'
import { h } from 'preact'
import { client } from '@yaks/client'
import { store } from '@yaks/platform/client'
import { stub } from '@std/testing/mock'
import { host } from '@yaks/preact/host'
import { loadVocab } from '@yaks/vocab'
import { CustomEvent, stage } from '../../packages/preact/testing.ts'

let kernel = (req: Request, env: Parameters<typeof handler.fetch>[1]) =>
  handler.fetch(req, env)

let runtime = platform(SECRET, { BUILDER: operators })
let scenario = { ...runtime, ...lifecycleStores(runtime.env) }
let { env } = scenario
let { dir, space } = await seeded(env, 'public', runtime.dir)
let ctx: Ctx = { env, dir, person: ADA }
let run = (name: string, args: Record<string, unknown>) =>
  TOOLS.find((t) => t.name == name)!.run(ctx, args)
await run('app_new', { slug: 'draft', title: 'Draft', access: 'public' })
await run('app_files', {
  app: 'draft',
  files: [
    {
      path: 'index.html',
      content:
        '<html><head></head><body>Private draft<script src="main.js"></script></body></html>',
    },
    {
      path: 'about/index.html',
      content:
        '<html><head></head><body>About the draft<link rel="stylesheet" href="../style.css"></body></html>',
    },
    { path: 'main.js', content: 'console.log("draft loaded")' },
    { path: 'style.css', content: 'body { color: teal }' },
    {
      path: 'vocab.json',
      content: JSON.stringify({
        $defs: {
          draft_note: { properties: { text: { type: 'string' } } },
          draft_image: { properties: { text: { type: 'string' } } },
        },
      }),
    },
    {
      path: 'seed.json',
      content: JSON.stringify([
        {
          entity: { eid: '$note' },
          draft_note: { text: 'seeded privately' },
        },
        {
          entity: { eid: '$image' },
          draft_image: { text: 'private image' },
        },
      ]),
    },
  ],
})
let sealedAt = (out: { value?: Record<string, unknown> }) => linked(ctx, out)
let out = await tools[0].run(ctx, { app: 'draft', screenshot: false })
let url = await sealedAt(out)
let mount = url.slice(0, url.indexOf('/_preview/') + '/_preview/'.length)
let token = url.slice(mount.length).split('/')[0]
let app = (await dir.app(space, 'draft'))!
let request = (path = '', init: RequestInit = {}) =>
  kernel(new Request(new URL(path, url), init), env)

for (let q of ['.draft_note%7C.draft_image', '(.draft_note%7C.draft_image)']) {
  test(`a preview answers an escaped OR query: ${q}`, async () => {
    let res = await request('api/query?' + q)
    equal(res.status, 200)
    let rows = await res.json()
    equal(
      rows.map((
        r: { draft_note?: { text: string }; draft_image?: { text: string } },
      ) => (r.draft_note ?? r.draft_image)!.text).sort(),
      ['private image', 'seeded privately'],
    )
  })
}

test('preview forwards immutable WebSocket upgrades with their socket and private headers', async () => {
  let socket = {}
  let upgrade = Object.assign(new Response(null, { status: 101 }), {
    webSocket: socket,
  })
  Object.defineProperty(upgrade, 'headers', { value: Response.error().headers })
  let bindings = {
    ...env,
    STORE: {
      ...env.STORE,
      get: (id: unknown) => ({
        fetch: (req: Request) =>
          new URL(req.url).pathname == '/ws'
            ? Promise.resolve(upgrade)
            : env.STORE.get(id).fetch(req),
      }),
    },
  }
  let res = await preview(
    new Request(new URL('api/ws', url), { headers: { upgrade: 'websocket' } }),
    bindings,
  )
  equal(res.status, 101)
  equal((res as Response & { webSocket: unknown }).webSocket, socket)
  equal(res.headers.get('cache-control'), 'private, no-store')
  equal(res.headers.get('referrer-policy'), 'no-referrer')
  equal(res.headers.get('x-robots-tag'), 'noindex, nofollow')
})

test('preview serves an unreleased draft and leaves its release pointer alone', async () => {
  equal((await dir.app(space, 'draft'))!.version, 0)
  let res = await request()
  equal(res.status, 200)
  let html = await res.text()
  ok(html.includes('Private draft'))
  ok(html.includes(`<base href="${new URL(url).pathname}">`), html)
  equal(res.headers.get('cache-control'), 'private, no-store')
  equal(res.headers.get('referrer-policy'), 'no-referrer')
  equal(res.headers.get('x-robots-tag'), 'noindex, nofollow')
  let live = await kernel(new Request('https://ada.yaks.app/draft/'), env)
  ok(!(await live.text()).includes('Private draft'))
})

test('preview serves nested pages and their relative assets', async () => {
  let res = await request('about/')
  equal(res.status, 200)
  ok(
    (await res.text()).includes(`<base href="${new URL(url).pathname}about/">`),
  )
  equal(await (await request('style.css')).text(), 'body { color: teal }')
})

test('preview installs vocabulary and seed data in a separate store before first deploy', async () => {
  let res = await request('api/query?q=.draft_note')
  equal(res.status, 200)
  let rows = await res.json()
  equal(rows.length, 1)
  equal(rows[0].draft_note.text, 'seeded privately')
  let live = appStore(env.STORE, space, app, env)
  let words = await live.consume('/vocab', (res) => res.json(), {}, ADA_OWNS)
  equal(words, {})
})

test("a draft's page asks its link's ./api/ who it is and what it holds, through the platform client", async () => {
  using _ = stub(
    globalThis,
    'fetch',
    (to, init) => kernel(new Request(to, init), env),
  )
  let page = store(new URL('api/', url))
  let [me, notes] = await Promise.all([
    page.me(),
    page.query('.draft_note'),
  ])
  equal([me.person, me.writes], [ADA, true])
  equal(notes.map((r: { draft_note: { text: string } }) => r.draft_note.text), [
    'seeded privately',
  ])
})

test('preview writes stay on the draft’s branch, and the live app never sees them', async () => {
  let res = await request('api/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      entities: [{ entity: { eid: '$edit' }, doc: { title: 'Preview edit' } }],
    }),
  })
  equal(res.status, 200)
  let preview = await request('api/query?q=.doc.title="Preview edit"')
  equal((await preview.json()).length, 1)
  let live = appStore(env.STORE, space, app, env)
  let rows = await live.consume(
    '/query?q=.doc',
    (res) => res.json(),
    {},
    ADA_OWNS,
  )
  equal(rows, [])
})

test('a preview ticket never exposes server source or another app', async () => {
  equal((await request('vocab.json')).status, 404)
  equal((await request('seed.json')).status, 404)
  equal(
    (await kernel(
      new Request(url.replace('ada.yaks.app', 'stranger.yaks.app')),
      env,
    )).status,
    404,
  )
  let policy = (await request()).headers.get('content-security-policy')!
  ok(policy.includes('sandbox allow-scripts'))
  ok(!policy.includes('allow-same-origin'))
  equal(
    (await kernel(new Request(url.replace('/draft/', '/cookbook/')), env))
      .status,
    404,
  )
  let tampered = token.slice(0, -1) + (token.endsWith('x') ? 'y' : 'x')
  equal(
    (await kernel(new Request(url.replace(token, tampered)), env)).status,
    404,
  )
})

test('a link opens nothing once it expires, nor one sealed with no expiry', async () => {
  let later = (ms: number) => ({ ...system, now: () => Date.now() + ms })
  let at = (CLOCK = system) => kernel(new Request(url), { ...env, CLOCK })
  equal((await at(later(LASTS * 1000 - 60_000))).status, 200)
  equal((await at(later(2 * LASTS * 1000))).status, 404)
  let held = await opened<Ticket>('preview', token, SECRET)
  let { exp: _, ...forever } = held!
  let old = await seal('preview', forever, SECRET)
  equal((await kernel(new Request(url.replace(token, old)), env)).status, 404)
})

// A draft's short link carries no credential: the visitor's own sign-in
// opens it, for someone who writes in the space, as the link sealed for them.
test("a draft's short link opens for a signed-in writer, sends anyone signed out to sign in, and opens for nobody else", async () => {
  let short = String(out.value!.url)
  ok(/^https:\/\/ada\.yaks\.app\/draft\/~[0-9a-f]{8}\/$/.test(short), short)
  let at = async (cookie: string | null, path = '') =>
    await kernel(
      new Request(new URL(path, short), cookie ? { headers: { cookie } } : {}),
      env,
    )
  let page = await at(await as(ADA))
  equal(page.status, 200)
  let html = await page.text()
  ok(html.includes('Private draft'), html)
  ok(html.includes(`<base href="${new URL(url).pathname}">`), html)
  equal(page.headers.get('cache-control'), 'private, no-store')
  equal(
    await (await at(await as(ADA), 'style.css')).text(),
    'body { color: teal }',
  )
  let signedOut = await at(null)
  equal(signedOut.status, 303)
  ok(signedOut.headers.get('location')!.includes('login'))
  let eli = 'e0000000-0000-4000-8000-000000000001'
  await dir.apply(
    { entities: [{ entity: { eid: eli }, person: {} }] },
    ADA_OWNS,
  )
  let stranger = await at(await as(eli))
  equal(stranger.status, 404)
  await stranger.body?.cancel()
})

test('a walled preview page gets the platform localStorage, kept in the preview store', async () => {
  let opaque = { origin: 'null', 'content-type': 'application/json' }
  let html = await (await request()).text()
  ok(html.includes('id="yak-storage"'), html)
  ok(html.includes(`<script src="${new URL(url).pathname}api/storage.js">`))
  equal((await request('api/storage.js', { headers: opaque })).status, 200)
  let saved = await request('api/storage', {
    method: 'POST',
    headers: opaque,
    body: JSON.stringify({ set: { theme: 'dark' } }),
  })
  equal(saved.status, 200)
  await saved.body?.cancel()
  ok((await (await request()).text()).includes('"theme":"dark"'))
  let live = appStore(env.STORE, space, app, env)
  equal(
    await live.consume('/storage', (res) => res.json(), {}, ADA_OWNS),
    {},
  )
})

test('preview API cannot publish live files or use live platform connections', async () => {
  for (
    let path of [
      'public',
      'blob',
      'env',
      'fetch',
      'tunneled',
      'files',
      'pay/checkout',
    ]
  ) {
    equal((await request('api/' + path, { method: 'POST' })).status, 404)
  }
  equal(
    (await request('api/query?q=.draft_note', { headers: { origin: 'null' } }))
      .status,
    200,
  )
})

// The store a draft's link pages are on: its branch of the app's store, as
// this platform keeps one (app-lifecycle-probe.ts).
let branchStore = async (link: string) => {
  let d = (await dir.drafts(app)).find((d) => d.eid == link)!
  return `${storeName(space, app)}@${d.branch}`
}

// A socket on a draft's link, as its branch holds one: what it was sent.
let heard = async (link: string) => {
  let sent: {
    draft: { link: string; draft: string | null; files: unknown }
  }[] = []
  let name = await branchStore(link)
  scenario.sockets.get(name)!.push({
    readyState: 1,
    send: (data: string) => void sent.push(JSON.parse(data)),
    close: () => {},
    serializeAttachment: () => {},
    deserializeAttachment: () => null,
  } as never)
  return sent
}
let write = (path: string, content: string) =>
  run('app_files', { app: 'draft', path, content })

test('the link follows the draft: each write is told to its pages and served on the next request, and the released page stays as it was', async () => {
  await run('app_deploy', { app: 'draft' })
  await write('style.css', 'body { color: plum }')
  let out = await tools[0].run(ctx, { app: 'draft', screenshot: false })
  let link = await sealedAt(out)
  let draft = String(out.value!.draft)
  let at = (path = '') => kernel(new Request(new URL(path, link)), env)
  let page = await (await at()).text()
  ok(page.includes(`data-yak-draft="${draft}"`), page)
  let sent = await heard(draft)
  await write('style.css', 'body { color: tomato }')
  await write(
    'index.html',
    '<html><head></head><body>Soup tonight</body></html>',
  )
  equal(await (await at('style.css')).text(), 'body { color: tomato }')
  ok((await (await at()).text()).includes('Soup tonight'))
  equal(sent.map((m) => [m.draft.link, m.draft.draft]), [
    [draft, draft],
    [draft, draft],
  ])
  equal(sent[0].draft.files, [{
    path: 'style.css',
    sha: await digest('body { color: tomato }'),
  }])
  let live = await kernel(new Request('https://ada.yaks.app/draft/'), env)
  let released = await live.text()
  ok(released.includes('Private draft') && !released.includes('Soup'))
  ok(!released.includes('data-yak-draft="'))
})

test('a page drawn by @yaks/preact/host takes a write of its views module from the link in place: the module the link serves, drawn in the same root over the same page graph', async () => {
  let views = (word: string) =>
    `import { define } from ${
      JSON.stringify(import.meta.resolve('@yaks/render'))
    }\n` +
    "export let views = define([{ view: 'Page', match: true, " +
    `render: (b, h) => h('p', null, '${word} ' + b.entity.eid) }])`
  await write('views.js', views('Soup'))
  let out = await tools[0].run(ctx, { app: 'draft', screenshot: false })
  let link = await sealedAt(out)
  let sent = await heard(String(out.value!.draft))
  let { root, document, free } = stage()
  Object.defineProperty(document, 'baseURI', {
    value: link,
    configurable: true,
  })
  let front = client(
    loadVocab([{
      $defs: { pot: { component: true, sync: 'none', properties: {} } },
    }]),
    [],
    { vault: false, wireVault: false, provenance: false },
  )
  await front.mutate([{ entity: { eid: 'pot' }, pot: {} }])
  let graph = front.graph
  // Import the served bytes in Deno, with the fixture naming its render
  // dependency by URL: a data: module has no package resolution context.
  let load = async (url: string) => {
    let text = await (await kernel(new Request(url), env)).text()
    return import('data:text/javascript,' + encodeURIComponent(text))
  }
  let page = await host({
    root,
    views: 'views.js',
    vocab: front.vocab,
    store: front.ent,
    draw: (Entity) => h(Entity, { eid: 'pot', view: 'Page' }),
    load,
  })
  try {
    equal(root.textContent, 'Soup pot')
    let drawn = root.firstChild
    await write('views.js', views('Stew'))
    let news = sent.at(-1)!.draft as unknown as {
      files: { path: string; sha: string }[]
    }
    equal(news.files, [{
      path: 'views.js',
      sha: await digest(views('Stew')),
    }])
    let reloads = 0
    let event = Object.assign(
      new CustomEvent('yak-draft', {
        cancelable: true,
        detail: {
          ...news,
          files: news.files.map((f) => ({
            ...f,
            url: String(new URL(f.path, link)),
          })),
        },
      }),
      { reload: () => reloads++ },
    )
    equal(document.defaultView!.dispatchEvent(event), false)
    await page.settled()
    equal([root.textContent, reloads], ['Stew pot', 0])
    ok(root.firstChild == drawn && front.graph == graph)
  } finally {
    page.close()
    front.close()
    free()
  }
})

test("an app no release has seeded takes its draft's seed on the branch, and an edited seed rewrites those rows, never adding them again", async () => {
  let seed = (text: string) =>
    run('app_files', {
      app: 'sown',
      files: [{
        path: 'seed.json',
        content: JSON.stringify([{
          entity: { eid: '$note' },
          draft_note: { text },
        }]),
      }],
    })
  await run('app_new', { slug: 'sown', title: 'Sown', access: 'public' })
  await run('app_files', {
    app: 'sown',
    files: [
      { path: 'index.html', content: '<html><body>Sown</body></html>' },
      {
        path: 'vocab.json',
        content: JSON.stringify({
          $defs: { draft_note: { properties: { text: { type: 'string' } } } },
        }),
      },
    ],
  })
  await seed('seeded privately')
  let out = await tools[0].run(ctx, { app: 'sown', screenshot: false })
  let link = await sealedAt(out)
  let notes = async () =>
    (await (await kernel(
      new Request(new URL('api/query?q=.draft_note', link)),
      env,
    )).json()).map((r: { draft_note: { text: string } }) => r.draft_note.text)
  await kernel(new Request(link), env)
  equal(await notes(), ['seeded privately'])
  await seed('seeded again')
  await kernel(new Request(link), env)
  equal(await notes(), ['seeded again'])
})

test("an open link rides through its draft's release: its pages hear it and see what was released, and the next draft has a link of its own", async () => {
  await write('index.html', '<html><head></head><body>Before</body></html>')
  let out = await tools[0].run(ctx, { app: 'draft', screenshot: false })
  let link = await sealedAt(out)
  let draft = String(out.value!.draft)
  let at = (path = '') => kernel(new Request(new URL(path, link)), env)
  ok((await (await at()).text()).includes('Before'))
  let sent = await heard(draft)
  await run('app_deploy', { app: 'draft' })
  app = (await dir.app(space, 'draft'))!
  equal((await dir.drafts(app)).map((d) => d.eid), [])
  await new Promise((done) => setTimeout(done, 10))
  equal(sent.map((m) => [m.draft.link, m.draft.draft, m.draft.files]), [
    [draft, null, []],
  ])
  let page = await at()
  equal(page.status, 200)
  ok((await page.text()).includes('Before'))
  // Its short link, the draft closed, is the app's own address.
  let gone = await kernel(
    new Request(String(out.value!.url) + 'about/', {
      headers: { cookie: await as(ADA) },
    }),
    env,
  )
  equal(gone.status, 302)
  equal(gone.headers.get('location'), 'https://ada.yaks.app/draft/about/')
  // Released, the link reads the live rows and never writes them.
  equal((await at('api/query?q=.doc')).status, 200)
  let wrote = await kernel(
    new Request(new URL('api/apply', link), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entities: [{ entity: { eid: '$x' }, doc: { title: 'Through' } }],
      }),
    }),
    env,
  )
  equal(wrote.status, 403)
  await wrote.body?.cancel()
  await write('index.html', '<html><head></head><body>After</body></html>')
  let next = (await dir.drafts(app)).map((d) => d.eid)
  equal(next.length, 1)
  ok(next[0] != draft)
  ok((await (await at()).text()).includes('Before'))
  let then = await tools[0].run(ctx, { app: 'draft', screenshot: false })
  equal(then.value!.draft, next[0])
  ok(await sealedAt(then) != link)
  ok(
    (await (await kernel(new Request(await sealedAt(then)), env)).text())
      .includes('After'),
  )
})

test('two drafts of one app preview side by side, each at its own link on its own branch', async () => {
  let one = await run('app_files', {
    app: 'draft',
    path: 'index.html',
    content: '<html><body>Warm</body></html>',
  })
  let two = await run('app_files', {
    app: 'draft',
    draft: 'new',
    path: 'index.html',
    content: '<html><body>Plain</body></html>',
  })
  let shown = async (draft: unknown) => {
    let out = await tools[0].run(ctx, {
      app: 'draft',
      draft,
      screenshot: false,
    })
    return {
      url: await sealedAt(out),
      text: await (await kernel(new Request(await sealedAt(out)), env))
        .text(),
    }
  }
  let [warm, plain] = [
    await shown(one.value!.draft),
    await shown(two.value!.draft),
  ]
  ok(warm.url != plain.url)
  ok(warm.text.includes('Warm') && !warm.text.includes('Plain'))
  ok(plain.text.includes('Plain') && !plain.text.includes('Warm'))
  let stores = [...scenario.sockets.keys()]
  let branches = await Promise.all(
    [one.value!.draft, two.value!.draft].map((d) => branchStore(String(d))),
  )
  ok(branches[0] != branches[1], branches.join(' '))
  for (let b of branches) ok(stores.includes(b), stores.join(' '))
})

// The platform declares `event` (@yaks/events). An app that declared it first
// keeps it (vocab.ts `unsaid`), in its draft's link as in its deploys.
test('a draft keeps a platform word its app held before the platform declared it, and a new app may not take it', async () => {
  let event = { properties: { starts: { type: 'string' } } }
  let vocab = {
    path: 'vocab.json',
    content: JSON.stringify({ $defs: { event } }),
  }
  let page = { path: 'index.html', content: '<html><body>Held</body></html>' }
  for (let slug of ['held', 'taker']) {
    await run('app_new', { slug, title: slug, access: 'public' })
    await run('app_files', { app: slug, files: [page] })
    await run('app_deploy', { app: slug })
  }
  let held = (await dir.app(space, 'held'))!
  let was = await declarationOf(env, space, held)
  await keepDeclaration(env, space, held, releaseOf(held), {
    ...was,
    vocab: { $defs: { ...was.vocab.$defs, event } },
  })
  let shown = async (slug: string) => {
    await run('app_files', { app: slug, files: [vocab] })
    let out = await tools[0].run(ctx, { app: slug, screenshot: false })
    return kernel(new Request(await sealedAt(out)), env)
  }
  equal((await shown('held')).status, 200)
  await throws(
    () => shown('taker'),
    'event is a component the platform already declares',
  )
})

test('preview viewport uses CSS pixels at phone and desktop widths', async () => {
  equal(viewport({ width: 390, height: 844, wait: 0 }), {
    width: 390,
    height: 844,
    wait: 0,
  })
  equal(viewport({}), { width: 1280, height: 900, wait: 1000 })
  await throws(() => viewport({ width: 0 }))
  await throws(() => viewport({ height: 3000 }))
})
