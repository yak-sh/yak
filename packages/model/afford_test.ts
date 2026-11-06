import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  affordable,
  charged,
  FRAMING,
  promptBound,
  requestBound,
} from './afford.ts'
import { weigh } from './vocab.ts'

test('the final answered call fits the pilot headroom, including its output limit', () => {
  let remaining = 0.20 - 0.11129812
  let price = { input: 0.6, output: 3 }
  let quote = affordable(price, 100_000, remaining, 20_000)!
  assertEquals(quote.tokens, 9567)
  assert(quote.dollars <= remaining)
  assert(
    weigh(price, { input_tokens: 100_000, output_tokens: quote.tokens }) <=
      remaining,
  )
  assert(
    weigh(price, { input_tokens: 100_000, output_tokens: quote.tokens + 1 }) >
      remaining,
  )
})

test('input reserves the most expensive fresh, cached or cache-write tariff', () => {
  let price = {
    input: 1,
    output: 2,
    cached: 3,
    cache_write: 4,
    cache_write_1h: 8,
  }
  let quote = affordable(price, 1000, 0.01, 5000)!
  assertEquals(quote, { tokens: 1000, dollars: 0.01 })
  for (
    let usage of [
      { input_tokens: 1000 },
      { input_tokens: 1000, cached_tokens: 1000 },
      { input_tokens: 1000, cache_write_tokens: 1000 },
      {
        input_tokens: 1000,
        cache_write_tokens: 1000,
        cache_write_1h_tokens: 1000,
      },
    ]
  ) {
    assert(
      weigh(price, { ...usage, output_tokens: quote.tokens }) <= quote.dollars,
    )
  }
})

test('input-only and free calls need no paid output allowance', () => {
  assertEquals(affordable({ input: 1, output: 0 }, 1000, 0.001, 0), {
    tokens: 0,
    dollars: 0.001,
  })
  assertEquals(affordable({ input: 0, output: 0 }, 1000, 0), {
    tokens: 4096,
    dollars: 0,
  })
  assertEquals(affordable({ input: 1, output: 2 }, 1000, 0.001), null)
  assertEquals(affordable({ input: 1, output: 2 }, 1000, 0.2, 0), null)
  assertEquals(affordable({ input: 1, output: 2 }, 1001, 0.001, 0), null)
})

test('unknown, invalid and fractional token bounds never authorize spending', () => {
  for (let bad of [-1, NaN, Infinity]) {
    assertEquals(affordable({ input: bad, output: 1 }, 1, 1), null)
    assertEquals(affordable({ input: 1, output: bad }, 1, 1), null)
    assertEquals(affordable({ input: 1, output: 1 }, bad, 1), null)
    assertEquals(affordable({ input: 1, output: 1 }, 1, bad), null)
    assertEquals(affordable({ input: 1, output: 1 }, 1, 1, bad), null)
  }
  assertEquals(affordable({ input: 1, output: 1 }, 1.5, 1), null)
  assertEquals(affordable({ input: 1, output: 1 }, 1, 1, 1.5), null)
})

test('rounding never admits the first unaffordable token', () => {
  for (let input of [0, 1, 1000, 128_000]) {
    for (let rate of [0.0118, 0.6, 3, 25]) {
      for (let remaining of [0.000000001, 0.000123456789, 0.08870188, 0.2]) {
        let price = { input: rate / 2, output: rate }
        let quote = affordable(price, input, remaining, 1_000_000)
        if (!quote) continue
        assert(quote.dollars <= remaining)
        assert(
          weigh(price, { input_tokens: input, output_tokens: quote.tokens }) <=
            quote.dollars,
        )
      }
    }
  }
})

test('settlement keeps unknown usage held and prices unclassified cache input conservatively', () => {
  let price = { input: 1, output: 2, cache_write: 10 }
  assertEquals(charged({ usage: { input_tokens: 100 } }, price, 0.2), {
    dollars: 0.2,
    reported: false,
  })
  assertEquals(
    charged({ usage: { input_tokens: 100, output_tokens: 1 } }, price, 0.2),
    { dollars: 0.001002, reported: false },
  )
  assertEquals(charged({ cost: 0.01 }, price, 0.2), {
    dollars: 0.01,
    reported: true,
  })
})

test('invalid provider token counts never refund a reservation', () => {
  for (let output_tokens of [-1, NaN, Infinity, 0.5]) {
    assertEquals(
      charged({ usage: { input_tokens: 100, output_tokens } }, {
        input: 1,
        output: 2,
      }, 0.2),
      { dollars: 0.2, reported: false },
    )
  }
})

test('a text prompt bounds its input by its own size, never past the context window', () => {
  let prompt = { items: [{ kind: 'user', text: 'é'.repeat(100) }] }
  let bytes = new TextEncoder().encode(JSON.stringify(prompt)).length
  assertEquals(promptBound(prompt, 1_048_576), 2 * bytes + FRAMING)
  assertEquals(promptBound(prompt, 500), 500)
  // GLM-5.3's window would reserve $1.4680064; this prompt reserves cents.
  let quote = affordable(
    { input: 1.4, output: 4.4 },
    promptBound(prompt, 1_048_576),
    0.20,
    4096,
  )!
  assertEquals(quote.tokens, 4096)
  assert(quote.dollars < 0.03)
})

test('media, or history the provider holds, is bounded by the context window', () => {
  for (
    let items of [
      [{
        kind: 'image',
        bytes: new Uint8Array(4),
        mediaType: 'image/png',
        label: 'a',
      }],
      [{ kind: 'image', bytes: [1, 2], mediaType: 'image/png', label: 'a' }],
    ]
  ) assertEquals(requestBound({ items, tools: [] }, 9000), 9000)
  assertEquals(
    promptBound({
      messages: [{ content: [{ type: 'image_url', image_url: { url: 'x' } }] }],
    }, 9000),
    9000,
  )
  assertEquals(requestBound({ items: [], tools: [], anchor: 'r1' }, 9000), 9000)
  assertEquals(
    requestBound({ items: [], tools: [] }, 9000),
    2 * '[null,[],[],null,null]'.length + FRAMING,
  )
})

test('a request that may search reserves each search beside its tokens', () => {
  let price = { input: 1, output: 2, web_search: 0.01 }
  let quote = affordable(price, 1000, 0.05, 10_000, 3)!
  assertEquals(quote.tokens, 9500)
  assert(
    weigh(price, {
      input_tokens: 1000,
      output_tokens: quote.tokens,
      web_searches: 3,
    }) <= quote.dollars,
  )
  assertEquals(affordable(price, 1000, 0.02, 10_000, 3), null)
})
