import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { bearerFor, connector, fresh, meta, seed, unique } from './probe.ts'
import { chatPath, managePath } from '@yaks/platform/routes'

let k = await fresh()
let slug = unique('manage-auth')
let owner = await seed(k, [{ slug, apps: [] }])
let visitor = await seed(k, [{ slug: unique('visitor'), apps: [] }])
let grant = await connector(k, owner.cookie).answer('grant', {
  space: slug,
})
let tokens = [
  grant.text.split('\n')[0].slice('yak login '.length),
  await bearerFor(k, owner.cookie),
]
let profile = managePath('profile')
let operator = managePath('operator', slug)
let ask = (token: string, path: string, method = 'GET', cookie = '') =>
  k.at('yaks.app', path, {
    method,
    redirect: 'manual',
    headers: {
      authorization: `Bearer ${token}`,
      upgrade: 'websocket',
      cookie,
      origin: 'https://yaks.app',
      'content-type': 'application/x-www-form-urlencoded',
    },
    ...(method == 'POST'
      ? { body: new URLSearchParams({ name: 'Changed through a bearer' }) }
      : {}),
  })

for (let [i, token] of tokens.entries()) {
  test(`manage pages and forms require a browser session, bearer ${i}`, async () => {
    let before = await meta(k).query(`.entity.eid=${owner.person}&?doc`)
    for (
      let [path, method] of [
        [profile, 'GET'],
        [managePath('agents'), 'GET'],
        [profile, 'POST'],
        [managePath('space'), 'POST'],
        [`${profile}?browser=1`, 'GET'],
        [`${operator}?browser=1`, 'POST'],
        [`${operator}/query?browser=1`, 'GET'],
        [`${chatPath(slug)}?browser=1`, 'GET'],
        [`${operator}?browser=1&settings-draft=1`, 'GET'],
      ]
    ) {
      let res = await ask(token, path, method)
      await res.body?.cancel()
      assertEquals(res.status, 303, `${method} ${path}`)
      assertStringIncludes(res.headers.get('location')!, '/login')
    }
    assertEquals(
      await meta(k).query(`.entity.eid=${owner.person}&?doc`),
      before,
    )
  })

  test(`manage reads the browser's identity when a bearer is also sent, bearer ${i}`, async () => {
    let res = await ask(token, profile, 'GET', visitor.cookie)
    assertEquals(res.status, 200)
    let html = await res.text()
    assertStringIncludes(html, visitor.email)
    assertEquals(html.includes(owner.email), false)
  })
}

addEventListener('unload', () => void k.stop())
