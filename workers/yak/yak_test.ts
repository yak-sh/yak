// The kernel's contract, held in workerd itself (probe.ts boots it): the
// apex and its soft 404, a space and app born in the directory and served,
// the session cookie forged and signed, the file door, the graph API, and a
// route that threw becoming an error entity behind a soft page.
import { assert, assertEquals, assertMatch } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, kernel, seed, signedIn } from './probe.ts'

slow('the kernel routes, vouches, serves, and surfaces', async () => {
  let k = await kernel()
  try {
    // The apex: the home page, its assets, and a soft 404 in its voice.
    let home = await k.at('yaks.app', '/')
    assertEquals(home.status, 200)
    assertMatch(await home.text(), /Your ideas, made into little apps/)
    let css = await k.at('yaks.app', '/style.css')
    assertMatch(css.headers.get('content-type') ?? '', /text\/css/)
    await css.body?.cancel()
    let lost = await k.at('yaks.app', '/no/such/page')
    assertEquals(lost.status, 404)
    assertMatch(await lost.text(), /wandered off/)
    // A dev host is the apex too; the reserved doors answer, softly.
    assertEquals((await k.at('127.0.0.1', '/')).status, 200)
    let login = await k.at('yaks.app', '/login')
    assertEquals(login.status, 404)
    assertMatch(await login.text(), /Sign-in/)
    let mcp = await k.at('yaks.app', '/mcp')
    assertEquals(mcp.status, 404)
    assertEquals((await mcp.json()).error.code, 'not_here_yet')

    // A space nobody made, and a space made through the meta store.
    let nowhere = await k.at('nowhere.yaks.app', '/')
    assertEquals(nowhere.status, 404)
    assertMatch(await nowhere.text(), /Nothing here yet/)
    let jeff = crypto.randomUUID()
    let eids = await seed(k, jeff, [{
      slug: 'jeff',
      apps: ['recipes', 'garden'],
      home: 'recipes',
    }])
    let bare = await k.at('jeff.yaks.app', '/', { redirect: 'manual' })
    assertEquals(bare.status, 302)
    assertEquals(bare.headers.get('location'), '/recipes/')
    let slash = await k.at('jeff.yaks.app', '/recipes', { redirect: 'manual' })
    assertEquals(slash.status, 302)
    assertEquals(slash.headers.get('location'), '/recipes/')
    let empty = await k.at('jeff.yaks.app', '/recipes/')
    assertEquals(empty.status, 404)
    assertMatch(await empty.text(), /Nothing here yet/)
    assertEquals((await k.at('jeff.yaks.app', '/nope/')).status, 404)

    // The file door: nobody and a forgery are refused, the owner is not; the
    // planted file then serves at its path with its type.
    let cookie = await signedIn(k, jeff)
    let forged = cookie.replace(/.$/, (c) => (c == 'A' ? 'B' : 'A'))
    let owner = client(k, 'jeff.yaks.app', 'recipes', cookie)
    let nobody = client(k, 'jeff.yaks.app', 'recipes')
    let forger = client(k, 'jeff.yaks.app', 'recipes', forged)
    let page = '<!doctype html><h1>Our recipe box</h1>'
    assertEquals((await nobody.put('/index.html', page)).status, 401)
    assertEquals((await forger.put('/index.html', page)).status, 401)
    assertEquals((await owner.put('/index.html', page)).status, 200)
    assertEquals(
      (await owner.put('/style.css', 'h1 { color: peru }')).status,
      200,
    )
    let served = await k.at('jeff.yaks.app', '/recipes/')
    assertEquals(served.status, 200)
    assertMatch(served.headers.get('content-type') ?? '', /text\/html/)
    assertEquals(await served.text(), page)
    let style = await k.at('jeff.yaks.app', '/recipes/style.css')
    assertMatch(style.headers.get('content-type') ?? '', /text\/css/)
    assertEquals(await style.text(), 'h1 { color: peru }')
    // Another app in the space has its own files and its own store.
    assertEquals((await k.at('jeff.yaks.app', '/garden/')).status, 404)

    // The graph API: the store is named by the route, the session is vouched
    // for, and a batch round-trips. A viewer may read and not write.
    let who = await (await k.at('jeff.yaks.app', '/recipes/api/graph', {
      headers: { cookie },
    })).json()
    assertEquals(who.db, 'do:jeff/recipes')
    assertEquals(who.person, jeff)
    assertEquals(who.role, 'owner')
    let anon = await (await k.at('jeff.yaks.app', '/recipes/api/graph')).json()
    assertEquals([anon.person, anon.role], [null, null])
    let cake = crypto.randomUUID()
    assertEquals((await nobody.post([])).status, 401)
    await owner.applied([
      { eid: cake, name: 'doc', comp: { title: "Grandma's lemon cake" } },
    ])
    let [hit] = await owner.get(`id=${cake}`)
    assertEquals((hit.doc as { title: string }).title, "Grandma's lemon cake")
    assertEquals(await nobody.get(`id=${cake}`), [hit])
    assertEquals(
      await client(k, 'jeff.yaks.app', 'garden').get(`id=${cake}`),
      [],
    )
    let maya = crypto.randomUUID()
    await owner.applied([
      { eid: maya, name: 'person', comp: {} },
    ])
    await client(k, 'yak.yaks.app', 'platform', cookie).applied([
      { eid: maya, name: 'person', comp: {} },
      {
        eid: crypto.randomUUID(),
        name: 'member',
        comp: { space: eids.jeff, person: maya, role: 'viewer' },
      },
    ])
    let viewer = client(k, 'jeff.yaks.app', 'recipes', await signedIn(k, maya))
    assertEquals((await viewer.post([])).status, 403)
    assertEquals((await viewer.put('/x.txt', 'no')).status, 403)
    assertEquals((await viewer.get(`id=${cake}`)).length, 1)
    // The meta space admits nobody new once it has an owner.
    let stranger = client(
      k,
      'yak.yaks.app',
      'platform',
      await signedIn(k, maya),
    )
    assertEquals((await stranger.post([])).status, 403)

    // A route that throws — a malformed escape in a file path — answers with
    // the soft page and leaves an exception entity in the app's store, naming
    // the request and carrying the message and stack; nothing wears `error`,
    // the facet for a failure the platform expected.
    let broke = await k.at('jeff.yaks.app', '/recipes/%E0%A4%A')
    assertEquals(broke.status, 500)
    assertMatch(await broke.text(), /Something went wrong/)
    let [broken] = await owner.get('.exception!')
    assert(broken, 'an exception entity')
    let ex = broken.exception as { message: string; stack: string }
    assertEquals(
      (broken.doc as { title: string }).title,
      'GET /recipes/%E0%A4%A',
    )
    assertMatch(ex.message, /URI/)
    assertMatch(ex.stack, /URIError|decodeURIComponent/)
    assertEquals(await owner.get('.error!'), [])
    // The kernel flag is the kernel's: a client sending it is still a client,
    // and its server-owned change is dropped, not written.
    let forgedFlag = await k.at('jeff.yaks.app', '/recipes/api/apply', {
      method: 'POST',
      headers: { cookie, 'x-yak-kernel': '1' },
      body: JSON.stringify([{
        eid: crypto.randomUUID(),
        name: 'exception',
        comp: { message: 'forged' },
      }]),
    })
    assertEquals(forgedFlag.status, 200)
    assertEquals((await owner.get('.exception!')).length, 1)
  } finally {
    await k.stop()
  }
})
