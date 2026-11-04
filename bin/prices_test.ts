import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { prices } from './prices.ts'

test('a listing becomes prices under the names transcripts use', () => {
  let price = { input: 2, output: 10, cached: 0.2 }
  assertEquals(
    prices([
      { name: 'openai/gpt-5.1-codex', price },
      { name: 'anthropic/claude-opus-4.6', price },
      { name: 'anthropic/claude-opus-4.6:batch', price },
      { name: 'google/gemini-3-pro', price },
      { name: 'openai/gpt-audio' },
    ]),
    {
      'claude-opus-4-6': { ...price, cache_write_1h: 4 },
      'gpt-5.1-codex': price,
    },
  )
})
