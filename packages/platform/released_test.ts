// A release directory opens on this machine as the store yaks.app keeps for
// its app, answering through @yaks/api's doors in its own words and the
// renames it declares, and running the commands it declares.
import { equal, test, throws } from '@yaks/testing'
import { packageEid } from '@yaks/lens'
import { mint } from '@yaks/graph/identity'
import { faulted, toolEid } from '@yaks/tools/result'
import { opened } from './released.ts'
import { store } from './client.js'

let dir = new URL('./fixtures/recipes', import.meta.url).pathname
let host = await opened(dir, ['graph', 'web'], { db: ':memory:' })
let door = (path: string, body?: unknown) =>
  Promise.resolve(host.handler!(
    new Request(
      `http://host${path}`,
      body ? { method: 'POST', body: JSON.stringify(body) } : undefined,
    ),
  ))
let headed = async (heading: string) =>
  (await (await door(`/query?q=.recipe.heading=${heading}`)).json())
    .map((row: { recipe: { heading: string } }) => row.recipe.heading)

test('a row in the release’s words is written and read back', async () => {
  await door('/apply', [{
    entity: { eid: 'cake' },
    recipe: { heading: 'Cake' },
  }])
  equal(await headed('Cake'), ['Cake'])
})

test('a write in the release’s first words reads in its declared rename', async () => {
  await door('/apply', [{
    entity: { eid: 'pie' },
    recipe: { title: 'Pie' },
    $speaks: { [packageEid('@app/recipes')]: 0 },
  }])
  equal(await headed('Pie'), ['Pie'])
})

// A page as the browser reads it: its status, its base, the mount and
// release its reporter is told, whether that reporter posts to
// `./api/report`, and its own text.
let got = async (path: string) => {
  let res = await door(path)
  let html = await res.text()
  let reporter = /<script data-yak-at="([^"]*)" data-yak-version="(\d+)">/
    .exec(html)
  return [
    res.status,
    /<base href="([^"]*)">/.exec(html)?.[1],
    reporter?.slice(1),
    html.includes('api/report'),
    html.replace(/^.*<\/script>/s, '').replace(/<base[^>]*>/, ''),
  ]
}

test('the release’s pages answer at their addresses, dressed as yaks.app dresses them', async () => {
  equal(await got('/'), [200, '/', ['/', '0'], true, '<h1>Recipes</h1>\n'])
  equal(await got('/about'), [200, '/', ['/', '0'], true, '<h1>About</h1>\n'])
  equal(await got('/docs/'), [
    200,
    '/docs/',
    ['/', '0'],
    true,
    '<h1>Docs</h1>\n',
  ])
  equal((await door('/docs')).headers.get('location'), 'docs/')
})

test('what a page’s reporter posts, the release answers', async () => {
  let res = await door('/api/report', { message: 'boom', stack: '' })
  equal(res.status, 204)
})

test('the release’s inside answers at no address', async () => {
  for (
    let path of [
      '/vocab.json',
      '/seed.json',
      '/%76ocab.json',
      '/x/../vocab.json',
    ]
  ) {
    equal((await door(path)).status, 404, path)
  }
})

// A page's client finds its store beside itself, at `./api/`: the store's
// doors answer there as well as at the root, and the client is served there.
test('the store’s doors answer under /api, where a page’s client finds them', async () => {
  await door('/api/apply', [{
    entity: { eid: 'stew' },
    recipe: { heading: 'Stew' },
  }])
  let rows = await (await door('/api/query?q=.recipe.heading=Stew')).json()
  equal(rows.map((r: { entity: { eid: string } }) => r.entity.eid), ['stew'])
})

type Row = { recipe: { heading: string } }

// The client a page imports, over a socket and fetches of its own: a write
// it applies is read back by `query` and heard by `subscribe`.
test('a page uses its store through its client at ./api/', async () => {
  await using box = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    host.handler!,
  )
  let page = store(`http://127.0.0.1:${box.addr.port}/api/`)
  let heard = Promise.withResolvers<void>()
  let stop = page.subscribe('.recipe', (rows: Row[]) => {
    if (rows.some((r) => r.recipe.heading == 'Tart')) heard.resolve()
  })
  await stop.ready
  let written = await page.apply({
    entity: { eid: '$tart' },
    recipe: { heading: 'Tart' },
  })
  equal(written.ok, true)
  equal(
    (await page.query('.recipe.heading=Tart')).map((r: Row) => r.recipe),
    [{ heading: 'Tart' }],
  )
  equal(
    (await page.query(`id=${written.aliases.$tart}`)).length,
    1,
  )
  await heard.promise
  stop()
  page.outbox.close()
})

test('a page’s vocab.json is its store’s documents', async () => {
  equal(Array.isArray(await (await door('/api/vocab.json')).json()), true)
})

test('a page imports its client from ./api/client.js', async () => {
  let res = await door('/api/client.js')
  let code = await res.text()
  equal(
    [res.status, res.headers.get('content-type'), /export\s*\{/.test(code)],
    [200, 'text/javascript; charset=utf-8', true],
  )
})

let called = async (tool: string, args: Record<string, unknown>) => {
  let eid = mint()
  let landed = await host.runner.call({
    entity: { eid },
    call: { to: toolEid(tool), args },
  })
  return faulted(landed, eid)
}

test('a command the release declares writes to its store', async () => {
  equal(await called('jot', { heading: 'Soup' }), false)
  equal(await headed('Soup'), ['Soup'])
})

test('each kind the release declares is worth its two commands', () => {
  let names = host.tools.map((t) => t.name)
  equal(
    ['jot', 'add_recipe', 'find_recipe'].filter((n) => names.includes(n)),
    ['jot', 'add_recipe', 'find_recipe'],
  )
})

test('a release whose owner names no reference is refused before its store opens', async () => {
  let unowned = new URL('./fixtures/unowned', import.meta.url).pathname
  await throws(
    () => opened(unowned, ['graph'], { db: ':memory:' }),
    'vocab.json: note.personal names by, which is no reference',
  )
})
