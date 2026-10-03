// The harness signs in to OpenAI as a graph connection and reads its bearer
// through the vault; an API key still selects the public API explicitly.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { mint, Refused } from '@yaks/graph'
import { CODEX, OPENAI } from '@yaks/openai'
import { openaiCredential } from './openai_auth.ts'
import { signins } from '@yaks/connections'
import { harness } from './testing.ts'

let token = (account: string) =>
  'header.' + btoa(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: account },
  })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') + '.sig'

test('OpenAI credential uses its grant, refreshes it, or selects an explicit API key', async () => {
  let h = await harness()
  h.person = mint()
  try {
    let signin = signins(h)
    let first = token('acct-a'), next = token('acct-b')
    let seen: string[] = []
    signin.key = (owner, integration) => {
      assertEquals(owner, h.person)
      assertEquals(integration, 'openai')
      return Promise.resolve(first)
    }
    signin.refresh = (owner, integration, stale) => {
      assertEquals(owner, h.person)
      assertEquals(integration, 'openai')
      seen.push(stale)
      return Promise.resolve(next)
    }
    let oauth = openaiCredential(h, () => undefined, signin)
    assertEquals(await oauth.credential(), {
      token: first,
      account: 'acct-a',
      base: CODEX,
    })
    assertEquals(await oauth.refresh({ token: first, base: CODEX }), {
      token: next,
      account: 'acct-b',
      base: CODEX,
    })
    assertEquals(seen, [first])
    let key = openaiCredential(
      h,
      (name) => name == 'OPENAI_API_KEY' ? 'key' : undefined,
      signin,
    )
    assertEquals(await key.credential(), { token: 'key', base: OPENAI })
  } finally {
    await h.close()
  }
})

test('missing OpenAI sign-ins are refusals', async () => {
  let h = await harness()
  h.person = mint()
  try {
    let signin = signins(h)
    signin.key = () => Promise.resolve(undefined)
    signin.refresh = () => Promise.resolve(undefined)
    let auth = openaiCredential(h, () => undefined, signin)
    await assertRejects(
      auth.credential,
      Refused,
      'Authorize OpenAI or set OPENAI_API_KEY',
    )
    await assertRejects(
      () => auth.refresh({ token: 'stale', base: CODEX }),
      Refused,
      'Authorize OpenAI again',
    )
  } finally {
    await h.close()
  }
})
