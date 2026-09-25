// A person's own domain, held in workerd (T-33037, T-34596): a hostname the
// directory has never been given gets the branded provisioning page (index.ts
// `settling`, T-33036 — provisioning_workerd_test.ts is where that page itself is
// held), and one it has been given, marked active, serves the place it names.
// Both places are here: an app, at the root of the domain with the paths below
// it the app's own, and a space, which is that space's own hostname under
// another name — front page at `/`, every app at `/<app>/`. The hostname is the
// key, so two spaces cannot both claim it.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import {
  attached,
  client,
  connector,
  kernel,
  meta,
  plus,
  seed,
} from './probe.ts'

Deno.test('a hostname finds its app, and only one app', async () => {
  let k = await kernel()
  try {
    // Before anything is attached, someone else's hostname is a foreign host
    // the directory has never heard of (index.ts `settling`, T-33036): it
    // gets the branded "still connecting" page, never the apex's own home
    // page and never a blank — provisioning_workerd_test.ts holds that page to its
    // own bytes; this only has to know it is not the apex's.
    let apex = await (await k.at('yaks.app', '/')).text()
    let before = await k.at('herbusiness101.com', '/')
    assertEquals(before.status, 503)
    assert((await before.text()) != apex)

    let { cookie, eids } = await seed(k, [{
      slug: 'jeff9',
      apps: ['recipes', 'garden'],
    }])
    let owner = client(k, 'jeff9.yaks.app', 'recipes', cookie)
    await owner.put(
      '/index.html',
      '<!doctype html><h1>Our recipe box</h1><img src="photo.png">',
    )
    await owner.put('/menu.html', '<!doctype html><h1>The menu</h1>')
    await owner.put('/photo.png', 'not really a png')

    // The domain, written where the directory lives.
    let dir = meta(k)
    await dir.apply([{
      hostname: {
        name: 'herbusiness101.com',
        serves: eids['jeff9/recipes'],
        stage: 'active',
      },
    }])

    // The app's `/` is the domain's `/` — served, not redirected into a path.
    let root = await k.at('herbusiness101.com', '/', { redirect: 'manual' })
    assertEquals(root.status, 200)
    let html = await root.text()
    assertStringIncludes(html, 'Our recipe box')
    // Its pages resolve from the domain's root, which is where the app is:
    // `photo.png` on that page is `herbusiness.com/photo.png`, and the base
    // the kernel injects has to say so (apps.ts `based`, T-33040). With the
    // app's platform prefix as the base it would have asked for
    // `herbusiness.com/recipes/photo.png` — carried on to `/recipes/recipes/`
    // and lost.
    assertStringIncludes(html, '<base href="/">')
    // The reporter is at the root too, so a page's breaks on the domain
    // reach the app's store: at the app's platform prefix its script was a
    // 404 on this hostname, and nothing reported (T-33040).
    assertStringIncludes(html, '<script src="/api/report.js">')
    assertEquals(
      (await k.at('herbusiness101.com', '/api/report.js')).status,
      200,
    )
    let shot = await k.at('herbusiness101.com', '/photo.png')
    assertEquals(shot.status, 200)
    assertEquals(await shot.text(), 'not really a png')
    // And a path below it is that app's path, not a space's.
    let menu = await k.at('herbusiness101.com', '/menu.html')
    assertEquals(menu.status, 200)
    assertStringIncludes(await menu.text(), 'The menu')
    // A domain is the app's outright, `/.well-known/` included (route.ts
    // `platform`). Those files grant authority over the whole name — App
    // Links, Universal Links, Apple Pay's merchant association, control
    // proved to a certificate authority — and on her own domain the name is
    // hers, so the authority is hers to grant. That is the same idea that
    // keeps them from an app on `<space>.yaks.app`, where the name is ours
    // (home_test.ts), not an exception to it.
    let mine: [string, string][] = [
      ['/.well-known/acme-challenge/token', 'a token of her own'],
      ['/.well-known/pki-validation/ca3.txt', 'proving her domain'],
      ['/.well-known/apple-developer-merchantid-domain-association', 'pay'],
      ['/.well-known/security.txt', 'Contact: mailto:her@x.com'],
      ['/.well-known/assetlinks.json', '[]'],
      ['/.well-known/apple-app-site-association', '{}'],
    ]
    for (let [path, said] of mine) await owner.put(path, said)
    for (let [path, said] of mine) {
      let r = await k.at('herbusiness101.com', path)
      assertEquals(r.status, 200, `${path} never reached the app`)
      assertEquals(await r.text(), said, path)
    }
    // Her own `acme-challenge` costs us nothing: our renewal of her custom
    // hostname is answered by Cloudflare's edge before this Worker route ever
    // runs, which is measured rather than assumed (route.ts `platform`).
    //
    // The claim is read at the root, so the same name under an app's own
    // prefix on a hostname of ours is that app's file, and stays it.
    let deep = await k.at('jeff9.yaks.app', '/recipes/.well-known/security.txt')
    assertEquals(deep.status, 200)
    assertEquals(await deep.text(), 'Contact: mailto:her@x.com')

    // Its store answers at the app's own door, under the domain.
    let rows = await k.at('herbusiness101.com', '/api/graph')
    assertEquals(rows.status, 200)
    assertStringIncludes((await rows.json()).db, 'do:jeff9/recipes.')

    // A write comes through whole — the request is carried to the app's
    // address, body and cookie with it.
    let wrote = await k.at('herbusiness101.com', '/api/apply', {
      method: 'POST',
      body: JSON.stringify({ entities: [{ doc: { title: 'A cake' } }] }),
      headers: { cookie },
    })
    assertEquals(wrote.status, 200)
    let back = await (await k.at('herbusiness101.com', '/api/query?.doc', {
      headers: { cookie },
    })).json()
    assertEquals(back.length, 1)

    // A hostname nobody attached gets the same branded page as one that is
    // still on its way (`settling` cannot tell them apart, and does not need
    // to); every address the platform already answers on — the apex, a
    // space's own hostname — is untouched, since `foreign()` excludes them.
    let stray = await k.at('elsewhere.com', '/')
    assertEquals(stray.status, 503)
    assert((await stray.text()) != apex)
    // The space's own hostname is untouched by the domain: no app is its
    // front page, so it lists its apps (T-33040, home_test.ts). The app is at
    // the root of the domain and at `/recipes/` here — the domain is the one
    // address with nothing else in it.
    let space = await k.at('jeff9.yaks.app', '/', { redirect: 'manual' })
    assertEquals(space.status, 200)
    assertStringIncludes(await space.text(), 'href="/recipes/"')
    let under = await k.at('jeff9.yaks.app', '/recipes/')
    assertStringIncludes(await under.text(), 'Our recipe box')

    // One hostname, one place: the unique index refuses the second claim,
    // whoever makes it and whichever app it names.
    await assertRejects(
      () =>
        dir.apply([{
          hostname: {
            name: 'herbusiness101.com',
            serves: eids['jeff9/garden'],
          },
        }]),
      Error,
      'UNIQUE constraint failed: hostname.name',
    )
    let still = await k.at('herbusiness101.com', '/')
    assertStringIncludes(await still.text(), 'Our recipe box')
  } finally {
    await k.stop()
  }
})

