// A person's own domain, held in workerd (T-33037): a hostname the directory
// has never been given routes exactly as it always has — the apex — and one
// it HAS been given serves that app at its root, paths below it the app's own.
// The hostname is the key, so two spaces cannot both claim it.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, connector, kernel, meta, seed } from './probe.ts'

slow('a hostname finds its app, and only one app', async () => {
  let k = await kernel()
  try {
    // Before anything is attached, someone else's hostname answers exactly
    // what the apex answers — byte for byte, so a later copy edit cannot make
    // this pass by accident. That is the whole compatibility promise: custom
    // domains are additive.
    let apex = await (await k.at('yaks.app', '/')).text()
    let before = await k.at('herbusiness.com', '/')
    assertEquals(before.status, 200)
    assertEquals(await before.text(), apex)

    let { cookie, eids } = await seed(k, [{
      slug: 'jeff',
      apps: ['recipes', 'garden'],
    }])
    let owner = client(k, 'jeff.yaks.app', 'recipes', cookie)
    await owner.put(
      '/index.html',
      '<!doctype html><h1>Our recipe box</h1><img src="photo.png">',
    )
    await owner.put('/menu.html', '<!doctype html><h1>The menu</h1>')
    await owner.put('/photo.png', 'not really a png')

    // The domain, written where the directory lives.
    let dir = meta(k, cookie)
    await dir.apply([{
      hostname: {
        name: 'herbusiness.com',
        app: eids['jeff/recipes'],
        stage: 'active',
      },
    }])

    // The app's `/` is the domain's `/` — served, not redirected into a path.
    let root = await k.at('herbusiness.com', '/', { redirect: 'manual' })
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
    assertEquals((await k.at('herbusiness.com', '/api/report.js')).status, 200)
    let shot = await k.at('herbusiness.com', '/photo.png')
    assertEquals(shot.status, 200)
    assertEquals(await shot.text(), 'not really a png')
    // And a path below it is that app's path, not a space's.
    let menu = await k.at('herbusiness.com', '/menu.html')
    assertEquals(menu.status, 200)
    assertStringIncludes(await menu.text(), 'The menu')
    // TOP-LEVEL ROUTING WINS over anything in a space's apps (route.ts
    // `platform`). Since T-33040 the front page answers every address no app
    // claims, which handed it the paths a certificate is validated on: an app
    // serving bytes at `/.well-known/acme-challenge/<token>` could pass
    // HTTP-01 at a public CA and be issued a trusted certificate for a
    // hostname on our own zone. The platform answers those itself, at the
    // space's hostname and on a customer's domain alike — the domain being
    // where it matters, since that is the address Cloudflare validates.
    await owner.put('/.well-known/acme-challenge/token', "not the CA's")
    await owner.put('/.well-known/pki-validation/ca3.txt', "not the CA's")
    // ...and an app's OWN `.well-known` files, which the platform does not
    // claim, still reach it. That is live behaviour people rely on.
    await owner.put('/.well-known/security.txt', 'Contact: mailto:her@x.com')
    await owner.put('/.well-known/assetlinks.json', '[]')
    await owner.put('/.well-known/apple-app-site-association', '{}')
    for (
      let path of [
        '/.well-known/acme-challenge/token',
        '/.well-known/pki-validation/ca3.txt',
      ]
    ) {
      let r = await k.at('herbusiness.com', path)
      assertEquals(r.status, 404, `${path} reached the app`)
      assertEquals((await r.text()).includes("not the CA's"), false)
    }
    for (
      let [path, said] of [
        ['/.well-known/security.txt', 'Contact: mailto:her@x.com'],
        ['/.well-known/assetlinks.json', '[]'],
        ['/.well-known/apple-app-site-association', '{}'],
      ]
    ) {
      let r = await k.at('herbusiness.com', path)
      assertEquals(r.status, 200, `${path} lost the app's file`)
      assertEquals(await r.text(), said)
    }
    // The rule is about the address a CA asks at, which is the ROOT. The same
    // name under an app's own prefix is the app's file, and stays it.
    let deep = await k.at('jeff.yaks.app', '/recipes/.well-known/security.txt')
    assertEquals(deep.status, 200)
    assertEquals(await deep.text(), 'Contact: mailto:her@x.com')
    let inner = await k.at(
      'jeff.yaks.app',
      '/recipes/.well-known/acme-challenge/token',
    )
    assertEquals(inner.status, 200)

    // Its store answers at the app's own door, under the domain.
    let rows = await k.at('herbusiness.com', '/api/graph')
    assertEquals(rows.status, 200)
    assertEquals((await rows.json()).db, 'do:jeff/recipes')

    // A write comes through whole — the request is carried to the app's
    // address, body and cookie with it.
    let wrote = await k.at('herbusiness.com', '/api/apply', {
      method: 'POST',
      body: JSON.stringify({ entities: [{ doc: { title: 'A cake' } }] }),
      headers: { cookie },
    })
    assertEquals(wrote.status, 200)
    let back = await (await k.at('herbusiness.com', '/api/query?.doc!', {
      headers: { cookie },
    })).json()
    assertEquals(back.length, 1)

    // A hostname nobody attached is still the apex, and so is every address
    // the platform already answers on.
    assertEquals(await (await k.at('elsewhere.com', '/')).text(), apex)
    // The space's own hostname is untouched by the domain: no app is its
    // front page, so it lists its apps (T-33040, home_test.ts). The app is at
    // the ROOT of the domain and at `/recipes/` here — the domain is the one
    // address with nothing else in it.
    let space = await k.at('jeff.yaks.app', '/', { redirect: 'manual' })
    assertEquals(space.status, 200)
    assertStringIncludes(await space.text(), 'href="/recipes/"')
    let under = await k.at('jeff.yaks.app', '/recipes/')
    assertStringIncludes(await under.text(), 'Our recipe box')

    // One hostname, one place: the unique index refuses the second claim,
    // whoever makes it and whichever app it names.
    await assertRejects(
      () =>
        dir.apply([{
          hostname: { name: 'herbusiness.com', app: eids['jeff/garden'] },
        }]),
      Error,
      'UNIQUE constraint failed: hostname.name',
    )
    let still = await k.at('herbusiness.com', '/')
    assertStringIncludes(await still.text(), 'Our recipe box')
  } finally {
    await k.stop()
  }
})

