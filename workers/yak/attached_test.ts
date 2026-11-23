// An app attached to another app's store (store_attach, attached.ts): a
// sandboxed copy's page token opens that store's data doors as the person who
// loaded the page, and nothing else of its space, until it is detached.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { connector, kernel, owned, signIn } from './probe.ts'

test('a sandboxed app reaches the one store it is attached to', async () => {
  let k = await kernel()
  try {
    let me = await signIn(k)
    let agent = connector(k, me.cookie)
    let tag = crypto.randomUUID().slice(0, 8)
    let [pub, home] = [`pub-${tag}`, `home-${tag}`]
    let made = async (space: string, app: string) => {
      await agent.tool('app_new', { space, slug: app, title: app })
      await agent.tool('app_files', {
        space,
        app,
        files: [{ path: 'index.html', content: `<h1>${app}</h1>` }],
      })
      await agent.tool('app_deploy', { space, app })
    }
    await owned(k, me.person, pub)
    await owned(k, me.person, home)
    await made(pub, 'office')
    await agent.tool('app_publish', {
      space: pub,
      app: 'office',
      name: `office-${tag}`,
    })
    await made(home, 'shop')
    await made(home, 'notes')
    await agent.tool('app_install', { space: home, name: `office-${tag}` })
    await agent.tool('app_set', { space: home, app: 'office', sandboxed: true })

    let at = (path: string, init: RequestInit = {}) =>
      k.at(`${home}.yaks.app`, path, init)
    let cookie = { cookie: me.cookie }
    let opaque = { origin: 'null' }
    let status = async (path: string, init: RequestInit = {}) => {
      let r = await at(path, { headers: opaque, ...init })
      await r.body?.cancel()
      return r.status
    }
    let rows = async (path: string, headers: HeadersInit = opaque) => {
      let r = await at(`${path}api/query?.doc`, { headers })
      assertEquals(r.status, 200, await r.clone().text())
      return (await r.json()).map((b: { doc: { title: string } }) =>
        b.doc.title
      )
    }
    let wrote = await at('/shop/api/apply', {
      method: 'POST',
      headers: { ...cookie, 'content-type': 'application/json' },
      body: JSON.stringify([{ doc: { title: 'Order 1' } }]),
    })
    assertEquals(wrote.status, 200, await wrote.text())

    let html = await (await at('/office/', { headers: cookie })).text()
    let token = /<base href="\/office\/~([^"/]+)\/">/.exec(html)?.[1]
    assert(token, html)
    let shop = `/shop/~${token}/`

    // Before it is attached, its token opens no sibling.
    assertEquals(await status(`${shop}api/query?.doc`), 404)

    assertStringIncludes(
      await agent.tool('store_attach', {
        space: home,
        app: 'office',
        store: 'shop',
      }),
      'env.SHOP',
    )
    let env = await at(`/office/~${token}/api/env`, { headers: opaque })
    assertEquals(await env.json(), { SHOP: '/shop/api/' })

    // Attached: the shop's rows, read and written as the person, for any
    // origin, since the page's is opaque.
    let read = await at(`${shop}api/query?.doc`, { headers: opaque })
    assertEquals(read.headers.get('access-control-allow-origin'), '*')
    await read.body?.cancel()
    assertEquals(await rows(shop), ['Order 1'])
    let added = await at(`${shop}api/apply`, {
      method: 'POST',
      headers: { ...opaque, 'content-type': 'application/json' },
      body: JSON.stringify([{ doc: { title: 'Order 2' } }]),
    })
    assertEquals(added.status, 200, await added.text())
    assertEquals((await rows('/shop/', cookie)).sort(), ['Order 1', 'Order 2'])

    // Only the shop's data: never its connections, its pages, or another
    // app in the space.
    assertEquals(await status(`${shop}api/env`), 401)
    assertEquals(await status(`${shop}api/fetch?url=https://example.com`), 401)
    assertEquals(await status(shop), 401)
    assertEquals(await status(`/notes/~${token}/api/query?.doc`), 404)

    // Detached, it is refused at its next request.
    await agent.tool('store_attach', {
      space: home,
      app: 'office',
      store: 'shop',
      detach: true,
    })
    assertEquals(await status(`${shop}api/query?.doc`), 404)
  } finally {
    await k.stop()
  }
})
