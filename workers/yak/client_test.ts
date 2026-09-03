// The store client an app's pages import, held in workerd (probe.ts boots the
// kernel): the kernel serves public/client.js beside every app's doors, and a
// page that imports it saves and lists the app's own entities.
//
// The page here is a module, and it runs where the test runs: Deno loads the
// bytes the kernel served and calls them. What a browser gives a page and a
// test cannot is its origin — the hostname and the cookie that says who is
// asking — which probe.ts's `browser()` stands in for.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow, until } from '../../src/testing.ts'
import { browser, client, kernel, relay, seed } from './probe.ts'

// A row as a page reads one: the kind that names it, the spine, and a
// component per name — what `query()` answers with, and what `subscribe()`
// keeps answering with.
type Row = {
  kind: string
  entity: { eid: string }
  doc: { title: string; body?: string }
  // A reference to somebody the store knows answers with their name beside
  // the eid (listing.ts `named`), so one query draws a list with its writers.
  created: { by: { eid: string; name: string } }
  task: { assignee: { eid: string; name: string } }
}

slow('the served client: a page saves, lists and watches', async () => {
  let k = await kernel()
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-client-' })
  let them = await seed(k, [{ slug: 'jeff', apps: ['recipes'] }])
  let cookie = them.cookie
  let mine = browser(k, 'jeff.yaks.app', cookie)
  let anyone = browser(k, 'jeff.yaks.app')
  try {
    // The kernel serves one client for every app, beside the doors it wraps.
    let served = await k.at('jeff.yaks.app', '/recipes/api/client.js')
    assertEquals(served.status, 200)
    assertMatch(served.headers.get('content-type') ?? '', /javascript/)
    let source = await served.text()
    assertMatch(
      source,
      /export let \{ apply, me, query, search, subscribe, upload \}/,
    )

    // The page a person would be given, and its script, run here.
    let page = '<!doctype html><h1>Recipes</h1>' +
      '<script type="module">import { apply, query } from ' +
      '"/recipes/api/client.js"' +
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

    // Who is looking, asked BEFORE anything is asked of them (T-32679): the
    // page shapes itself on load instead of learning from a refusal after
    // someone has typed (C-32675 items 5 and 6).
    let owner = await store.me()
    assertEquals(owner.person, them.person)
    assertEquals(owner.name, them.name) // a name, never an address
    assertEquals([owner.role, owner.reads, owner.writes], ['owner', true, true])
    assertEquals(owner.signIn, null) // already in; nowhere to send them
    let guest = await mod.store(`${anyone.origin}/recipes/api/`).me()
    assertEquals([guest.person, guest.name, guest.role], [null, null, null])
    // A `public` app: a stranger reads and does not write, and is told where
    // signing in happens, holding this page as its return address (T-32593).
    assertEquals([guest.reads, guest.writes], [true, false])
    assertMatch(guest.signIn, /^https:\/\/yaks\.app\/login\?return=/)

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
    let seen: Row[][] = []
    // The subscription asks for the title beside the status: a listing
    // carries the components its filter names, live door included.
    let stop = mod.store(`${wire.origin}/recipes/api/`)
      .subscribe('.task.status=open&.doc?', (rows: Row[]) => seen.push(rows))
    try {
      await until(() => seen.length == 1, { timeout: 15_000 })
      assertEquals(titles(seen[0]), ['Lemon cake'])
      // Another device writes: another tab, another phone, an agent — all the
      // same door, and the page hears it without asking.
      await store.apply({ entity: { eid: cake }, doc: { title: 'Lime cake' } })
      await until(() => seen.length == 2, { timeout: 15_000 })
      assertEquals(titles(seen[1]), ['Lime cake'])
      // A subscription is that query STILL ANSWERING, so it answers with the
      // same rows: a doc written after subscribing arrives deep-equal to what
      // `query()` hands back for the same filter — its kind, its body, and no
      // eid inside a component. The live door used to stream the wire's raw
      // changes, so the first push wiped the words the first paint drew
      // (C-32624 item 2).
      await store.apply({
        doc: { title: 'Fig tart', body: 'six figs, honey' },
        task: { status: 'open' },
      })
      await until(() => seen.length == 3, { timeout: 15_000 })
      assertEquals(seen[2], await store.query('.task.status=open&.doc?'))
      let fig = seen[2].find((r) => r.doc.title == 'Fig tart')!
      assertEquals(fig.doc.body, 'six figs, honey')
      assertEquals(fig.kind, 'task')
      assertEquals('eid' in fig.doc, false)
      assertEquals(fig.entity.eid.length, 36)
      // The live half carries the byline the same way, because it is the
      // same projection: a page that watches a list draws its writers
      // without a second question.
      let bylined: Row[][] = []
      let quiet = mod.store(`${wire.origin}/recipes/api/`)
        .subscribe('.doc!&.created!', (rows: Row[]) => bylined.push(rows))
      try {
        await until(() => bylined.length == 1, { timeout: 15_000 })
        assertEquals(
          [...new Set(bylined[0].map((r) => r.created.by.name))],
          [them.name],
        )
      } finally {
        quiet()
      }
    } finally {
      stop()
      await wire.stop()
    }

    // A byline, on the row: `created.by` names the writer AND says what this
    // store calls them — the name they gave at sign-in — so a view that gets
    // one query still draws a name instead of "someone" (C-32730 item 5), and
    // two people on a page are told apart (C-32624 item 3). The guide's one
    // line.
    let [entry] = await store.query('.doc.title~=Fig&.created!')
    assertEquals(entry.created.by.name, them.name)
    assertEquals(entry.created.by.eid.length, 36)
    // The eid is still the value a write takes: the row a page read, handed
    // straight back — and the column it lands in answers with the name too,
    // since the byline is a rule about references and not about one stamp.
    await store.apply({
      entity: { eid: entry.entity.eid },
      task: { assignee: entry.created.by },
    })
    let [reread] = await store.query('.doc.title~=Fig&.created!&.task?')
    assertEquals(reread.task.assignee, entry.created.by)
    let people = await store.query('.person!&.doc?')
    assertEquals(people.map((p: Row) => p.doc.title), [them.name])
    // Their address stays in the directory: an app's store learns a name and
    // never an address book, so a `public` app answering `.person!` to a
    // stranger hands out no roster of addresses (T-32654). And a person is
    // not a row the page saved, so an ordinary listing leaves them out —
    // `.person!` is how you ask.
    assertEquals('email' in people[0], false)
    assertEquals(JSON.stringify(people).includes('@'), false)
    assertEquals(
      (await store.query('.doc!')).some((r: Row) => r.doc.title == them.email),
      false,
    )

    // A refusal arrives as the server's own sentence, not a status code and
    // not a machine word (C-32574 item 2) — and, when signing in is the way
    // through, the door that does it, carrying this page back (T-32593).
    let strangers = await assertRejects(
      () => mod.store(`${anyone.origin}/recipes/api/`).apply({ doc: {} }),
      Error,
      'sign in to change this app',
    )
    assertMatch(
      (strangers as Error & { signIn: string }).signIn,
      /^https:\/\/yaks\.app\/login\?return=/,
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

// Two things a page needs told once, both of them a path (C-32800 items 6
// and 7): an app's pretty paths make a RELATIVE import wrong, and `store()`
// takes an address that IS a path, since every app in a space shares one
// hostname.
slow('the client at a pretty path, and a sibling app by path', async () => {
  let k = await kernel()
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-client-' })
  let them = await seed(k, [{ slug: 'nora', apps: ['reading', 'lending'] }])
  let mine = browser(k, 'nora.yaks.app', them.cookie)
  try {
    // The page imports the client ABSOLUTELY, by the app's own slug, and is
    // opened at an address that names no file — served the app's index.html
    // (T-32769). A relative import would have resolved against THAT address.
    let page = '<!doctype html><h1>Books</h1><script type="module">' +
      "import { query, store } from '/reading/api/client.js'</script>"
    await client(k, 'nora.yaks.app', 'reading', them.cookie)
      .put('/index.html', page)
    let deep = await k.at('nora.yaks.app', '/reading/loans/1')
    assertEquals(deep.status, 200)
    assertStringIncludes(await deep.text(), '/reading/api/client.js')
    // What the page asks for is there; what a relative path would have asked
    // for from that address is not.
    assertEquals(
      (await k.at('nora.yaks.app', '/reading/api/client.js')).status,
      200,
    )
    let missed = await k.at('nora.yaks.app', '/reading/loans/api/client.js')
    assertEquals(missed.status, 404)
    await missed.body?.cancel()

    // The module as that page holds it: a page has an ORIGIN, which is what
    // an address that is a path resolves against.
    let source = await (await k.at('nora.yaks.app', '/reading/api/client.js'))
      .text()
    Deno.writeTextFileSync(`${dir}/client.js`, source)
    let mod = await import(`file://${dir}/client.js`)
    Object.defineProperty(globalThis, 'location', {
      value: { origin: mine.origin, href: `${mine.origin}/reading/loans/1` },
      configurable: true,
    })
    try {
      await mod.store(`${mine.origin}/lending/api/`)
        .apply({ doc: { title: 'Piranesi, lent' } })
      // The guide's exact line: a path, not a URL. `new URL` takes no bare
      // path as a base, so the documented call threw `Invalid base URL`.
      let lending = mod.store('/lending/api/')
      assertEquals(
        (await lending.query('.doc!')).map((r: Row) => r.doc.title),
        ['Piranesi, lent'],
      )
      // The doors hang UNDER that address, so a path that names the api
      // directory without the slash still means the directory.
      assertEquals((await mod.store('/lending/api').query('.doc!')).length, 1)
      // And the page's own app is a path like any other.
      assertEquals(await mod.store('/reading/api/').query('.doc!'), [])
    } finally {
      Reflect.deleteProperty(globalThis, 'location')
    }
  } finally {
    await mine.stop()
    Deno.removeSync(dir, { recursive: true })
    await k.stop()
  }
})
