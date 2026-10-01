// The harness signs in to OpenAI as a graph connection and reads its bearer
// through the vault; an API key still selects the public API explicitly.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { identityEid, Refused } from '@yaks/graph'
import { compose } from '@yaks/cli/host'
import { CODEX, OPENAI } from '@yaks/openai'
import { authorize } from './authorize.ts'
import { openaiCredential } from './openai_auth.ts'
import { signins } from './signin.ts'
import { hosted } from './store.ts'
import { at, harness } from './testing.ts'

let token = (account: string) =>
  'header.' + btoa(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: account },
  })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') + '.sig'

test('OpenAI authorization starts before a session or model exists', async () => {
  let host = await compose(at(), ['graph'])
  let h = hosted(host, () => host.close())
  let auth = authorize(h)
  try {
    let listed = await auth.run('list')
    assert(listed.servers?.includes('OpenAI'))
    let begun = await auth.run('begin', 'openai')
    let url = new URL(begun.url!)
    assertEquals(url.origin, 'https://auth.openai.com')
    assertEquals(url.pathname, '/oauth/authorize')
    assertEquals(
      url.searchParams.get('client_id'),
      'app_EMoamEEZ73f0CkXaXp7hrann',
    )
    assertEquals(url.searchParams.get('code_challenge_method'), 'S256')
    assertEquals(
      url.searchParams.get('redirect_uri'),
      'http://127.0.0.1:1455/auth/callback',
    )
    assertEquals(
      url.searchParams.get('scope')?.split(' ').includes('offline_access'),
      true,
    )
    assertEquals(url.searchParams.get('state')?.length != 0, true)
    let owner = identityEid('provider', ['openai'])
    assertEquals((await h.g.read(`.entity.eid=${owner}&.provider`)).length, 1)
    assertEquals((await h.g.address(['openai'])).get('openai'), owner)
    assertEquals(
      (await h.g.read(`.entity.eid=${owner}&.doc.title=OpenAI`)).length,
      1,
    )
    await assertRejects(
      () => auth.run('complete', 'openai', 'invalid'),
      Error,
      'the return URL is invalid',
    )
    await assertRejects(
      () => auth.run('complete', 'openai', 'invalid'),
      Error,
      'the return URL is invalid',
    )
  } finally {
    await auth.close()
    await h.close()
  }
})

test('OpenAI credential uses its grant, refreshes it, or selects an explicit API key', async () => {
  let h = await harness()
  try {
    let signin = signins(h)
    let first = token('acct-a'), next = token('acct-b')
    let seen: string[] = []
    signin.key = () => Promise.resolve(first)
    signin.refresh = (_owner, _integration, stale) => {
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
