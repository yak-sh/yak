// The compaction policy: a known serving model gets a threshold below its
// window; an unknown one gets none so an unsupported provider stays usable.
import { assertEquals } from '@std/assert'
import { compactionPolicy, contextWindow } from './compaction.ts'

Deno.test('context window matches the longest known model prefix', () => {
  assertEquals(contextWindow('gpt-5.6-sol'), 400_000)
  assertEquals(contextWindow('gpt-5.6-sol-2026-08-01'), 400_000)
  assertEquals(contextWindow('gpt-4o-mini'), 128_000)
  assertEquals(contextWindow('claude-opus-4-8'), undefined)
  assertEquals(contextWindow('fake-fast'), undefined)
})

Deno.test('a known model compacts below its window; an unknown one does not', () => {
  assertEquals(compactionPolicy('gpt-5.6-sol'), [{
    type: 'compaction',
    compact_threshold: 300_000,
  }])
  assertEquals(compactionPolicy('gpt-4o'), [{
    type: 'compaction',
    compact_threshold: 96_000,
  }])
  assertEquals(compactionPolicy('claude-opus-4-8'), undefined)
  assertEquals(compactionPolicy('fake-fast'), undefined)
})