// A domain on the space (T-34596), which is the other form: it serves the
// space exactly as `<space>.yaks.app` does — the front page at `/`, every app
// at `/<app>/` — because the request is carried to that hostname and routed by
// the same rungs, not by a second copy of them (route.ts `aimedAt`). An app of
// that space may still hold a custom domain, and there it is the root.
Deno.test('a domain on the space opens the space, apps and all', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [{
      slug: 'jeff10',
      apps: ['site', 'recipes'],
    }])
    let agent = connector(k, cookie)
    await agent.tool('app_set', { space: 'jeff10', app: 'site', home: true })
    let front = client(k, 'jeff10.yaks.app', 'site', cookie)
    await front.put('/index.html', '<!doctype html><h1>The book club</h1>')
    await front.put('/about.html', '<!doctype html><h1>Who we are</h1>')
    let box = client(k, 'jeff10.yaks.app', 'recipes', cookie)
    await box.put('/index.html', '<!doctype html><h1>Our recipe box</h1>')

    let dir = meta(k)
    await dir.apply([{
      hostname: {
        name: 'ourbookclub102.com',
        serves: eids['jeff10'],
        stage: 'active',
      },
    }])

    // The front page at the domain's root, served rather than redirected —
    // and mounted at `/` because that is where the space's own hostname
    // mounts it, not because the domain said so.
    let root = await k.at('ourbookclub102.com', '/', { redirect: 'manual' })
    assertEquals(root.status, 200)
    assertStringIncludes(await root.text(), 'The book club')
    let about = await k.at('ourbookclub102.com', '/about.html')
    assertStringIncludes(await about.text(), 'Who we are')
    // And every other app of the space at its own directory, the address it
    // has on `<space>.yaks.app` — apps are directories of the domain.
    let under = await k.at('ourbookclub102.com', '/recipes/')
    assertEquals(under.status, 200)
    assertStringIncludes(await under.text(), 'Our recipe box')
    // Its pages resolve from that directory, and its store door is under it.
    assertStringIncludes(
      await (await k.at('ourbookclub102.com', '/recipes/'))
        .text(),
      '<base href="/recipes/">',
    )
    let rows = await k.at('ourbookclub102.com', '/recipes/api/graph')
    assertEquals(rows.status, 200)
    assertStringIncludes((await rows.json()).db, 'do:jeff10/recipes.')
    // The space's own doors are the space's, unchanged: a path no app claims
    // is the front page's.
    assertEquals((await k.at('ourbookclub102.com', '/nope.html')).status, 404)

    // And an app of it may hold its own domain at the same time. There the
    // app is the root; at the space's domain the same app is still a
    // directory, and neither address moves the other.
    await dir.apply([{
      hostname: {
        name: 'herbusiness102.com',
        serves: eids['jeff10/recipes'],
        stage: 'active',
      },
    }])
    let its = await k.at('herbusiness102.com', '/', { redirect: 'manual' })
    assertEquals(its.status, 200)
    let page = await its.text()
    assertStringIncludes(page, 'Our recipe box')
    assertStringIncludes(page, '<base href="/">')
    assertStringIncludes(
      await (await k.at('ourbookclub102.com', '/recipes/')).text(),
      'Our recipe box',
    )
    assertStringIncludes(
      await (await k.at('ourbookclub102.com', '/')).text(),
      'The book club',
    )
    // The space's own hostname is untouched by either.
    assertStringIncludes(
      await (await k.at('jeff10.yaks.app', '/')).text(),
      'The book club',
    )
  } finally {
    await k.stop()
  }
})

