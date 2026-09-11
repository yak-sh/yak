// Account navigation stays available when an app owns the front page. These
// requests use the browser's cookie and form paths, including the boundaries
// that keep another space's page from changing this account.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, connector, kernel, meta, signIn, stripe } from './probe.ts'
import { MANAGE, managePath } from './route.ts'

slow('account pages remain reachable behind a custom home app', async () => {
  let k = await kernel()
  try {
    let them = await signIn(k)
    let slug = them.email.split('@')[0]
    let host = `${slug}.yaks.app`
    let agent = connector(k, them.cookie)
    let dir = meta(k, them.cookie)
    let get = (path: string, cookie = them.cookie) =>
      k.at(host, path, { redirect: 'manual', headers: { cookie } })
    let post = (
      path: string,
      fields: Record<string, string>,
      cookie = them.cookie,
      origin = `https://${host}`,
    ) =>
      k.at(host, path, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie,
          origin,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
      })
    let title = async () => {
      let [person] = await dir.query(`.eid=${them.person}&.doc?`)
      return (person.doc as { title: string }).title
    }

    for (let app of ['site', 'private-notes', 'discarded', 'manage']) {
      await agent.tool('app_new', { space: slug, slug: app, title: app })
    }
    await agent.tool('app_set', { space: slug, app: 'site', home: true })
    await agent.tool('app_set', {
      space: slug,
      app: 'private-notes',
      access: 'private',
    })
    let site = client(k, host, 'site', them.cookie)
    await (await site.put(
      '/index.html',
      '<!doctype html><h1>My front page</h1>',
    ))
      .body?.cancel()
    let existing = client(k, host, 'manage', them.cookie)
    await (await existing.put(
      '/index.html',
      '<!doctype html><h1>My manage app</h1>',
    ))
      .body?.cancel()

    assertStringIncludes(
      await (await get('/')).text(),
      '<h1>My front page</h1>',
    )
    assertStringIncludes(
      await (await get('/manage/')).text(),
      '<h1>My manage app</h1>',
    )
    let library = await get(MANAGE)
    assertEquals(library.status, 200)
    assertStringIncludes(await library.text(), 'href="/private-notes/"')
    assertEquals((await get(`${MANAGE}/missing`)).status, 404)

    // The apex can always find this account without going through its app.
    let apex = await k.at('yaks.app', '/manage', {
      redirect: 'manual',
      headers: { cookie: them.cookie },
    })
    assertEquals(apex.status, 303)
    assertEquals(apex.headers.get('location'), `https://${host}${MANAGE}`)
    let login = await k.at('yaks.app', '/manage', { redirect: 'manual' })
    assertEquals(login.status, 303)
    assertEquals(login.headers.get('location'), '/login?return=%2Fmanage')

    // An icon linked from a space's setup page still downloads from the apex.
    let setup = await (await get(managePath('connect'))).text()
    let icon = new URL(/href="([^"]+)" download="yaks-app.png"/.exec(setup)![1])
    let download = await k.at(icon.hostname, icon.pathname)
    assertEquals(
      download.headers.get('content-disposition'),
      'attachment; filename="yaks-app.png"',
    )
    assert((await download.arrayBuffer()).byteLength < 10_000)

    let settings = managePath('settings')
    let page = await (await get(settings)).text()
    assertStringIncludes(page, `action="${settings}"`)
    let saved = await post(settings, { name: 'Dana' })
    assertEquals(saved.status, 303)
    assertEquals(
      saved.headers.get('location'),
      `https://${host}${settings}?saved=1`,
    )
    assertEquals(await title(), 'Dana')
    let confirmed = await (await get(`${settings}?saved=1`)).text()
    assertStringIncludes(confirmed, 'role="status"')
    assertStringIncludes(confirmed, 'value="Dana"')
    // An address-only submission must not overwrite the independently saved name.
    assertEquals((await post(settings, { space: slug })).status, 303)
    assertEquals(await title(), 'Dana')

    await agent.tool('app_delete', { space: slug, app: 'discarded' })
    let trash = managePath('trash')
    assertStringIncludes(
      await (await get(trash)).text(),
      'name="restore" value="discarded"',
    )
    let restored = await post(trash, { restore: 'discarded' })
    assertEquals(restored.status, 303)
    assertEquals(restored.headers.get('location'), `https://${host}${trash}`)
    assertStringIncludes(await (await get(MANAGE)).text(), 'href="/discarded/"')
    let stopped = await post(managePath('selling'), { sell: 'stop' })
    assertEquals(
      stopped.headers.get('location'),
      `https://${host}${managePath('selling')}`,
    )

    let signedOut = await get(settings, '')
    assertEquals(signedOut.status, 303)
    let to = new URL(signedOut.headers.get('location')!)
    assertEquals(to.searchParams.get('return'), `https://${host}${settings}`)
    let other = await signIn(k)
    for (let path of [MANAGE, settings, trash]) {
      let hidden = await get(path, other.cookie)
      assertEquals(hidden.status, 404)
      assert(!(await hidden.text()).includes('private-notes'))
    }
    for (let cookie of ['', other.cookie]) {
      assertEquals(
        (await post(settings, { name: 'Changed' }, cookie)).status,
        404,
      )
    }
    assertEquals(
      (await post(
        settings,
        { name: 'Changed' },
        them.cookie,
        'https://other.yaks.app',
      )).status,
      404,
    )
    assertEquals(await title(), 'Dana')
    assertStringIncludes(
      await (await get('/')).text(),
      '<h1>My front page</h1>',
    )
  } finally {
    await k.stop()
  }
})

slow(
  'Billing settings open checkout and the customer portal for this space',
  async () => {
    let fake = stripe(({ path }) =>
      path == '/v1/customers'
        ? { id: 'cus_settings' }
        : { url: 'https://checkout.stripe.com/settings-test' }
    )
    let k = await kernel({
      STRIPE_KEY: 'sk_test_probe',
      STRIPE_PRICE: 'price_probe',
      STRIPE_API: fake.url,
    })
    try {
      let them = await signIn(k)
      let host = `${them.email.split('@')[0]}.yaks.app`
      let path = managePath('billing')
      let headers = { cookie: them.cookie, origin: `https://${host}` }
      let page = await (await k.at(host, path, { headers })).text()
      assertStringIncludes(page, 'Billing')
      assertStringIncludes(page, 'data-door="checkout"')
      for (let door of ['checkout', 'portal']) {
        let response = await k.at(host, path, {
          method: 'POST',
          headers,
          body: new URLSearchParams({ billing: door }),
        })
        assertEquals(response.status, 200)
        assertEquals(
          (await response.json()).url,
          'https://checkout.stripe.com/settings-test',
        )
      }
      let checkout = fake.at('/v1/checkout/sessions')!
      assertEquals(
        checkout.sent.get('success_url'),
        `https://${host}${path}?paid=1`,
      )
      assertEquals(
        checkout.sent.get('cancel_url'),
        `https://${host}${path}?paid=0`,
      )
      let portal = fake.at('/v1/billing_portal/sessions')!
      assertEquals(portal.sent.get('customer'), 'cus_settings')
      assertEquals(portal.sent.get('return_url'), `https://${host}${path}`)
      page = await (await k.at(host, path, { headers })).text()
      assertStringIncludes(page, 'data-door="portal"')
      let denied = await k.at(host, path, {
        method: 'POST',
        headers: { ...headers, origin: 'https://evil.example' },
        body: new URLSearchParams({ billing: 'portal' }),
      })
      assertEquals(denied.status, 404)
    } finally {
      await k.stop()
      await fake.stop()
    }
  },
)
