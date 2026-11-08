// The provider a config names signs in as the harness lends it: an API key
// from its settings, else the person's ChatGPT grant, refreshed through the
// connection; and generates images into the store it was lent.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { Refused } from '@yaks/graph/errors'
import { type Lent, listPrice, ModelError } from '@yaks/model'
import { CODEX, OPENAI } from './credential.ts'
import {
  configuredImages,
  hosts,
  type Options,
  providers,
  signedIn,
} from './provider.ts'

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

test('text model metadata comes from the credential catalogue and published model limits', async () => {
  let asked: Request[] = []
  let model = providers(
    lent({
      env: (name) => name == 'OPENAI_API_KEY' ? 'own-key' : undefined,
      fetch: (input, init) => {
        let req = new Request(input, init)
        asked.push(req)
        return Promise.resolve(
          req.url == `${OPENAI}/models`
            ? Response.json({ data: [{ id: 'gpt-5-mini' }] })
            : new Response(`- 400,000 context window
- Maximum input tokens: 272,000
- 128,000 max output tokens`),
        )
      },
    }),
    { images: false },
  ).openai
  assertEquals(await model.list?.(), [{ name: 'gpt-5-mini' }])
  let info = await model.info?.('gpt-5-mini')
  assertEquals(info, {
    name: 'gpt-5-mini',
    context: 400000,
    output: 128000,
    price: listPrice('gpt-5-mini'),
  })
  assertEquals(await model.info?.('gpt-5-mini'), info)
  assertEquals(
    asked.map((req) => [req.url, req.headers.get('authorization')]),
    [
      [`${OPENAI}/models`, 'Bearer own-key'],
      [`${OPENAI}/models`, 'Bearer own-key'],
      ['https://developers.openai.com/api/docs/models/gpt-5-mini.md', null],
    ],
  )
  assertEquals(await model.info?.('unlisted-model'), undefined)
  assertEquals(asked.at(-1)?.url, `${OPENAI}/models`)
})

test('text model discovery preserves credential refusals', async () => {
  let model = providers(
    lent({
      env: (name) => name == 'OPENAI_API_KEY' ? 'key' : undefined,
      fetch: () => Promise.resolve(Response.json({}, { status: 401 })),
    }),
    { images: false },
  ).openai
  await assertRejects(() => model.info!('gpt-5-mini'), ModelError, '401')
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
  assertEquals(await signedIn(lent(), 'own').credential(), {
    token: 'own',
    base: OPENAI,
  })
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

test('a configured endpoint is opened by its own key, the lent key, or by nothing, with its headers', async () => {
  let sent = async (key: string | undefined, options: Options = {}) => {
    let seen: Request[] = []
    let model = providers(
      lent({
        key: () => Promise.resolve(key),
        fetch: (input, init) => {
          seen.push(new Request(input, init))
          return Promise.resolve(Response.json({}, { status: 400 }))
        },
      }),
      {
        base: 'https://gateway.test/openai/',
        headers: { 'cf-aig-authorization': 'Bearer aig' },
        images: false,
        web: false,
        ...options,
      },
    ).openai
    await assertRejects(() =>
      model({
        model: 'gpt-x',
        items: [{ kind: 'user', text: 'hi' }],
        tools: [],
      })
    )
    return seen.map((r) => [
      r.url,
      r.headers.get('authorization'),
      r.headers.get('cf-aig-authorization'),
    ])
  }
  let at = 'https://gateway.test/openai/responses'
  assertEquals(await sent('sentinel'), [[at, 'Bearer sentinel', 'Bearer aig']])
  assertEquals(await sent(undefined), [[at, null, 'Bearer aig']])
  assertEquals(await sent('lent', { key: 'own' }), [[
    at,
    'Bearer own',
    'Bearer aig',
  ]])
  let gateway = { account: 'acct', id: 'gw', token: 'stored' }
  assertEquals(await sent(undefined, { base: undefined, gateway }), [[
    'https://gateway.ai.cloudflare.com/v1/acct/gw/openai/responses',
    null,
    'Bearer stored',
  ]])
})

test('a credential lent the provider goes only to the endpoint it aims at', () => {
  assertEquals(hosts(), ['api.openai.com'])
  assertEquals(hosts({ base: 'https://gateway.test/openai' }), ['gateway.test'])
  assertEquals(hosts({ gateway: { account: 'a', id: 'g' } }), [
    'gateway.ai.cloudflare.com',
  ])
})