// And attaching one (T-33038), as far as it goes without the platform's
// Cloudflare token: every refusal a person can hit before Cloudflare is ever
// asked, said in its own sentence, and nothing half-written when the token is
// the thing that is missing. The Cloudflare exchange itself is held in
// domains_test.ts against the bytes the live zone answered.
Deno.test('attaching a domain: what it refuses, and what it says', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [{
      slug: 'jeff11',
      apps: ['recipes', 'garden'],
    }])
    let agent = connector(k, cookie)
    let said = (p: Promise<string>) => p.then((t) => t, (e: Error) => e.message)

    // A custom domain is Plus's (meter.ts `ceilings`). Free, the tool answers
    // the upsell and nothing about a domain — which is an answer, so the
    // fields it has none of are not fields its reply is refused for missing
    // (tool_outputs.ts). The rest of the refusals are the ones a space that
    // may have a domain still meets.
    assertStringIncludes(
      await said(agent.tool('domain_attach', {
        app: 'recipes',
        hostname: 'herbusiness103.com',
      })),
      'Custom domains require Plus',
    )
    await plus(k, eids.jeff11)

    // A space with none is told where it does answer, not just "none".
    let empty = await agent.tool('domain_status', { space: 'jeff11' })
    assertStringIncludes(empty, 'https://jeff11.yaks.app/')

    // Our own zone is not a domain anybody brought.
    assertStringIncludes(
      await said(agent.tool('domain_attach', {
        app: 'recipes',
        hostname: 'jeff11.yaks.app',
      })),
      'is on yaks.app, which is ours',
    )

    // A URL means the hostname in it — a model that pastes one is not made
    // to guess again — and a name that is no domain says what one looks like.
    assertStringIncludes(
      await said(agent.tool('domain_attach', {
        app: 'recipes',
        hostname: 'https://JEFF11.yaks.app/recipes',
      })),
      'jeff11.yaks.app is on yaks.app',
    )
    assertStringIncludes(
      await said(agent.tool('domain_attach', {
        app: 'recipes',
        hostname: 'not a domain',
      })),
      'a domain like herbusiness.com',
    )

    // A domain nobody attached is said to be nobody's here.
    assertStringIncludes(
      await agent.tool('domain_status', { space: 'jeff11' }),
      'has no custom domain',
    )
    assertStringIncludes(
      await said(agent.tool('domain_status', {
        space: 'jeff11',
        hostname: 'herbusiness103.com',
      })),
      'has no domain herbusiness103.com',
    )
    assertStringIncludes(
      await said(agent.tool('domain_detach', {
        space: 'jeff11',
        hostname: 'herbusiness103.com',
      })),
      'has no domain herbusiness103.com',
    )

    // A hostname another space holds is refused without naming that space's
    // apps: one hostname is one place, and whose place is not this caller's
    // to learn.
    let other = await seed(k, [{ slug: 'ann11', apps: ['shop'] }])
    await meta(k).apply([{
      hostname: {
        name: 'herbusiness103.com',
        serves: other.eids['ann11/shop'],
      },
    }])
    let bounced = await said(agent.tool('domain_attach', {
      app: 'recipes',
      hostname: 'herbusiness103.com',
    }))
    assertStringIncludes(bounced, 'attached to another space')
    assert(!bounced.includes('shop'), bounced)
  } finally {
    await k.stop()
  }
})

