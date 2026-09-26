// The dashboard, at the apex (T-39354): reachable whatever app owns a space's
// front page, and the old addresses on the space moving there. These requests
// use the browser's cookie and form paths, including the boundaries that keep
// another person, and another page, from changing this account.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import {
  charged,
  client,
  connector,
  kernel,
  meta,
  signIn,
  stripeKey,
} from './probe.ts'
import { MANAGE, managePath } from './route.ts'

Deno.test('the dashboard is at the apex, whatever serves the space', async () => {
  let k = await kernel()
  try {
    let them = await signIn(k)
    let slug = them.email.split('@')[0]
    let host = `${slug}.yaks.app`
    let agent = connector(k, them.cookie)
    let dir = meta(k)
    let get = (path: string, cookie = them.cookie) =>
      k.at('yaks.app', path, { redirect: 'manual', headers: { cookie } })
    let post = (
      path: string,
      fields: Record<string, string>,
      cookie = them.cookie,
      origin = 'https://yaks.app',
    ) =>
      k.at('yaks.app', path, {
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
      let [person] = await dir.query(`.eid=${them.person}&?doc`)
      return (person.doc as { title: string }).title
    }

    for (let app of ['site', 'private-notes', 'discarded']) {
      await agent.tool('app_new', { space: slug, slug: app, title: app })
    }
    // `manage` is reserved now (route.ts RESERVED), and an app that held the
    // name before that keeps it: made under another slug, then renamed in
    // the directory the way it stood before the reservation.
    let held = /\(([0-9a-f-]{36})\)/.exec(
      await agent.tool('app_new', { space: slug, slug: 'held', title: 'held' }),
    )![1]
    await dir.apply([{ entity: { eid: held }, app: { slug: 'manage' } }])
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

    // The space's own address is its apps', all of it.
    let at = (path: string) =>
      k.at(host, path, { headers: { cookie: them.cookie } })
    assertStringIncludes(await (await at('/')).text(), '<h1>My front page</h1>')
    assertStringIncludes(
      await (await at('/manage/')).text(),
      '<h1>My manage app</h1>',
    )
    let library = await get(MANAGE)
    assertEquals(library.status, 200)
    assertStringIncludes(
      await library.text(),
      `href="https://${host}/private-notes/"`,
    )
    assertEquals((await get(`${MANAGE}/missing`)).status, 404)
    let login = await k.at('yaks.app', MANAGE, { redirect: 'manual' })
    assertEquals(login.status, 303)
    assertEquals(
      new URL(login.headers.get('location')!).searchParams.get('return'),
      'https://yaks.app/manage',
    )
    await login.body?.cancel()

    // Where the dashboard was, letters and answers still send people: each
    // view moves to its own at the apex, query and all.
    for (
      let [was, now] of [
        ['/_yaks', `/manage?space=${slug}`],
        ['/_yaks/', `/manage?space=${slug}`],
        ['/_yaks/billing?paid=1', `/manage/billing?space=${slug}&paid=1`],
      ]
    ) {
      let moved = await k.at(host, was, { redirect: 'manual' })
      assertEquals(moved.status, 301, was)
      assertEquals(moved.headers.get('location'), `https://yaks.app${now}`)
      await moved.body?.cancel()
    }
    assertEquals((await k.at(host, '/_yaks/missing')).status, 404)

    // An icon linked from the setup page still downloads from the apex.
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
      `https://yaks.app${settings}?saved=1`,
    )
    assertEquals(await title(), 'Dana')
    let confirmed = await (await get(`${settings}?saved=1`)).text()
    assertStringIncludes(confirmed, 'role="status"')
    assertStringIncludes(confirmed, 'value="Dana"')
    // An address-only submission must not overwrite the independently saved name.
    assertEquals((await post(settings, { space: slug })).status, 303)
    assertEquals(await title(), 'Dana')
    // A page that names the space carries it through every link and form.
    let named = await (await get(managePath('settings', slug))).text()
    assertStringIncludes(
      named,
      `action="${managePath('settings', slug).replace('&', '&amp;')}"`,
    )
    assertStringIncludes(named, `href="${managePath('trash', slug)}"`)

    await agent.tool('app_delete', { space: slug, app: 'discarded' })
    let trash = managePath('trash')
    assertStringIncludes(
      await (await get(trash)).text(),
      'name="restore" value="discarded"',
    )
    let restored = await post(trash, { restore: 'discarded' })
    assertEquals(restored.status, 303)
    assertEquals(restored.headers.get('location'), `https://yaks.app${trash}`)
    assertStringIncludes(
      await (await get(MANAGE)).text(),
      `href="https://${host}/discarded/"`,
    )
    let stopped = await post(managePath('selling'), { sell: 'stop' })
    assertEquals(
      stopped.headers.get('location'),
      `https://yaks.app${managePath('selling')}`,
    )

    let signedOut = await get(settings, '')
    assertEquals(signedOut.status, 303)
    let to = new URL(signedOut.headers.get('location')!)
    assertEquals(to.searchParams.get('return'), `https://yaks.app${settings}`)
    // Somebody else, naming this space, is shown nothing of it; without a
    // name, they are shown their own.
    let other = await signIn(k)
    for (let view of ['apps', 'settings', 'trash'] as const) {
      let hidden = await get(managePath(view, slug), other.cookie)
      assertEquals(hidden.status, 404)
      assert(!(await hidden.text()).includes('private-notes'))
    }
    let theirs = await (await get(MANAGE, other.cookie)).text()
    assert(!theirs.includes('private-notes'), theirs)
    assertEquals(
      (await post(managePath('settings', slug), { name: 'Changed' }, ''))
        .status,
      303,
    )
    assertEquals(
      (await post(
        managePath('settings', slug),
        { name: 'Changed' },
        other.cookie,
      )).status,
      404,
    )
    assertEquals(
      (await post(
        settings,
        { name: 'Changed' },
        them.cookie,
        'https://other.yaks.app',
      )).status,
      403,
    )
    assertEquals(await title(), 'Dana')
    assertStringIncludes(await (await at('/')).text(), '<h1>My front page</h1>')
  } finally {
    await k.stop()
  }
})

