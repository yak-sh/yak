import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { accepted, bearerFor, connector, kernel, signIn } from './probe.ts'

test('app selector resolves commandless apps for owners and members, not strangers', async () => {
  let k = await kernel()
  try {
    let owner = await signIn(k)
    let member = await signIn(k)
    let other = await signIn(k)
    let agent = connector(k, owner.cookie)
    let space = `address-${crypto.randomUUID().slice(0, 8)}`
    await agent.tool('space_new', { slug: space, title: 'Address probe' })
    await agent.tool('app_new', { space, slug: 'empty', title: 'No commands' })
    await agent.tool('member_add', { space, email: member.email })
    await accepted(k, member.email, member.cookie)
    let bearer = await bearerFor(k, owner.cookie)
    let ask = (app: string, headers: Record<string, string> = {}) =>
      k.at(k.host, `/api/app?app=${encodeURIComponent(app)}`, { headers })
    let expected = {
      app: `${space}/empty`,
      url: `https://${space}.${k.host}/empty/api`,
    }
    let first = await ask('empty', { authorization: `Bearer ${bearer}` })
    assertEquals(
      await first.json(),
      expected,
    )
    assertEquals(
      await (await ask(`${space}/empty`, { cookie: member.cookie })).json(),
      expected,
    )
    let invalid: Record<string, string>[] = [{}, {
      authorization: 'Bearer invalid',
    }]
    for (let headers of invalid) {
      let denied = await ask(`${space}/empty`, headers)
      assertEquals(denied.status, 401)
      assertEquals((await denied.json()).error.code, 'sign_in')
    }
    let hidden = await ask(`${space}/empty`, { cookie: other.cookie })
    assertEquals(hidden.status, 404)
    assertEquals((await hidden.json()).error.code, 'not_found')
    let second = `${space}-two`
    await agent.tool('space_new', { slug: second, title: 'Another space' })
    await agent.tool('app_new', {
      space: second,
      slug: 'empty',
      title: 'Also empty',
    })
    let ambiguous = await ask('empty', { cookie: owner.cookie })
    assertEquals(ambiguous.status, 400)
    assertStringIncludes(
      (await ambiguous.json()).error.message,
      '<space>/<app>',
    )
    assertEquals(
      await (await ask(`${space}/empty`, { cookie: owner.cookie })).json(),
      expected,
    )
    let malformed = await ask('https://elsewhere/empty', {
      cookie: owner.cookie,
    })
    assertEquals(malformed.status, 400)
    await malformed.body?.cancel()
  } finally {
    await k.stop()
  }
})
