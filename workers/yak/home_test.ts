// A space's own address, held in workerd (T-33040). Two states, and both are
// a page rather than a redirect:
//
//   no front page   the apps this visitor may open, listed — the ordinary
//                   state, since being the first app claims nothing
//   a front page    that app, SERVED at the bare hostname; its own `/<app>/`
//                   forwards there, and every path no other app claims is
//                   its own
//
// The asset question is what the second test exists for. A page served at `/`
// carries the address it was served at as its `<base href>` (apps.ts
// `based`), so `photo.png` written in the page has to find the app's file.
// The test resolves the page's own relative URLs against the base the kernel
// gave it and fetches THOSE, rather than asserting a path by hand, so a base
// that moved would fail here.
//
// The listing's rule is that it names only what the viewer may open: a
// stranger must not learn that a private app exists by reading its name, so
// anonymous, member and owner are each asked separately.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, connector, kernel, seed, signIn } from './probe.ts'

// What the browser would ask for, given a page and a URL written in it: the
// page's `<base href>` resolved against the address it was served at.
let resolves = (page: string, at: string, href: string) => {
  let base = /<base href="([^"]+)">/.exec(page)?.[1]
  if (!base) throw new Error('the kernel served a page with no base')
  return new URL(href, new URL(base, new URL(at, 'https://jeff.yaks.app')))
    .pathname
}

slow('a space with no front page lists what you may open', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [
      { slug: 'jeff', apps: ['recipes', 'garden'] },
      { slug: 'bare', apps: [] },
    ])
    let agent = connector(k, them.cookie)
    await agent.tool('app_set', {
      space: 'jeff',
      app: 'garden',
      access: 'private',
    })
    let at = (cookie?: string) =>
      k.at('jeff.yaks.app', '/', {
        redirect: 'manual',
        headers: cookie ? { cookie } : {},
      })

    // A stranger: the public app by name, the private one not even as a
    // name, a way in, and what this place is.
    let out = await at()
    assertEquals(out.status, 200)
    let cold = await out.text()
    assertStringIncludes(cold, 'href="/recipes/"')
    assert(!cold.includes('garden'), cold)
    assertStringIncludes(cold, 'private')
    assertStringIncludes(cold, 'https://yaks.app/login?return=')
    assertStringIncludes(cold, 'What is yaks.app?')
    // Nothing about the page being theirs to set: it is not theirs.
    assert(!cold.includes('yours to set'), cold)

    // The owner: both apps, the sentence that says this page is a choice, and
    // no pitch or sign-in — they are home.
    let mine = await (await at(them.cookie)).text()
    assertStringIncludes(mine, 'href="/recipes/"')
    assertStringIncludes(mine, 'href="/garden/"')
    assertStringIncludes(mine, 'yours to set')
    assert(!mine.includes('What is yaks.app?'), mine)
    assert(!mine.includes('login?return='), mine)
    // And nothing is being held back from them, so nothing says so.
    assert(!mine.includes('private. Ask'), mine)

    // Someone signed in who is nobody here sees what the stranger sees, minus
    // the sign-in and the pitch: they have an account already.
    let ann = await signIn(k, `ann-${crypto.randomUUID().slice(0, 8)}@yaks.app`)
    let guest = await (await at(ann.cookie)).text()
    assertStringIncludes(guest, 'href="/recipes/"')
    assert(!guest.includes('garden'), guest)
    assertStringIncludes(guest, 'private')
    assert(!guest.includes('What is yaks.app?'), guest)

    // A space with nothing in it is still a space, and still a 200: the
    // owner is told they can build here, a stranger is told nothing is open.
    let empty = await k.at('bare.yaks.app', '/')
    assertEquals(empty.status, 200)
    assertStringIncludes(await empty.text(), 'Nothing here is open')
    let ready = await k.at('bare.yaks.app', '/', {
      headers: { cookie: them.cookie },
    })
    assertStringIncludes(await ready.text(), 'build something here')

    // Only the bare address lists. A path under a space with no front page
    // names nothing, and says so.
    let deep = await k.at('jeff.yaks.app', '/nothing/at/all')
    assertEquals(deep.status, 404)
    assertStringIncludes(await deep.text(), 'Nothing here yet')
    // A hostname nobody made is still nobody's.
    assertEquals((await k.at('nowhere.yaks.app', '/')).status, 404)
  } finally {
    await k.stop()
  }
})

