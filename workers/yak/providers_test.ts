// The platform's agents ask a provider the config names by the name it serves
// under, lent the platform's key for it at each call and the transport held
// as it was lent.
import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { anthropicDoc } from '@yaks/anthropic/vocab'
import { READS } from '@yaks/anthropic/reads'
import { frozen, granted, platform, provided, served } from './providers.ts'
import { operatorProviders, providing } from './config.ts'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import type { Env } from './env.ts'

test('a configured provider records replies before a request, and says what it reads', () => {
  let model = provided({} as Env, 'anthropic')
  assertEquals(model.vocab, anthropicDoc)
  assertEquals(model.reads, READS)
  assertEquals(model.mark?.({ id: 'reply', model: 'claude', items: [] }), {
    anthropic: { response_id: 'reply', cache_expires_at: null },
  })
})

test('a provider no plugin serves refuses every call', async () => {
  await assertRejects(
    () => provided({} as Env, 'nobody')({ model: 'm', items: [], tools: [] }),
    Error,
    'serves no nobody models',
  )
})

test('a configured provider keeps its transport and uses the current key after a missing one', async () => {
  let sent: [string, string | null][] = []
  let listed = {
    id: 'claude-test',
    display_name: 'Claude test',
    max_input_tokens: 1000,
  }
  let env = {
    MODEL_FETCH: ((input, options) => {
      let req = new Request(input, options)
      sent.push([req.url, req.headers.get('authorization')])
      return Promise.resolve(Response.json(
        new URL(req.url).pathname == '/v1/models'
          ? { data: [listed], has_more: false }
          : listed,
      ))
    }) as typeof fetch,
  } as Env
  let model = provided(env, 'anthropic')
  env.MODEL_FETCH = () => Promise.reject(new Error('transport was replaced'))
  await assertRejects(() => model.info!('claude-test'), Error, 'not connected')
  env.ANTHROPIC_API_KEY = 'first'
  assertEquals((await model.info!('claude-test'))?.context, 1000)
  env.ANTHROPIC_API_KEY = 'second'
  assertEquals((await model.list!()).map((m) => m.name), ['claude-test'])
  assertEquals(sent, [
    ['https://api.anthropic.com/v1/models/claude-test', 'Bearer first'],
    ['https://api.anthropic.com/v1/models', 'Bearer second'],
  ])
})

for (let key of [undefined, 'operator-key']) {
  test(`Operator OpenAI calls use ${key ? 'their scoped' : 'the existing'} credential while pictures keep their key`, async () => {
    let sent: [string, string | null][] = []
    let env = {
      OPENAI_API_KEY: 'image-key',
      OPENAI_OPERATOR_API_KEY: key,
      MODEL_FETCH: (input, init) => {
        let req = new Request(input, init)
        sent.push([req.url, req.headers.get('authorization')])
        return Promise.resolve(
          req.url.endsWith('/images/generations')
            ? Response.json({
              data: [{
                b64_json:
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII=',
              }],
              output_format: 'png',
              usage: { input_tokens: 0, output_tokens: 1 },
            })
            : new Response(
              `data: ${
                JSON.stringify({
                  type: 'response.completed',
                  response: {
                    id: 'text',
                    model: 'gpt-5-mini',
                    status: 'completed',
                    output: [],
                  },
                })
              }\n\n`,
              { headers: { 'content-type': 'text/event-stream' } },
            ),
        )
      },
    } as Env
    let conversation = served(env, () =>
      platform(env), operatorProviders(!!key)).openai
    let pictures = served(env, () => ({
      ...platform(env),
      store: () =>
        Promise.resolve({
          address: 'picture',
          media_type: 'image/png',
          size: 68,
        }),
    }), providing).openai
    await conversation({
      model: 'gpt-5-mini',
      tools: [],
      items: [{ kind: 'user', text: 'Read the file.' }],
    })
    await pictures({
      model: 'gpt-image-2.6-flare',
      tools: [],
      items: [{ kind: 'user', text: 'A yak.' }],
    })
    assertEquals(sent, [
      ['https://api.openai.com/v1/responses', `Bearer ${key ?? 'image-key'}`],
      ['https://api.openai.com/v1/images/generations', 'Bearer image-key'],
    ])
  })
}

// OpenAI as config.ts `serving` names it, paid for by the platform's key.
let paying = () =>
  ({
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(4))),
    OPENAI_API_KEY: 'platform-key',
    CF_ACCOUNT: 'acct',
    AI_GATEWAY: 'gw',
  }) as unknown as Env

test("a hosted call carries the platform's credential as a sentinel, granted only to its provider's hosts", async () => {
  let env = paying()
  let { name, key, with: options } = await frozen(env, 'app', 'openai')
  let sent = JSON.stringify(options)
  assertEquals([name, key, sent.includes('platform-key')], [
    'openai',
    '',
    false,
  ])
  assertEquals(options.gateway, { account: 'acct', id: 'gw' })
  assertEquals(await granted(env, 'openai'), [{
    sentinel: options.key as string,
    value: 'platform-key',
    hosts: ['gateway.ai.cloudflare.com'],
  }])
  assertEquals(await granted(env, 'openrouter'), [])
})

test("a provider the platform doesn't pay for is refused where the app has no connection", async () => {
  await assertRejects(
    () => frozen({} as Env, 'app', 'openrouter'),
    Error,
    'This app has no integration store',
  )
  await assertRejects(
    () => frozen({} as Env, 'app', 'nobody'),
    Error,
    'serves no nobody',
  )
})
