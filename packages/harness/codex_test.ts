// The harness borrows Codex's rotating credential, including after another
// Codex process has replaced a bearer or an endpoint has rejected it.

import { assertEquals } from '@std/assert'
import { codex } from './codex.ts'

Deno.test('a rejected Codex bearer is reloaded or rotated once', async () => {
  let token = 'first', rotations = 0
  let env = (name: string) => name == 'HOME' ? '/home' : undefined
  let read = (_: string) =>
    Promise.resolve(JSON.stringify({
      tokens: { access_token: token, account_id: 'acct' },
    }))
  let auth = codex(env, read, (home) => {
    assertEquals(home, '/home/.codex')
    rotations++
    token = 'third'
    return Promise.resolve()
  })
  let first = await auth.credential()
  token = 'second'
  assertEquals((await auth.refresh(first)).token, 'second')
  assertEquals(rotations, 0)
  assertEquals((await auth.refresh(await auth.credential())).token, 'third')
  assertEquals(rotations, 1)
})
