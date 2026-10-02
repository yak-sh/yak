import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import * as apps from './apps.ts'
import { ADA, ADA_OWNS, as, platform, seeded, visit } from './serving-probe.ts'

let ELI = 'e0000000-0000-4000-8000-000000000001'
let assets = {
  fetch: (req: Request) =>
    Promise.resolve(
      new URL(req.url).pathname == '/_web/index.html'
        ? new Response(
          '<html><head></head><body><script src="/web/app.js"></script></body></html>',
          { headers: { 'content-type': 'text/html' } },
        )
        : new Response('asset', {
          headers: { 'content-type': 'text/javascript' },
        }),
    ),
}

test('app web is member-only even for open apps; mounts the store and signed-in person', async () => {
  using p = platform({ ASSETS: assets })
  let { env } = p
  let { dir, space, app } = await seeded(env, 'open')
  await dir.apply(
    { entities: [{ entity: { eid: ELI }, person: {} }] },
    ADA_OWNS,
  )
  let get = (path: string, cookie?: string) =>
    apps.fetch(visit(path, { headers: cookie ? { cookie } : {} }), env)
  for (
    let path of [
      '/cookbook/_web',
      '/cookbook/_web/web/app.js',
      '/cookbook/_web/owner',
    ]
  ) {
    let anonymous = await get(path)
    assertEquals(anonymous.status, 401)
    assertEquals((await anonymous.json()).error.code, 'not_a_reader')
    let outsider = await get(path, await as(ELI))
    assertEquals(outsider.status, 403)
    assertEquals((await outsider.json()).error.code, 'not_a_reader')
  }
  let cookie = await as(ADA)
  let page = await get('/cookbook/_web', cookie)
  assertEquals(page.status, 200)
  let html = await page.text()
  assert(html.includes('"api":"/cookbook/api"'))
  assert(html.includes('src="/cookbook/_web/web/app.js"'))
  assertEquals(await (await get('/cookbook/_web/owner', cookie)).json(), {
    owner: ADA,
  })
  await dir.apply({
    entities: [{
      entity: { eid: '$seat' },
      member: { space: space.eid, person: ELI, role: 'viewer' },
    }],
  }, ADA_OWNS)
  assertEquals((await get('/cookbook/_web', await as(ELI))).status, 200)
  assertEquals(
    await (await get('/cookbook/_web/owner', await as(ELI))).json(),
    { owner: ELI },
  )
  await dir.apply({
    entities: [{ entity: { eid: app.eid }, home: {} }],
  }, ADA_OWNS)
  let home = await get('/cookbook/_web', cookie)
  assert((await home.text()).includes('"page":"/cookbook/_web"'))
  assertEquals(await (await get('/cookbook/_web/owner', cookie)).json(), {
    owner: ADA,
  })
  let missing = await get('/absent/_web', cookie)
  assertEquals(missing.status, 404)
  assertEquals((await missing.json()).error.code, 'not_found')
})

test('app vocab speaks the shared docs+keywords wire; census is a normal query', async () => {
  using p = platform({ ASSETS: assets })
  let { env } = p
  await seeded(env, 'private')
  let cookie = await as(ADA)
  let get = (path: string) =>
    apps.fetch(visit(path, { headers: { cookie } }), env)
  let res = await get('/cookbook/api/vocab')
  assertEquals(res.status, 200)
  let wire = await res.json()
  assert(Array.isArray(wire.docs))
  assert(Array.isArray(wire.keywords))
  assertEquals(wire.docs, await (await get('/cookbook/api/vocab.json')).json())
  let census = await get(
    '/cookbook/api/query?q=' + encodeURIComponent('.archetype'),
  )
  assertEquals(census.status, 200)
  assert(Array.isArray(await census.json()))
  let tally = await get(
    '/cookbook/api/query?q=' + encodeURIComponent('.tally=entity.archetype'),
  )
  assertEquals(tally.status, 200)
  assertEquals(typeof await tally.json(), 'object')
})
