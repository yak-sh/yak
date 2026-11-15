import { test } from '@yaks/testing'
import { assertEquals, assertMatch } from '@std/assert'
import {
  accepted,
  bearerFor,
  connector,
  kernel,
  owned,
  signIn,
} from './probe.ts'

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
    await owned(k, owner.person, elsewhere, 'Elsewhere')
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
    // The same grant loads a dataset from outside the page: NDJSON to the
    // app's apply door, written as the person it names.
    let load = await k.at(`${space}.${k.host}`, '/private/api/apply', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${narrow}`,
        'content-type': 'application/x-ndjson',
      },
      body: ['Row one', 'Row two'].map((title, i) =>
        JSON.stringify({ entity: { eid: `$r${i}` }, doc: { title } })
      ).join('\n'),
    })
    assertEquals(load.status, 200)
    let rows = (await load.text()).trim().split('\n').map((l) => JSON.parse(l))
    assertEquals(rows.map((r) => r.doc.title), ['Row one', 'Row two'])
  } finally {
    await k.stop()
  }
})

test('a login bearer mints no session or connector at the sign-in doors', async () => {
  let k = await kernel()
  try {
    let owner = await signIn(k)
    let agent = connector(k, owner.cookie)
    let space = owner.email.split('@')[0]
    let grant = await agent.tool('grant', { space, hours: 1 })
    let headers = {
      authorization: `Bearer ${/yak login (\S+)/.exec(grant)![1]}`,
    }
    let reg = await k.at(k.host, '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'A probing connector',
        redirect_uris: ['https://probe.invalid/cb'],
        token_endpoint_auth_method: 'none',
        response_types: ['code'],
      }),
    })
    let q = new URLSearchParams({
      response_type: 'code',
      client_id: (await reg.json()).client_id,
      redirect_uri: 'https://probe.invalid/cb',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
    })
    // Both answer the sign-in card, as they would a stranger.
    for (let path of ['/login', `/oauth/authorize?${q}`]) {
      let r = await k.at(k.host, path, { redirect: 'manual', headers })
      assertEquals([r.status, r.headers.get('set-cookie')], [200, null])
      assertMatch(await r.text(), /type="email"|name="email"/)
    }
  } finally {
    await k.stop()
  }
})
