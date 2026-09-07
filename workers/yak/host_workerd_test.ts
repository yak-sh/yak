import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, connector, kernel, letter, meta, seed } from './probe.ts'

slow(
  'staging serves its space, connector, issuer and sign-in link on its own host',
  async () => {
    let k = await kernel({ APEX: 'yaks.fyi' })
    try {
      let home = await k.at(k.host, '/')
      assertEquals(home.status, 200)
      let landing = await home.text()
      assertStringIncludes(landing, 'https://yourname.yaks.fyi/recipes/')
      assertStringIncludes(landing, 'yaks.app')
      assert(!/https:\/\/(?:[\w-]+\.)?yaks\.app\b/.test(landing))
      let { cookie, eids } = await seed(k, [{ slug: 'ada', apps: ['recipes'] }])
      let app = client(k, 'ada.yaks.fyi', 'recipes', cookie)
      assertEquals(
        (await app.put('/index.html', '<h1>Staging recipes</h1>')).status,
        200,
      )
      let page = await k.at('ada.yaks.fyi', '/recipes/')
      assertEquals(page.status, 200)
      assertStringIncludes(await page.text(), 'Staging recipes')
      let desk = await k.at('ada.yaks.fyi', '/_yaks', { headers: { cookie } })
      assertEquals(desk.status, 200)
      let html = await desk.text()
      assertStringIncludes(html, 'ada.yaks.fyi')
      assertStringIncludes(html, 'https://yaks.fyi/')
      assert(!html.includes('https://yaks.app/'))

      let anon = connector(k)
      let init = await anon.call('initialize')
      assertEquals(init.serverInfo.name, 'yaks.app')
      assertStringIncludes(init.instructions, 'https://yaks.fyi/login')
      let guide = await anon.call('resources/read', {
        uri: 'https://yaks.fyi/guide.md',
      })
      assert(!guide.contents[0].text.includes('https://yaks.app/'))
      let agent = connector(k, cookie)
      assertStringIncludes(
        await agent.tool('app_list'),
        'https://ada.yaks.fyi/',
      )
      let issuer = await k.at(k.host, '/.well-known/oauth-authorization-server')
      assertEquals(issuer.status, 200)
      assertEquals((await issuer.json()).issuer, 'https://yaks.fyi')
      let challenge = await k.at(k.host, '/mcp?auth=required')
      assertEquals(challenge.status, 401)
      assertStringIncludes(
        challenge.headers.get('www-authenticate') ?? '',
        'https://yaks.fyi/',
      )
      await challenge.body?.cancel()

      let email = 'staging-signin@example.com'
      let asked = await k.at(k.host, '/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email,
          return: 'https://ada.yaks.fyi/_yaks',
        }),
      })
      assertEquals(asked.status, 200)
      await asked.body?.cancel()
      let mail = await letter(k, email, 'one click')
      let link = /https:\/\/yaks\.fyi\/login\/link\?t=\S+/.exec(mail.body)?.[0]
      assert(link)
      let at = new URL(link)
      let signed = await k.at(k.host, at.pathname + at.search, {
        redirect: 'manual',
      })
      assertEquals(signed.status, 303)
      assertEquals(signed.headers.get('location'), 'https://ada.yaks.fyi/_yaks')
      assertStringIncludes(
        signed.headers.get('set-cookie') ?? '',
        'Domain=yaks.fyi',
      )
      await signed.body?.cancel()

      // Former addresses and a customer's domain take the same staging route.
      let dir = meta(k, cookie)
      await dir.apply([{
        hostname: {
          name: 'recipes.example',
          serves: eids['ada/recipes'],
          stage: 'active',
        },
      }])
      let custom = await k.at('recipes.example', '/')
      assertEquals(custom.status, 200)
      assertStringIncludes(await custom.text(), 'Staging recipes')
      await agent.tool('space_set', { space: 'ada', slug: 'grace' })
      let former = await k.at('ada.yaks.fyi', '/recipes/menu?x=1', {
        redirect: 'manual',
      })
      assertEquals(former.status, 301)
      assertEquals(
        former.headers.get('location'),
        'https://grace.yaks.fyi/recipes/menu?x=1',
      )
      await former.body?.cancel()

      // Both documented Stripe destinations reach a webhook, even before keys exist.
      for (let path of ['/stripe/webhook', '/stripe/connect']) {
        let hook = await k.at(k.host, path, { method: 'POST', body: '{}' })
        assertEquals(hook.status, 503)
        await hook.body?.cancel()
      }
    } finally {
      await k.stop()
    }
  },
)
