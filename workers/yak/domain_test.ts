// A person's own domain, held in workerd (T-33037): a hostname the directory
// has never been given routes exactly as it always has — the apex — and one
// it HAS been given serves that app at its root, paths below it the app's own.
// The hostname is the key, so two spaces cannot both claim it.
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, kernel, meta, seed } from './probe.ts'

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
    await owner.put('/index.html', '<!doctype html><h1>Our recipe box</h1>')
    await owner.put('/menu.html', '<!doctype html><h1>The menu</h1>')

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
    assertStringIncludes(await root.text(), 'Our recipe box')
    // And a path below it is that app's path, not a space's.
    let menu = await k.at('herbusiness.com', '/menu.html')
    assertEquals(menu.status, 200)
    assertStringIncludes(await menu.text(), 'The menu')
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
    let space = await k.at('jeff.yaks.app', '/', { redirect: 'manual' })
    assertEquals(space.status, 302)
    assertEquals(space.headers.get('location'), '/recipes/')

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