Deno.test(
  'Billing management opens checkout and the customer portal for this space',
  async () => {
    let key = stripeKey()
    let k = await kernel()
    try {
      let them = await signIn(k)
      let slug = them.email.split('@')[0]
      let path = managePath('billing', slug)
      let headers = { cookie: them.cookie, origin: 'https://yaks.app' }
      let page = await (await k.at('yaks.app', path, { headers })).text()
      assertStringIncludes(page, 'Billing')
      assertStringIncludes(page, 'data-door="checkout"')
      let url: Record<string, string> = {}
      for (let door of ['checkout', 'portal']) {
        let response = await k.at('yaks.app', path, {
          method: 'POST',
          headers,
          body: new URLSearchParams({ billing: door }),
        })
        assertEquals(response.status, 200)
        url[door] = (await response.json()).url
      }
      // Where a purchase started from is where it comes back to, both ways,
      // read back off the session Stripe holds.
      let id = /cs_test_[A-Za-z0-9]+/.exec(url.checkout)?.[0]
      assert(id, `no checkout session in ${url.checkout}`)
      let made = await charged(key, `/v1/checkout/sessions/${id}`)
      assertEquals(made.success_url, `https://yaks.app${path}&paid=1`)
      assertEquals(made.cancel_url, `https://yaks.app${path}&paid=0`)
      // The portal is Stripe's own page, for the customer checkout made.
      assertStringIncludes(url.portal, 'https://billing.stripe.com/')
      page = await (await k.at('yaks.app', path, { headers })).text()
      assertStringIncludes(page, 'data-door="portal"')
      let denied = await k.at('yaks.app', path, {
        method: 'POST',
        headers: { ...headers, origin: 'https://evil.example' },
        body: new URLSearchParams({ billing: 'portal' }),
      })
      assertEquals(denied.status, 403)
    } finally {
      await k.stop()
    }
  },
)
