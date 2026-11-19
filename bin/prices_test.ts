import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { labels, prices } from './prices.ts'

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

test('a listing labels its models without their vendor, and Claude without "Claude"', () => {
  assertEquals(
    labels([
      { name: 'openai/gpt-6.2-sol', label: 'OpenAI: GPT-6.2 Sol' },
      {
        name: 'anthropic/claude-sonnet-5.5',
        label: 'Anthropic: Claude Sonnet 5.5',
      },
      { name: 'google/gemini-3-pro', label: 'Google: Gemini 3 Pro' },
      { name: 'openai/gpt-audio' },
    ]),
    { 'claude-sonnet-5-5': 'Sonnet 5.5', 'gpt-6.2-sol': 'GPT-6.2 Sol' },
  )
})
