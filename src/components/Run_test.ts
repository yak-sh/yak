// The Run form's offers are one ordered menu: Sol leads, every other
// provider/model keeps its declared place.
import { assertEquals } from '@std/assert'
import { providers } from '../adapters.ts'
import { offers } from './Run.tsx'

Deno.test('offers: Sol leads; Opus, Fable, Terra, and Luna stay put', () => {
  assertEquals(offers(providers()).map((x) => x.model), [
    'gpt-5.6-sol',
    'claude-opus-4-8',
    'fable',
    'sonnet',
    'haiku',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
  ])
})