// And attaching one (T-33038), as far as it goes without the platform's
// Cloudflare token: every refusal a person can hit before Cloudflare is ever
// asked, said in its own sentence, and nothing half-written when the token is
// the thing that is missing. The Cloudflare exchange itself is held in
// domains_test.ts against the bytes the live zone answered.
slow('attaching a domain: what it refuses, and what it says', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{
      slug: 'jeff',
      apps: ['recipes', 'garden'],
    }])
    let agent = connector(k, cookie)
    let said = (p: Promise<string>) => p.then((t) => t, (e: Error) => e.message)

    // A space with none is told where it does answer, not just "none".
    let empty = await agent.tool('domain_status', { space: 'jeff' })
    assertStringIncludes(empty, 'https://jeff.yaks.app/')

    // Our own zone is not a domain anybody brought.
    assertStringIncludes(
      await said(agent.tool('domain_attach', {
        app: 'recipes',
        hostname: 'jeff.yaks.app',
      })),
      'is on yaks.app, which is ours',
    )

    // A URL means the hostname in it — a model that pastes one is not made
    // to guess again — and a name that is no domain says what one looks like.
    assertStringIncludes(
      await said(agent.tool('domain_attach', {
        app: 'recipes',
        hostname: 'https://JEFF.yaks.app/recipes',
      })),
      'jeff.yaks.app is on yaks.app',
    )
    assertStringIncludes(
      await said(agent.tool('domain_attach', {
        app: 'recipes',
        hostname: 'not a domain',
      })),
      'a domain like herbusiness.com',
    )

    // The token is the platform's, and its absence is a sentence naming it —
    // never a 400 and never a domain half-attached.
    assertStringIncludes(
      await said(agent.tool('domain_attach', {
        app: 'recipes',
        hostname: 'herbusiness.com',
      })),
      'CF_HOSTNAMES_TOKEN',
    )
    // And nothing was written: the row would have been the claim on the name.
    assertStringIncludes(
      await agent.tool('domain_status', { space: 'jeff' }),
      'has no custom domain',
    )
    assertStringIncludes(
      await said(agent.tool('domain_status', {
        space: 'jeff',
        hostname: 'herbusiness.com',
      })),
      'has no domain herbusiness.com',
    )
    assertStringIncludes(
      await said(agent.tool('domain_detach', {
        space: 'jeff',
        hostname: 'herbusiness.com',
      })),
      'has no domain herbusiness.com',
    )

    // A hostname another space holds is refused without naming that space's
    // apps: one hostname is one place, and whose place is not this caller's
    // to learn.
    let other = await seed(k, [{ slug: 'ann', apps: ['shop'] }])
    await meta(k, cookie).apply([{
      hostname: { name: 'herbusiness.com', app: other.eids['ann/shop'] },
    }])
    let bounced = await said(agent.tool('domain_attach', {
      app: 'recipes',
      hostname: 'herbusiness.com',
    }))
    assertStringIncludes(bounced, 'attached to another space')
    assert(!bounced.includes('shop'), bounced)
  } finally {
    await k.stop()
  }
})
