import { clock, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { kv } from './binding-probe.ts'
import { allowed, authorizing, fresh, signIn } from './probe.ts'

let time = clock()
let store = kv(time.now)
let k = await fresh({}, (env) => {
  env.OAUTH_KV = store
})
let person = await signIn(k)
let client = await authorizing(k)
let authorized = await allowed(k, client.q, person.cookie)
let code = new URL(authorized.headers.get('location')!).searchParams.get(
  'code',
)!
await authorized.body?.cancel()
let token = (fields: Record<string, string>) =>
  k.at('yaks.app', '/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.client_id, ...fields }),
  })
let exchanged = await token({
  grant_type: 'authorization_code',
  code,
  redirect_uri: client.back,
  code_verifier: client.verifier,
})
let { refresh_token } = await exchanged.json()

test('a dynamically registered connector can still refresh after 100 days in KV', async () => {
  await time.advance(100 * 24 * 60 * 60_000)
  let refreshed = await token({ grant_type: 'refresh_token', refresh_token })
  assertEquals(refreshed.status, 200, await refreshed.text())
  assertEquals(await store.get(`client:${client.client_id}`) != null, true)
})

addEventListener('unload', () => void k.stop())
