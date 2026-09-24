import { assert, assertEquals, assertRejects } from '@std/assert'
import type { AuthorizationStore } from '@yaks/oauth'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  ramVault,
  records,
  sealed,
  sealing,
  secrets,
  secretsDoc,
} from '@yaks/secrets'
import { effects } from '@yaks/effects'
import { authorization, type Record, STORE_KEY } from './oauth.ts'
const memory = (): AuthorizationStore<Record> => {
  const records = new Map<string, Record>()
  return {
    read: (k) => Promise.resolve(records.get(k)),
    update: async (k, fn) => {
      const r = { ...records.get(k) }
      const out = await fn(r)
      records.set(k, r)
      return out
    },
  }
}
Deno.test('OpenRouter browser/paste PKCE returns API key only through private store', async () => {
  const store = memory()
  let requests = 0
  const flow = authorization({
    store,
    fetch: async (url, init) => {
      requests++
      assertEquals(url, 'https://openrouter.ai/api/v1/auth/keys')
      const body = JSON.parse(String(init?.body))
      assertEquals(body.code, 'secret-code')
      assertEquals(body.code_challenge_method, 'S256')
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(body.code_verifier),
      )
      const encoded = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
      assertEquals(
        new URL(start.url).searchParams.get('code_challenge'),
        encoded,
      )
      assertEquals(init?.redirect, 'error')
      return Response.json({ key: 'private-key' })
    },
  })
  const start = await flow.begin()
  assertEquals(new URL(start.url).origin, 'https://openrouter.ai')
  assertEquals(
    new URL(start.url).searchParams.get('callback_url'),
    start.redirectUrl,
  )
  await assertRejects(() =>
    flow.complete(
      'http://localhost:8765/oauth/openrouter/wrong?code=secret-code',
    )
  )
  assertEquals(requests, 0)
  await flow.complete(start.redirectUrl + '?code=secret-code')
  assertEquals(await flow.token(), 'private-key')
  assertEquals(await store.read(STORE_KEY), { api_key: 'private-key' })
  await assertRejects(() =>
    flow.complete(start.redirectUrl + '?code=secret-code')
  )
  assertEquals(requests, 1)
})
Deno.test('cancel/expiry prevents late save and failed exchange is never replayed', async () => {
  const store = memory()
  const held = Promise.withResolvers<Response>()
  let calls = 0
  let now = 0
  const flow = authorization({
    store,
    now: () => now,
    fetch: () => {
      calls++
      return held.promise
    },
  })
  const start = await flow.begin()
  const pending = flow.complete(start.redirectUrl + '?code=c')
  flow.cancel()
  held.resolve(Response.json({ key: 'discard' }))
  await assertRejects(() => pending)
  assertEquals(await flow.token(), undefined)
  const next = await flow.begin()
  now = 600001
  await assertRejects(() => flow.complete(next.redirectUrl + '?code=c'))
  assertEquals(calls, 1)
})
Deno.test('a key kept as a secret is read back by a fresh authorization', async () => {
  const vocab = loadVocab([secretsDoc])
  const vault = ramVault()
  const fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  const g = graph({ storage: ram(vocab), vocab, plugins: [secrets(vault), fx] })
  fx.on('secret', sealing(vault))
  await g.apply([
    sealed(`openrouter ${STORE_KEY}`, '{"api_key":"provisioned"}'),
  ])
  const store = records<Record>(g, vault, 'openrouter ')
  assertEquals(await authorization({ store }).token(), 'provisioned')
  assert(!JSON.stringify(await g.read('.secret')).includes('provisioned'))
})
