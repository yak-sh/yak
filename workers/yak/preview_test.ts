import { equal, ok, test, throws } from '@yaks/testing'
import { appStore } from './directory.ts'
import { handler } from './kernel.ts'
import { opened, seal } from './lib/token.ts'
import { tools, viewport } from './preview.ts'
import { ADA, ADA_OWNS, platform, seeded } from './serving-probe.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { homed } from './page-graph.ts'

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
  let tampered = token.slice(0, -1) + (token.endsWith('x') ? 'y' : 'x')
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

test('an expired private preview is unavailable', async () => {
  let claims = await opened<Record<string, unknown>>(
    'preview',
    token,
    env.SESSION_SECRET!,
  )
  let expired = await seal(
    'preview',
    { ...claims, exp: 0 },
    env.SESSION_SECRET!,
  )
  equal(
    (await kernel(new Request(url.replace(token, expired)), env)).status,
    404,
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
