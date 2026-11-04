import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { ModelError } from '@yaks/model'
import { anthropicDoc } from '@yaks/anthropic/vocab'
import { claude } from './claude.ts'
import type { Env } from './env.ts'

test('the Claude adapter records replies before a provider request', () => {
  let model = claude({} as Env)
  assertEquals(model.vocab, anthropicDoc)
  assertEquals(model.mark?.({ id: 'reply', model: 'claude', items: [] }), {
    anthropic: { response_id: 'reply', cache_expires_at: null },
  })
  assertEquals(
    model.anchor?.({
      anthropic: { response_id: 'reply', cache_expires_at: null },
    }),
    undefined,
  )
})

test('Claude discovery retains its transport and uses the current key after a missing key', async () => {
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
  let model = claude(env)
  env.MODEL_FETCH = () => Promise.reject(new Error('transport was replaced'))
  await assertRejects(
    () => model.info!('claude-test'),
    ModelError,
    'yaks.app has no Anthropic key yet',
  )
  env.ANTHROPIC_API_KEY = 'first'
  assertEquals((await model.info!('claude-test'))?.context, 1000)
  env.ANTHROPIC_API_KEY = 'second'
  assertEquals((await model.list!()).map((m) => m.name), ['claude-test'])
  assertEquals(sent, [
    ['https://api.anthropic.com/v1/models/claude-test', 'Bearer first'],
    ['https://api.anthropic.com/v1/models', 'Bearer second'],
  ])
})
