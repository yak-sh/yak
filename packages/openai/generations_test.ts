// A GPT Image model named to the `openai` provider asks the Image API for one
// image, keeps a receipt, stores the bytes in the lent store and answers its
// cost at OpenAI's published rates, held beforehand within a bound.

import { test } from '@yaks/testing'
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
} from '@std/assert'
import type { Lent, MediaReceipt, Request } from '@yaks/model'
import { imageCost, imageQuote, imageTokens } from './generations.ts'
import { providers } from './provider.ts'

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII='
let usage = {
  input_tokens: 12,
  input_tokens_details: { text_tokens: 12, image_tokens: 0 },
  output_tokens: 823,
}

let harness = (answer: () => Response) => {
  let sent: { url: string; body: Record<string, unknown> }[] = []
  let stored: { bytes: Uint8Array; type: string }[] = []
  let receipts = new Map<string, MediaReceipt>()
  let lent: Lent = {
    fetch: (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(String(init!.body)) })
      return Promise.resolve(answer())
    },
    key: () => Promise.resolve(undefined),
    refresh: () => Promise.resolve(undefined),
    store: (bytes, type) => {
      stored.push({ bytes, type })
      return Promise.resolve({
        address: 'a1',
        media_type: type,
        size: bytes.length,
      })
    },
    env: (name) => name == 'OPENAI_API_KEY' ? 'sk-test' : undefined,
    receipts: {
      read: (call) => Promise.resolve(receipts.get(call)),
      save: (r) => Promise.resolve(void receipts.set(r.call, r)),
    },
  }
  return { model: providers(lent).openai, sent, stored, receipts }
}
let ok = () =>
  new Response(
    JSON.stringify({ data: [{ b64_json: png }], output_format: 'png', usage }),
  )
let ask = (model: string, input?: Record<string, unknown>): Request => ({
  model,
  call: 'c1',
  items: [{ kind: 'user', text: 'A yak in gouache' }],
  tools: [],
  ...input ? { input } : {},
})

test('OpenAI calculator output tokens', () => {
  assertEquals(imageTokens('gpt-image-2.6-flare', 1024, 1024, 'low'), 823)
  assertEquals(imageTokens('gpt-image-2.5-sunburst', 1024, 1024, 'low'), 196)
})

test('a GPT Image model makes one stored image and answers its cost', async () => {
  let h = harness(ok)
  let reply = await h.model(
    ask('gpt-image-2.6-sunburst', { size: '1024x1024', quality: 'low' }),
  )
  assertEquals(h.sent[0].url, 'https://api.openai.com/v1/images/generations')
  assertEquals(h.sent[0].body, {
    model: 'gpt-image-2.6-sunburst',
    prompt: 'A yak in gouache',
    n: 1,
    size: '1024x1024',
    quality: 'low',
    output_format: 'png',
  })
  assertEquals(h.stored[0].type, 'image/png')
  assertEquals(reply.artifacts?.[0].address, 'a1')
  assertAlmostEquals(reply.cost!, (12 * 5 + 823 * 30) / 1e6)
  assertEquals(reply.costReported, false)
  assert(h.receipts.get('c1')?.reply)
  assert(!JSON.stringify(reply).includes(png))
})

test('the hold bounds the cost; an unset size and quality hold the largest', () => {
  let held = imageQuote(
    ask('gpt-image-2.6-flare', { size: '1024x1024', quality: 'low' }),
    1,
  )!
  assert(held.dollars >= imageCost(usage))
  let largest = imageQuote(ask('gpt-image-2.6-flare'), 10)!
  assertAlmostEquals(largest.dollars, (16 * 5 + 2 * 23719 * 30) / 1e6)
  assertEquals(imageQuote(ask('gpt-image-2.6-flare'), 0.1), null)
})

test('a recovered image is delivered from its receipt without asking again', async () => {
  let h = harness(ok)
  await h.model(ask('gpt-image-2.5-flare'))
  h.receipts.set('c1', { ...h.receipts.get('c1')!, reply: undefined })
  let reply = await h.model.recover!('c1')
  assertEquals(h.sent.length, 1)
  assertEquals(reply.artifacts?.length, 1)
})

test('settings an image model does not take, and a refused prompt, are bad requests', async () => {
  let h = harness(() =>
    new Response(JSON.stringify({ error: { code: 'moderation_blocked' } }), {
      status: 400,
    })
  )
  for (
    let input of [{ output_format: 'svg' }, { n: 3 }, { quality: 'ultra' }, {
      size: 'big',
    }]
  ) {
    let e = await assertRejects(() =>
      h.model(ask('gpt-image-2.6-flare', input))
    )
    assertEquals((e as { code: string }).code, 'bad_request')
  }
  assertEquals(h.sent.length, 0)
  let e = await assertRejects(() => h.model(ask('gpt-image-2.6-flare')))
  assertEquals((e as { code: string }).code, 'bad_request')
})

test('text models keep their token pricing and listing', async () => {
  let { model } = harness(ok)
  assertEquals(model.quote!(ask('gpt-5'), 1), undefined)
  assertEquals(await model.info!('gpt-5'), undefined)
  assertEquals((await model.info!('gpt-image-2.6-flare'))?.modalities, [
    'image',
  ])
})
