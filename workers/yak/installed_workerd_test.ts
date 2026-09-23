// An app installed from somebody else's release runs like the space's own
// apps (C-37980), and the sandbox (installed.ts, D-37901) is its owner's
// option, on a local kernel. Unsandboxed, a copy is served clean, hears the
// cookie and borrows the space's words. Sandboxed, its page is walled, its API
// hears its page token and never the cookie, one app's token opens no other,
// it keeps its words to itself, and it keeps a page's storage.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { connector, kernel, signIn, txt, vocabFile } from './probe.ts'

slow('an installed copy runs like its space, or sandboxed', async () => {
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
    // The space's own app, declaring the same word first: it is the word's
    // home, which an unsandboxed copy borrows and a sandboxed one does not.
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
    let recipes = async (path: string, init: RequestInit = {}) =>
      (await json(await at(`${path}api/query?.recipe`, init))).length
    // The copy's own command, which runs as the app does (apps.ts `acting`).
    let add = (app: string) =>
      agent.tool('command', {
        app: `${home}/${app}`,
        name: 'add_recipe',
        args: { title: 'Soup' },
      })
    let post = (path: string, body: unknown, headers = {}) =>
      at(path, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    // By default: no wall, a clean base, the cookie at its API, and the word
    // its space's own app homes is the one its command writes.
    let free = await at('/notes/', { headers: cookie })
    assertEquals(
      free.headers.get('content-security-policy')?.includes('sandbox'),
      false,
    )
    assertStringIncludes(await free.text(), '<base href="/notes/">')
    assertEquals(
      (await json(await at('/notes/api/me', { headers: cookie }))).person,
      me.person,
    )
    await add('notes')
    assertEquals(await recipes('/pantry/', { headers: cookie }), 1)

    // Sandboxed by its owner, and released so its words are its own.
    assertStringIncludes(
      await agent.tool('app_set', {
        space: home,
        app: 'other',
        sandboxed: true,
      }),
      'sandboxed',
    )
    await agent.tool('app_deploy', { space: home, app: 'other' })

    // The page: walled, never same-origin, no referrer, and its token in the
    // base every relative URL resolves against.
    let page = await at('/other/', { headers: cookie })
    let csp = page.headers.get('content-security-policy') ?? ''
    assertStringIncludes(
      csp,
      'sandbox allow-scripts allow-forms allow-popups',
    )
    assert(!csp.includes('allow-same-origin'))
    assertEquals(page.headers.get('referrer-policy'), 'no-referrer')
    assertStringIncludes(page.headers.get('cache-control') ?? '', 'no-store')
    let html = await page.text()
    let base = /<base href="(\/other\/~([^"/]+)\/)">/.exec(html)
    assert(base, html)
    let [, mine, token] = base
    assertStringIncludes(
      html,
      `<script src="${mine}api/storage.js"></script>`,
    )
    assertStringIncludes(html, `<script src="${mine}api/report.js"></script>`)

    // The API hears the token, from its path or as a bearer, and never the
    // cookie. The page's origin is opaque, so it says `null`.
    let opaque = { origin: 'null' }
    assertEquals(
      (await json(await at('/other/api/me', { headers: cookie }))).person,
      null,
    )
    let viaPath = await at(`${mine}api/me`, { headers: opaque })
    assertEquals(viaPath.headers.get('access-control-allow-origin'), '*')
    let said = await json(viaPath)
    assertEquals([said.person, said.role], [me.person, 'owner'])
    let bearer = { authorization: `Bearer ${token}` }
    assertEquals(
      (await json(await at('/other/api/me', { headers: bearer }))).person,
      me.person,
    )
    // A cookie riding along on the token's path is taken off, not added.
    let both = await at(`${mine}api/me`, {
      headers: { ...cookie, ...opaque },
    })
    assertEquals((await json(both)).person, me.person)

    // The browser's question before a JSON write, answered for any origin.
    let pre = await at(`${mine}api/apply`, {
      method: 'OPTIONS',
      headers: {
        ...opaque,
        'access-control-request-headers': 'content-type',
      },
    })
    assertEquals(pre.status, 204)
    assertEquals(pre.headers.get('access-control-allow-origin'), '*')
    assertEquals(
      pre.headers.get('access-control-allow-headers'),
      'content-type',
    )

    // Its words stay in its own store, from its page or its command: the
    // space's own app never sees them.
    await json(
      await post(`${mine}api/apply`, [{ recipe: { title: 'Stew' } }], opaque),
    )
    await add('other')
    assertEquals(await recipes(mine), 2)
    assertEquals(await recipes('/pantry/', { headers: cookie }), 1)

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
    assertEquals(nav.headers.get('location'), '/other/index.html')
    await nav.body?.cancel()

    // Its token opens no other app.
    let elsewhere = await at(`/notes/~${token}/api/me`, { headers: opaque })
    assertEquals(elsewhere.status, 404)
    await elsewhere.body?.cancel()

    // localStorage, kept per person in the copy's own store, and handed to
    // the next page load.
    let shim = await at(`${mine}api/storage.js`, { headers: opaque })
    assertEquals(shim.status, 200)
    assertEquals(shim.headers.get('access-control-allow-origin'), '*')
    assertStringIncludes(await shim.text(), 'yak-storage')
    await json(
      await post(`${mine}api/storage`, {
        set: { theme: 'dark', '<x>': '</script>' },
      }, opaque),
    )
    assertEquals(await json(await at(`${mine}api/storage`)), {
      theme: 'dark',
      '<x>': '</script>',
    })
    let again = await (await at('/other/', { headers: cookie })).text()
    assertStringIncludes(again, '"theme":"dark"')
    assert(!again.includes('"</script>"'), 'a saved value closed the block')

    // Let out again, it runs like the space's own.
    await agent.tool('app_set', {
      space: home,
      app: 'other',
      sandboxed: false,
    })
    let out = await at('/other/', { headers: cookie })
    assertEquals(
      out.headers.get('content-security-policy')?.includes('sandbox'),
      false,
    )
    assertStringIncludes(await out.text(), '<base href="/other/">')
  } finally {
    await k.stop()
  }
})
