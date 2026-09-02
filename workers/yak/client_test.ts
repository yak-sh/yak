// The store client an app's pages import, held in workerd (probe.ts boots the
// kernel): the kernel serves public/client.js beside every app's doors, and a
// page that imports it saves and lists the app's own entities.
//
// The page here is a module, and it runs where the test runs: Deno loads the
// bytes the kernel served and calls them. What a browser gives a page and a
// test cannot is its origin — the hostname a probe can only spell in
// `x-yak-host`, and the cookie that says who is asking — so `browser()` below
// is a loopback origin that adds both and passes everything through. The
// client reaches its own doors through it exactly as a page's would.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow, until } from '../../src/testing.ts'
import { client, type Kernel, kernel, relay, seed, signedIn } from './probe.ts'

// An origin that stands in for `<space>.yaks.app`: every request goes to the
// kernel wearing that hostname, and the person's cookie if they have one.
let browser = (k: Kernel, host: string, cookie?: string) => {
  let server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    let url = new URL(req.url)
    let type = req.headers.get('content-type')
    return k.at(host, url.pathname + url.search, {
      method: req.method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(type ? { 'content-type': type } : {}),
      },
      body: req.method == 'GET' ? undefined : await req.text(),
    })
  })
  let { port } = server.addr as Deno.NetAddr
  return { origin: `http://127.0.0.1:${port}`, stop: () => server.shutdown() }
}

slow('the served client: a page saves, lists and watches', async () => {
  let k = await kernel()
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-client-' })
  let jeff = crypto.randomUUID()
  let cookie = await signedIn(k, jeff)
  let mine = browser(k, 'jeff.yaks.app', cookie)
  let anyone = browser(k, 'jeff.yaks.app')
  try {
    await seed(k, jeff, [{ slug: 'jeff', apps: ['recipes'], home: 'recipes' }])

    // The kernel serves one client for every app, beside the doors it wraps.
    let served = await k.at('jeff.yaks.app', '/recipes/api/client.js')
    assertEquals(served.status, 200)
    assertMatch(served.headers.get('content-type') ?? '', /javascript/)
    let source = await served.text()
    assertMatch(source, /export let \{ apply, query, search, subscribe \}/)

    // The page a person would be given, and its script, run here.
    let page = '<!doctype html><h1>Recipes</h1>' +
      '<script type="module">import { apply, query } from "./api/client.js"' +
      '</script>'
    await client(k, 'jeff.yaks.app', 'recipes', cookie).put(
      '/index.html',
      page,
    )
    assertStringIncludes(
      await (await k.at('jeff.yaks.app', '/recipes/')).text(),
      page,
    )

    Deno.writeTextFileSync(`${dir}/client.js`, source)
    let mod = await import(`file://${dir}/client.js`)
    let store = mod.store(`${mine.origin}/recipes/api/`)

    // The guide's own example: a recipe saved, an alias for the eid it mints.
    let saved = await store.apply({
      entity: { eid: '$cake' },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter...' },
    })
    let cake = saved.aliases.$cake
    assert(cake, 'the alias resolved')

    // Listed, found by their words, counted.
    let [row] = await store.query('.doc!')
    assertEquals(row.entity.eid, cake)
    assertEquals(row.doc.title, 'Lemon cake')
    assertEquals((await store.search('lemon'))[0].entity.eid, cake)
    assertEquals(await store.query('.doc!&.count!'), { count: 1 })

    // A second component on the same entity, and the filter that reads it.
    await store.apply({
      entity: { eid: cake },
      task: { status: 'open', priority: 1 },
    })
    assertEquals((await store.query('.task.status=open'))[0].task.priority, 1)

    // A second recipe: the list is oldest first, a windowed read newest.
    await store.apply([{ doc: { title: 'Plum tart' } }])
    let titles = (rows: { doc: { title: string } }[]) =>
      rows.map((r) => r.doc.title)
    assertEquals(titles(await store.query('.doc!')), [
      'Lemon cake',
      'Plum tart',
    ])
    assertEquals(titles(await store.query('.doc!&limit=1')), ['Plum tart'])

    // The live half: the page watches a filter and sees a write it did not
    // make. A socket carries the app's hostname on its handshake, which a
    // probe can only put there at the wire (probe.ts relay).
    let wire = relay(k, 'jeff.yaks.app', cookie)
    let seen: { doc: { title: string } }[][] = []
    let stop = mod.store(`${wire.origin}/recipes/api/`)
      .subscribe(
        '.task.status=open',
        (rows: typeof seen[number]) => seen.push(rows),
      )
    try {
      await until(() => seen.length == 1, { timeout: 15_000 })
      assertEquals(titles(seen[0]), ['Lemon cake'])
      // Another device writes: another tab, another phone, an agent — all the
      // same door, and the page hears it without asking.
      await store.apply({ entity: { eid: cake }, doc: { title: 'Lime cake' } })
      await until(() => seen.length == 2, { timeout: 15_000 })
      assertEquals(titles(seen[1]), ['Lime cake'])
    } finally {
      stop()
      await wire.stop()
    }

    // A refusal arrives as the server's own sentence, not a status code and
    // not a machine word (C-32574 item 2).
    await assertRejects(
      () => mod.store(`${anyone.origin}/recipes/api/`).apply({ doc: {} }),
      Error,
      'sign in to change this app',
    )
    await assertRejects(
      () => store.query('work=build'),
      Error,
      'work lanes',
    )
    // A door that answers a PAGE — the platform's 404 — is not quoted at the
    // person: the status and a short line of it, never the whole document
    // (C-32574 item 4, where a club saw the HTML in its error line).
    let dumped = await assertRejects(
      () => mod.store(`${mine.origin}/nowhere/api/`).query('.doc!'),
      Error,
    )
    assertEquals(dumped.message.includes('<'), false)
    assertMatch(dumped.message, /^404 /)
    assert(dumped.message.length < 140, dumped.message)
  } finally {
    await mine.stop()
    await anyone.stop()
    Deno.removeSync(dir, { recursive: true })
    await k.stop()
  }
})