slow('the front page is served at the space root', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{
      slug: 'jeff',
      apps: ['site', 'garden'],
    }])
    let agent = connector(k, cookie)
    await agent.tool('app_set', { space: 'jeff', app: 'site', home: true })
    let owner = client(k, 'jeff.yaks.app', 'site', cookie)
    // A page written the way a site is: a relative image and stylesheet, and
    // a relative link to a place that is no file.
    let page = '<!doctype html><html><head>' +
      '<link rel="stylesheet" href="style.css">' +
      '</head><body><h1>Her business</h1><img src="photo.png">' +
      '<a href="about">About</a></body></html>'
    await owner.put('/index.html', page)
    await owner.put('/photo.png', 'not really a png')
    await owner.put('/style.css', 'h1 { color: peru }')
    await owner.put('/deep/note.txt', 'down a directory')

    // The root IS the app: 200 with its page, not a 302 into `/site/`.
    let root = await k.at('jeff.yaks.app', '/', { redirect: 'manual' })
    assertEquals(root.status, 200)
    assertStringIncludes(await root.text(), '<h1>Her business</h1>')

    // The page's own relative URLs, resolved as a browser would and then
    // fetched — from the root, and from a pretty path under it, where a
    // relative URL would otherwise resolve against the page's depth.
    for (let at of ['/', '/about', '/deep/anything']) {
      let served = await k.at('jeff.yaks.app', at)
      assertEquals(served.status, 200, at)
      let drawn = await served.text()
      assertStringIncludes(drawn, '<h1>Her business</h1>')
      for (
        let [href, want] of [
          ['photo.png', 'not really a png'],
          ['style.css', 'h1 { color: peru }'],
        ]
      ) {
        let to = resolves(drawn, at, href)
        let got = await k.at('jeff.yaks.app', to)
        assertEquals(got.status, 200, `${at} -> ${to}`)
        assertEquals(await got.text(), want, to)
      }
    }
    // A file down a directory, and a root-absolute address a page might
    // carry: the front page answers for every path no app claims.
    for (let path of ['/style.css', '/deep/note.txt']) {
      assertEquals((await k.at('jeff.yaks.app', path)).status, 200, path)
    }
    // Its store's doors answer at the root too — named by the hostname and
    // nothing else, the way they are on a custom domain (domain_test.ts).
    let rows = await k.at('jeff.yaks.app', '/api/graph')
    assertEquals((await rows.json()).db, 'do:jeff/site')
    // But `/<x>/api/…` named an app that is not here: a page asking a store
    // at a wrong address hears a 404, never HTML it cannot parse.
    assertEquals((await k.at('jeff.yaks.app', '/gone/api/query')).status, 404)

    // Its own `/<app>/` forwards here rather than serving the same page at a
    // second address, and takes the query string with it.
    for (let at of ['/site', '/site/', '/site/?a=1']) {
      let sent = await k.at('jeff.yaks.app', at, { redirect: 'manual' })
      assertEquals(sent.status, 302, at)
      assertEquals(
        sent.headers.get('location'),
        at.endsWith('?a=1') ? '/?a=1' : '/',
        at,
      )
      await sent.body?.cancel()
    }
    // Deeper under that prefix is no forward: a link someone holds to a file
    // lands on the file.
    let deep = await k.at('jeff.yaks.app', '/site/deep/note.txt', {
      redirect: 'manual',
    })
    assertEquals(deep.status, 200)
    assertEquals(await deep.text(), 'down a directory')

    // Precedence, stated: the space's apps own the first path segment, and
    // the front page answers what is left. `/garden` is the garden app even
    // though the front page answers for any other path.
    let sibling = await k.at('jeff.yaks.app', '/garden', {
      redirect: 'manual',
    })
    assertEquals(sibling.status, 302)
    assertEquals(sibling.headers.get('location'), '/garden/')
    assertEquals((await k.at('jeff.yaks.app', '/garden/')).status, 404)

    // The front page moves, and the addresses move with it: the app that was
    // it serves at its own prefix again — no stale forward — and the root is
    // the new one's.
    await agent.tool('app_set', { space: 'jeff', app: 'garden', home: true })
    let back = await k.at('jeff.yaks.app', '/site/', { redirect: 'manual' })
    assertEquals(back.status, 200)
    assertStringIncludes(await back.text(), '<h1>Her business</h1>')
    assertEquals(
      (await (await k.at('jeff.yaks.app', '/api/graph')).json()).db,
      'do:jeff/garden',
    )
  } finally {
    await k.stop()
  }
})
