// Bootstrap auth is a narrow server-only source: fixed failures, fresh reads,
// and one serialized Codex-owned refresh.
import { assertEquals, assertRejects } from '@std/assert'
import { codexCredentials } from './codex_auth.ts'

Deno.test('Codex credentials reread after one serialized refresh', async () => {
  let token = 'old-secret', calls = 0
  let release = Promise.withResolvers<void>()
  let source = codexCredentials({
    path: '/not-read',
    read: () =>
      Promise.resolve(JSON.stringify({
        tokens: { access_token: token, account_id: 'account-secret' },
      })),
    refresh: async () => {
      calls++
      await release.promise
      token = 'new-secret'
    },
  })
  let a = source.refresh!(), b = source.refresh!()
  release.resolve()
  assertEquals(await a, { token: 'new-secret', account: 'account-secret' })
  assertEquals(await b, { token: 'new-secret', account: 'account-secret' })
  assertEquals(calls, 1)
})

Deno.test('Codex auth failures reveal no cache payload', async () => {
  let source = codexCredentials({
    path: '/not-read',
    read: () => Promise.resolve('{"tokens":{"refresh_token":"secret"}}'),
  })
  await assertRejects(
    source.get,
    Error,
    'codex credential unavailable',
  )
})
