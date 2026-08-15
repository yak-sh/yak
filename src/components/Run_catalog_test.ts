// The Run form's model catalog is pure data: Sol leads, every compatible model
// appears ONCE, and the CLI fallback rides a model's transports instead of
// minting a duplicate entry. This test imports only the catalog logic
// (providers.ts) and the provider table (adapters.ts) — no view — so it stays
// sub-ms. The DOM-mount tests that render <Run/> live in Run_test.ts.
import { assertEquals } from '@std/assert'
import { providers } from '../adapters.ts'
import { catalog } from '../providers.ts'

// Warm the catalog path once at import so the sole test isn't charged for the
// provider table's first traversal — keeps it sub-ms.
catalog(providers())

Deno.test('the catalog offers each model once, Sol first, fallback as a transport', () => {
  assertEquals(
    catalog(providers()).map((c) => [c.model, c.label, c.transports]),
    [
      ['gpt-5.6-sol', 'GPT-5.6 Sol', ['codex', 'codex-cli']],
      ['claude-opus-4-8', 'Opus', ['claude']],
      ['fable', 'Fable', ['claude']],
      ['sonnet', 'Sonnet', ['claude']],
      ['haiku', 'Haiku', ['claude']],
      ['gpt-5.6-terra', 'GPT-5.6 Terra', ['codex', 'codex-cli']],
      ['gpt-5.6-luna', 'GPT-5.6 Luna', ['codex', 'codex-cli']],
      ['kimi-k2.7-code:cloud', 'kimi-k2.7-code', ['ollama']],
      ['glm-5.2:cloud', 'glm-5.2', ['ollama']],
      ['deepseek-v4-flash:cloud', 'deepseek-v4-flash', ['ollama']],
      ['kimi-k3:cloud', 'kimi-k3', ['ollama']],
      ['gemma4:cloud', 'gemma4', ['ollama']],
      ['glm-5.1:cloud', 'glm-5.1', ['ollama']],
      ['minimax-m2.7:cloud', 'minimax-m2.7', ['ollama']],
      ['nemotron-3-super:cloud', 'nemotron-3-super', ['ollama']],
      ['minimax-m3:cloud', 'minimax-m3', ['ollama']],
      ['kimi-k2.6:cloud', 'kimi-k2.6', ['ollama']],
      ['deepseek-v4-pro:cloud', 'deepseek-v4-pro', ['ollama']],
      ['nemotron-3-ultra:cloud', 'nemotron-3-ultra', ['ollama']],
      ['qwen3.5:cloud', 'qwen3.5', ['ollama']],
      ['nemotron-3-nano:30b-cloud', 'nemotron-3-nano', ['ollama']],
      ['mistral-large-3:675b-cloud', 'mistral-large-3', ['ollama']],
      ['gpt-oss:120b-cloud', 'gpt-oss', ['ollama']],
    ],
  )
})
