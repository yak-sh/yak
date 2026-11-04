import { equal, ok, test, throws } from '@yaks/testing'
import { appStore } from './directory.ts'
import { handler } from './kernel.ts'
import { fetch as preview, tools, viewport } from './preview.ts'
import { ADA, ADA_OWNS, platform, seeded } from './serving-probe.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { homed } from './page-graph.ts'
import { sha256 } from './versions.ts'
import { h } from 'preact'
import { client } from '@yaks/client'
import { host } from '@yaks/preact/host'
import { loadVocab } from '@yaks/vocab'
import { CustomEvent, stage } from '../../packages/preact/testing.ts'

let kernel = (req: Request, env: Parameters<typeof handler.fetch>[1]) =>
  handler.fetch(req, env)

let scenario = platform()
let { env } = scenario
let { dir, space } = await seeded(env)
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
        $defs: { draft_note: { properties: { text: { type: 'string' } } } },
      }),
    },
    {
      path: 'seed.json',
      content: JSON.stringify([{
        entity: { eid: '$note' },
        draft_note: { text: 'seeded privately' },
      }]),
    },
  ],
})
let out = await tools[0].run(ctx, { app: 'draft', screenshot: false })
let url = String(out.value!.url)
let mount = url.slice(0, url.indexOf('/_preview/') + '/_preview/'.length)
let token = url.slice(mount.length).split('/')[0]
let app = (await dir.app(space, 'draft'))!
let request = (path = '', init: RequestInit = {}) =>
  kernel(new Request(new URL(path, url), init), env)

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

test('preview writes stay in the preview store', async () => {
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
  let tampered = (token.startsWith('x') ? 'y' : 'x') + token.slice(1)
  equal(
    (await kernel(new Request(url.replace(token, tampered)), env)).status,
    404,
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

test('a store-scoped page keeps borrowed component homes out of its graph', async () => {
  let graph = await homed(env, space, { ...app, scope: 'store' }, {
    person: ADA,
    role: 'owner',
  }, { doc: 'cookbook' })
  equal(graph.reach.length, 1)
  equal(graph.uses, {})
})

// A socket on the link, as the store holds one: what it was sent.
let heard = () => {
  let sent: {
    draft: { link: string; draft: string | null; files: unknown }
  }[] = []
  let name = [...scenario.sockets.keys()].find((n) =>
    n.includes(`preview/${app.followed}`)
  )!
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
  let out = await tools[0].run(ctx, { app: 'draft', screenshot: false })
  let link = String(out.value!.url)
  let at = (path = '') => kernel(new Request(new URL(path, link)), env)
  let page = await (await at()).text()
  app = (await dir.app(space, 'draft'))!
  ok(page.includes(`data-yak-draft="${app.followed}"`), page)
  let sent = heard()
  await write('style.css', 'body { color: tomato }')
  await write(
    'index.html',
    '<html><head></head><body>Soup tonight</body></html>',
  )
  equal(await (await at('style.css')).text(), 'body { color: tomato }')
  ok((await (await at()).text()).includes('Soup tonight'))
  let draft = (await dir.app(space, 'draft'))!.draft
  equal(sent.map((m) => [m.draft.link, m.draft.draft]), [
    [app.followed, draft],
    [app.followed, draft],
  ])
  equal(sent[0].draft.files, [{
    path: 'style.css',
    sha: await sha256(new TextEncoder().encode('body { color: tomato }')),
  }])
  let live = await kernel(new Request('https://ada.yaks.app/draft/'), env)
  let released = await live.text()
  ok(released.includes('Private draft') && !released.includes('Soup'))
  ok(!released.includes('data-yak-draft="'))
})

test('a page drawn by @yaks/preact/host takes a write of its views module from the link in place: the module the link serves, drawn in the same root over the same page graph', async () => {
  let views = (word: string) =>
    "import { define } from '@yaks/render'\n" +
    "export let views = define([{ view: 'Page', match: true, " +
    `render: (b, h) => h('p', null, '${word} ' + b.entity.eid) }])`
  await write('views.js', views('Soup'))
  let out = await tools[0].run(ctx, { app: 'draft', screenshot: false })
  let link = String(out.value!.url)
  let sent = heard()
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
  // The module as a browser imports it from the link: the bytes it serves.
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
      sha: await sha256(new TextEncoder().encode(views('Stew'))),
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

test("a seed edited in the draft rewrites the rows it seeded in the link's store, never adding them again", async () => {
  let out = await tools[0].run(ctx, { app: 'draft', screenshot: false })
  let link = String(out.value!.url)
  let notes = async () =>
    (await (await kernel(
      new Request(new URL('api/query?q=.draft_note', link)),
      env,
    )).json()).map((r: { draft_note: { text: string } }) => r.draft_note.text)
  equal(await notes(), ['seeded privately'])
  await write(
    'seed.json',
    JSON.stringify([{
      entity: { eid: '$note' },
      draft_note: { text: 'seeded again' },
    }]),
  )
  await kernel(new Request(link), env)
  equal(await notes(), ['seeded again'])
})

test("an open link rides through a deploy: its pages hear the release and see what was released, then the next draft's writes, all in the link's own store", async () => {
  let out = await tools[0].run(ctx, { app: 'draft', screenshot: false })
  let link = String(out.value!.url)
  let at = (path = '') => kernel(new Request(new URL(path, link)), env)
  await write('index.html', '<html><head></head><body>Before</body></html>')
  ok((await (await at()).text()).includes('Before'))
  app = (await dir.app(space, 'draft'))!
  let sent = heard()
  await run('app_deploy', { app: 'draft' })
  equal((await dir.app(space, 'draft'))!.draft, null)
  await new Promise((done) => setTimeout(done, 10))
  equal(sent.map((m) => [m.draft.link, m.draft.draft, m.draft.files]), [
    [app.followed, null, []],
  ])
  let page = await at()
  equal(page.status, 200)
  ok((await page.text()).includes('Before'))
  await write('index.html', '<html><head></head><body>After</body></html>')
  let next = (await dir.app(space, 'draft'))!.draft
  ok(next && next != app.draft)
  equal(sent.at(-1)!.draft.link, app.followed)
  equal(sent.at(-1)!.draft.draft, next)
  ok((await (await at()).text()).includes('After'))
  equal(
    String(
      (await tools[0].run(ctx, { app: 'draft', screenshot: false }))
        .value!.url,
    ),
    link,
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