// The three tools end to end, with Cloudflare stood in for (probe.ts
// `hostnames`): the space form and the app form side by side, each saying what
// it points at, and a detach that leaves what it carried at the address it
// always had (T-34596).
Deno.test(
  'a domain is attached to a space or to an app, and says which',
  async () => {
    let k = await kernel()
    try {
      let { cookie, eids } = await seed(k, [{
        slug: 'jeff12',
        apps: ['site', 'recipes'],
      }])
      await plus(k, eids.jeff12)
      let agent = connector(k, cookie)
      await agent.tool('app_set', { space: 'jeff12', app: 'site', home: true })

      // No app named: the domain is the space's, and the answer says what that
      // means at the address rather than leaving it to be guessed.
      let space = await agent.tool('domain_attach', {
        space: 'jeff12',
        hostname: 'ourbookclub104.com',
      })
      assertStringIncludes(space, 'ourbookclub104.com is attached to jeff12.')
      assertStringIncludes(space, 'https://ourbookclub104.com/<app>/')
      assertStringIncludes(space, 'CNAME')

      // An app named: that app, at the root of its own domain — both at once.
      let app = await agent.tool('domain_attach', {
        space: 'jeff12',
        app: 'recipes',
        hostname: 'herbusiness104.com',
      })
      assertStringIncludes(
        app,
        'herbusiness104.com is attached to jeff12/recipes.',
      )
      assertStringIncludes(
        app,
        'The app answers at https://herbusiness104.com/.',
      )

      // And the status says which is which, in the same words.
      let how = await agent.tool('domain_status', { space: 'jeff12' })
      assertStringIncludes(how, 'ourbookclub104.com → jeff12')
      assertStringIncludes(how, 'herbusiness104.com → jeff12/recipes')
      assertStringIncludes(
        how,
        'every app at https://ourbookclub104.com/<app>/',
      )

      // Detached, the space keeps the one address it always had, and the app's
      // own domain is untouched.
      let gone = await agent.tool('domain_detach', {
        space: 'jeff12',
        hostname: 'ourbookclub104.com',
      })
      assertStringIncludes(gone, 'ourbookclub104.com is detached from jeff12.')
      assertStringIncludes(
        gone,
        'It still answers at https://jeff12.yaks.app/.',
      )
      let left = await agent.tool('domain_status', { space: 'jeff12' })
      assert(!left.includes('ourbookclub104.com'), left)
      assertStringIncludes(left, 'herbusiness104.com → jeff12/recipes')
      // The hostname went back to Cloudflare with it.
      assert(!await attached('ourbookclub104.com'))
      assert(await attached('herbusiness104.com'))
    } finally {
      await k.stop()
    }
  },
)

Deno.test('plan settings preserves its destination through sign-in', async () => {
  const k = await kernel()
  try {
    const { cookie } = await seed(k, [{ slug: 'plans13', apps: [] }])
    const path = '/manage/billing?space=plans13'
    const anonymous = await k.at('yaks.app', path, { redirect: 'manual' })
    assertEquals(anonymous.status, 303)
    const location = new URL(anonymous.headers.get('location')!)
    assertEquals(location.origin + location.pathname, 'https://yaks.app/login')
    assertEquals(location.searchParams.get('return'), 'https://yaks.app' + path)
    const signedIn = await k.at('yaks.app', path, { headers: { cookie } })
    assertEquals(signedIn.status, 200)
    const html = await signedIn.text()
    assertStringIncludes(html, 'Plus')
    assertStringIncludes(html, '<b>free</b>')
    assertStringIncludes(html, 'Compare plans')
  } finally {
    await k.stop()
  }
})
