// The provider a config names signs in as the harness lends it: an API key
// from its settings, else the person's ChatGPT grant, refreshed through the
// connection; and generates images into the store it was lent.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { Refused } from '@yaks/graph/errors'
import type { Lent } from '@yaks/model'
import { CODEX, OPENAI } from './credential.ts'
import { configuredImages, providers, signedIn } from './provider.ts'

let token = (account: string) =>
  'header.' + btoa(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: account },
  })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') + '.sig'

let store: Lent['store'] = () => Promise.reject(new Error('unused'))
let lent = (over: Partial<Lent> = {}): Lent => ({
  fetch: () => Promise.reject(new Error('unused')),
  key: () => Promise.resolve(undefined),
  refresh: () => Promise.resolve(undefined),
  store,
  env: () => undefined,
  ...over,
})

test('OpenAI credential uses its grant, refreshes it, or selects an explicit API key', async () => {
  let first = token('acct-a'), next = token('acct-b')
  let asked: string[] = []
  let oauth = signedIn(lent({
    key: (integration) => {
      asked.push(integration)
      return Promise.resolve(first)
    },
    refresh: (integration, stale) => {
      asked.push(`${integration} ${stale}`)
      return Promise.resolve(next)
    },
  }))
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
  assertEquals(asked, ['openai', `openai ${first}`])
  let key = signedIn(lent({
    env: (name) => name == 'OPENAI_API_KEY' ? 'key' : undefined,
  }))
  assertEquals(await key.credential(), { token: 'key', base: OPENAI })
})

test('missing OpenAI sign-ins are refusals', async () => {
  let auth = signedIn(lent())
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
})

test('image configuration defaults to enabled with explicit disable and override', () => {
  assertEquals(configuredImages(store, undefined, ''), { store })
  assertEquals(configuredImages(store, undefined, '1'), { store })
  assertEquals(configuredImages(store, undefined, '0'), undefined)
  assertEquals(configuredImages(store, false, '1'), undefined)
  assertEquals(configuredImages(store, { maxBytes: 9 }, '0'), {
    maxBytes: 9,
    store,
  })
  let setting = (name: string) => name == 'HARNESS_IMAGES' ? 'yes' : undefined
  assertThrows(() => providers(lent({ env: setting })), Error, 'must be 0')
  providers(lent({ env: setting }), { images: false })
})
