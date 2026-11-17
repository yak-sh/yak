import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { allowed, authorizing, fresh, signIn } from './probe.ts'
import type { Kv } from './grants.ts'

let kv: Kv
let k = await fresh({}, (env) => {
  kv = env.OAUTH_KV as Kv
})
let person = await signIn(k)
let client = await authorizing(k, { name: '' })
let authorization = await allowed(k, client.q, person.cookie)
let code = new URL(authorization.headers.get('location')!).searchParams.get(
  'code',
)!
await authorization.body?.cancel()
let exchange = await k.at('yaks.app', '/oauth/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: client.client_id,
    redirect_uri: client.back,
    code_verifier: client.verifier,
  }),
})
let { access_token } = await exchange.json()
await kv!.delete(`client:${client.client_id}`)
let me = () =>
  k.at('yaks.app', '/oauth/me', {
    headers: { authorization: `Bearer ${access_token}` },
  })

test('a nameless connector whose registration disappeared stays visible and can be disconnected', async () => {
  let before = await me()
  await before.body?.cancel()
  assertEquals(before.status, 200)
  let page = await k.at('yaks.app', '/manage/account/agents', {
    headers: { cookie: person.cookie },
  })
  assertEquals(page.status, 200)
  let html = await page.text()
  assertStringIncludes(html, 'Other agent')
  assertStringIncludes(html, client.client_id)
  let ended = await k.at('yaks.app', '/oauth/agents/disconnect', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      cookie: person.cookie,
      origin: 'https://yaks.app',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ agent: client.client_id }),
  })
  await ended.body?.cancel()
  assertEquals(ended.status, 303)
  let after = await me()
  await after.body?.cancel()
  assertEquals(after.status, 401)
})

addEventListener('unload', () => void k.stop())
