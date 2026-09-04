// The branded page a custom domain gets before it has anything ready to
// answer with (index.ts `settling`, T-33036): the fallback origin answers
// every custom hostname on the zone, provisioned or not, so a foreign host
// with nothing to route to yet used to fall through to the apex's own home
// page — the wrong page on a stranger's domain — or, before the fallback
// origin existed, a raw 522. Held in workerd because the choice lives in the
// router. domain_test.ts covers the fully wired customer domain; this is the
// one state that never used to have an answer of its own.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, kernel, meta, seed } from './probe.ts'

slow(
  'a domain with nothing ready gets the branded page, not the apex',
  async () => {
    let k = await kernel()
    try {
      let apex = await (await k.at('yaks.app', '/')).text()
      // Never attached: the directory has no row for it at all, which is
      // the ordinary shape of "someone pointed a CNAME here before telling
      // us" — the exact request that used to 522.
      let hold = await k.at('herbusiness.com', '/')
      assertEquals(hold.status, 503)
      assert(hold.headers.get('retry-after'), 'no Retry-After')
      let body = await hold.text()
      assert(body.length > 0, 'a blank page')
      assert(body != apex, "the apex home page, on a stranger's domain")
      assertStringIncludes(body, 'herbusiness.com')
      // Every path on the host gets the same page, not just `/` — there is
      // nothing yet for any of them to route to.
      let deep = await k.at('herbusiness.com', '/menu.html')
      assertEquals(deep.status, 503)
    } finally {
      await k.stop()
    }
  },
)

slow('a domain marked active still routes to its app', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [{ slug: 'jeff', apps: ['recipes'] }])
    let owner = client(k, 'jeff.yaks.app', 'recipes', cookie)
    await owner.put('/index.html', '<!doctype html><h1>Our recipe box</h1>')
    // Stamped the way domain_attach leaves it once Cloudflare says so
    // (tools.ts, directory.ts `Host`) — `settling` reads this cached stage
    // and never asks Cloudflare at all once it says `active`.
    await meta(k, cookie).apply([{
      hostname: {
        name: 'herbusiness.com',
        app: eids['jeff/recipes'],
        stage: 'active',
      },
    }])
    let live = await k.at('herbusiness.com', '/')
    assertEquals(live.status, 200)
    assertStringIncludes(await live.text(), 'Our recipe box')
  } finally {
    await k.stop()
  }
})
