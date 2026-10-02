import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { accepted, bearerFor, connector, kernel, signIn } from './probe.ts'

test('app store reads honor login bearers and live membership, and reject invalid tokens', async () => {
  let k = await kernel()
  try {
    let owner = await signIn(k)
    let member = await signIn(k)
    let outsider = await signIn(k)
    let agent = connector(k, owner.cookie)
    let space = owner.email.split('@')[0]
    await agent.tool('app_new', {
      slug: 'private',
      title: 'Private',
      access: 'private',
    })
    await agent.tool('graph_apply', {
      app: 'private',
      entities: [{ entity: { eid: '$one' }, doc: { title: 'Bearer proof' } }],
    })
    await agent.tool('member_add', { email: member.email })
    await accepted(k, member.email, member.cookie)
    let ownerToken = await bearerFor(k, owner.cookie)
    let memberToken = await bearerFor(k, member.cookie)
    let outsiderToken = await bearerFor(k, outsider.cookie)
    let get = (token?: string, cookie?: string) =>
      k.at(
        `${space}.${k.host}`,
        '/private/api/query?.doc.title="Bearer%20proof"',
        {
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(cookie ? { cookie } : {}),
          },
        },
      )
    for (let token of [ownerToken, memberToken]) {
      let result = await get(token)
      assertEquals(result.status, 200)
      assertEquals((await result.json())[0].doc.title, 'Bearer proof')
    }
    for (let token of [undefined, 'invalid']) {
      let refused = await get(token)
      assertEquals(refused.status, 401)
      assertEquals((await refused.json()).error.code, 'not_a_reader')
    }
    let outside = await get(outsiderToken)
    assertEquals(outside.status, 403)
    assertEquals((await outside.json()).error.code, 'not_a_reader')
    let badWithCookie = await get('invalid', owner.cookie)
    assertEquals(badWithCookie.status, 401)
    await badWithCookie.body?.cancel()
    await agent.tool('member_remove', { email: member.email })
    let former = await get(memberToken)
    assertEquals(former.status, 403)
    await former.body?.cancel()
    // A still-live CLI grant is scoped to the space it named, even if this
    // same person owns the target space too.
    let grant = await agent.tool('grant', { space, hours: 1 })
    let narrow = /yak login (\S+)/.exec(grant)![1]
    let elsewhere = `${space}-other`
    await agent.tool('space_new', { slug: elsewhere, title: 'Elsewhere' })
    await agent.tool('app_new', {
      space: elsewhere,
      slug: 'private',
      title: 'Other',
      access: 'private',
    })
    let crossed = await k.at(
      `${elsewhere}.${k.host}`,
      '/private/api/query?.doc',
      { headers: { authorization: `Bearer ${narrow}` } },
    )
    assertEquals(crossed.status, 401)
    assertEquals((await crossed.json()).error.code, 'not_a_reader')
  } finally {
    await k.stop()
  }
})
