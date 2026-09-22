// An app installed from somebody else's release runs sandboxed in its own
// origin (installed.ts, D-37901), on a local kernel: its page is walled, its
// API hears its page token and never the cookie, one app's token opens no
// other, it borrows no word, it keeps a page's storage, and its owner can
// trust it out of all of it.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { connector, kernel, signIn, txt, vocabFile } from './probe.ts'

slow('an installed app runs sandboxed until its owner trusts it', async () => {
  let k = await kernel()
  try {
    let me = await signIn(k)
    let agent = connector(k, me.cookie)
    let tag = crypto.randomUUID().slice(0, 8)
    let pub = `pub-${tag}`
    let home = `home-${tag}`
    let offer = `notes-${tag}`
    let wrote = async (space: string, app: string) => {
      await agent.tool('space_new', { slug: space, title: space })
        .catch(() => {})
      await agent.tool('app_new', { space, slug: app, title: app })
      await agent.tool('app_files', {
        space,
        app,
        files: [
          { path: 'index.html', content: '<h1>notes</h1>' },
          {
            path: 'vocab.json',
            content: vocabFile({ recipe: { title: txt } }),
          },
        ],
      })
      await agent.tool('app_deploy', { space, app })
    }
    await wrote(pub, 'notes')
    await agent.tool('app_publish', { space: pub, app: 'notes', name: offer })
    // The space's own app, declaring the same word first: it would be the
    // word's home, and the copy must not borrow it.
    await wrote(home, 'pantry')
    await agent.tool('app_install', { space: home, name: offer })
    await agent.tool('app_install', { space: home, name: offer, as: 'other' })
    let host = `${home}.yaks.app`
    let cookie = { cookie: me.cookie }
    let at = (path: string, init: RequestInit = {}) => k.at(host, path, init)
    let json = async (r: Response) => {
      assertEquals(r.status, 200, `${r.url}: ${await r.clone().text()}`)
      return await r.json()
    }

    // The page: walled, never same-origin, no referrer, and its token in the
    // base every relative URL resolves against.
    let page = await at('/notes/', { headers: cookie })
    let csp = page.headers.get('content-security-policy') ?? ''
    assertStringIncludes(csp, 'sandbox allow-scripts allow-forms allow-popups')
    assert(!csp.includes('allow-same-origin'))
    assertEquals(page.headers.get('referrer-policy'), 'no-referrer')
    assertStringIncludes(page.headers.get('cache-control') ?? '', 'no-store')
    let html = await page.text()
    let base = /<base href="(\/notes\/~([^"/]+)\/)">/.exec(html)
    assert(base, html)
    let [, mine, token] = base
    assertStringIncludes(html, `<script src="${mine}api/storage.js"></script>`)
    assertStringIncludes(html, `<script src="${mine}api/report.js"></script>`)

    // The API hears the token, from its path or as a bearer, and never the
    // cookie. The page's origin is opaque, so it says `null`.
    let opaque = { origin: 'null' }
    assertEquals(
      (await json(await at('/notes/api/me', { headers: cookie }))).person,
      null,
    )
    let viaPath = await at(`${mine}api/me`, { headers: opaque })
    assertEquals(viaPath.headers.get('access-control-allow-origin'), '*')
    let said = await json(viaPath)
    assertEquals([said.person, said.role], [me.person, 'owner'])
    let bearer = { authorization: `Bearer ${token}` }
    assertEquals(
      (await json(await at('/notes/api/me', { headers: bearer }))).person,
      me.person,
    )
    // A cookie riding along on the token's path is taken off, not added.
    let both = await at(`${mine}api/me`, { headers: { ...cookie, ...opaque } })
    assertEquals((await json(both)).person, me.person)

    // The browser's question before a JSON write, answered for any origin.
    let pre = await at(`${mine}api/apply`, {
      method: 'OPTIONS',
      headers: { ...opaque, 'access-control-request-headers': 'content-type' },
    })
    assertEquals(pre.status, 204)
    assertEquals(pre.headers.get('access-control-allow-origin'), '*')
    assertEquals(
      pre.headers.get('access-control-allow-headers'),
      'content-type',
    )

    // Its words stay in its own store: a recipe written through the copy is
    // the copy's, and the space's own app that declared `recipe` first never
    // sees it.
    let wrote1 = await at(`${mine}api/apply`, {
      method: 'POST',
      headers: { ...opaque, 'content-type': 'application/json' },
      body: JSON.stringify([{ recipe: { title: 'Soup' } }]),
    })
    await json(wrote1)
    let held = await json(await at(`${mine}api/query?.recipe`))
    assertEquals(
      held.map((r: { recipe: { title: string } }) => r.recipe.title),
      [
        'Soup',
      ],
    )
    assertEquals(
      await json(await at('/pantry/api/query?.recipe', { headers: cookie })),
      [],
    )

    // Writing the app's code is never its page's.
    let put = await at(`${mine}api/files/evil.html`, {
      method: 'PUT',
      headers: opaque,
      body: '<p>mine now</p>',
    })
    assert(put.status == 401 || put.status == 403, `${put.status}`)
    await put.body?.cancel()

    // A link the page follows loads the page afresh at the clean address.
    let nav = await at(`${mine}index.html`, {
      redirect: 'manual',
      headers: { 'sec-fetch-mode': 'navigate' },
    })
    assertEquals(nav.status, 302)
    assertEquals(nav.headers.get('location'), '/notes/index.html')
    await nav.body?.cancel()

    // One app's token is nobody at every other app.
    let elsewhere = await at(`/other/~${token}/api/me`, { headers: opaque })
    assertEquals((await json(elsewhere)).person, null)

    // localStorage, kept per person in the copy's own store, and handed to
    // the next page load.
    let shim = await at(`${mine}api/storage.js`, { headers: opaque })
    assertEquals(shim.status, 200)
    assertEquals(shim.headers.get('access-control-allow-origin'), '*')
    assertStringIncludes(await shim.text(), 'yak-storage')
    await json(
      await at(`${mine}api/storage`, {
        method: 'POST',
        headers: { ...opaque, 'content-type': 'application/json' },
        body: JSON.stringify({ set: { theme: 'dark', '<x>': '</script>' } }),
      }),
    )
    assertEquals(await json(await at(`${mine}api/storage`)), {
      theme: 'dark',
      '<x>': '</script>',
    })
    let again = await (await at('/notes/', { headers: cookie })).text()
    assertStringIncludes(again, '"theme":"dark"')
    assert(!again.includes('"</script>"'), 'a saved value closed the block')

    // The space's own app is not walled.
    let own = await at('/pantry/', { headers: cookie })
    assertEquals(
      own.headers.get('content-security-policy')?.includes('sandbox'),
      false,
    )
    assertStringIncludes(await own.text(), '<base href="/pantry/">')

    // Trusted, it runs like the space's own: no wall, a clean base, and the
    // cookie at its API.
    assertStringIncludes(
      await agent.tool('app_set', { space: home, app: 'notes', trusted: true }),
      'trusted',
    )
    let freed = await at('/notes/', { headers: cookie })
    assertEquals(
      freed.headers.get('content-security-policy')?.includes('sandbox'),
      false,
    )
    assertStringIncludes(await freed.text(), '<base href="/notes/">')
    assertEquals(
      (await json(await at('/notes/api/me', { headers: cookie }))).person,
      me.person,
    )
  } finally {
    await k.stop()
  }
})
