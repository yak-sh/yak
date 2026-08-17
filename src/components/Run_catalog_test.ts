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
      ['claude-opus-4-8[1m]', 'Opus 1M', ['claude']],
      ['fable', 'Fable', ['claude']],
      ['sonnet', 'Sonnet', ['claude']],
      ['haiku', 'Haiku', ['claude']],
      ['gpt-5.6-terra', 'GPT-5.6 Terra', ['codex', 'codex-cli']],
      ['gpt-5.6-luna', 'GPT-5.6 Luna', ['codex', 'codex-cli']],
      ['kimi-k2.7-code', 'Kimi K2.7 Code', ['ollama']],
      ['glm-5.2', 'GLM-5.2', ['ollama']],
      ['gpt-oss:120b', 'GPT-OSS 120B', ['ollama']],
      ['kimi-k2.6', 'Kimi K2.6', ['ollama']],
      ['deepseek-v4-pro:preview', 'DeepSeek V4 Pro Preview', ['ollama']],
      ['mistral-large-3:675b', 'Mistral Large 3 675B', ['ollama']],
      ['kimi-k3', 'Kimi K3', ['ollama']],
      ['gpt-oss:20b', 'GPT-OSS 20B', ['ollama']],
      ['nemotron-3-ultra', 'Nemotron 3 Ultra', ['ollama']],
      ['minimax-m2.7', 'MiniMax M2.7', ['ollama']],
      ['gemma4:31b', 'Gemma 4 31B', ['ollama']],
      ['deepseek-v4-flash:0731', 'DeepSeek V4 Flash 0731', ['ollama']],
      ['glm-5.1', 'GLM-5.1', ['ollama']],
      ['deepseek-v4-flash:preview', 'DeepSeek V4 Flash Preview', ['ollama']],
      ['nemotron-3-nano:30b', 'Nemotron 3 Nano 30B', ['ollama']],
      ['minimax-m3', 'MiniMax M3', ['ollama']],
      ['nemotron-3-super', 'Nemotron 3 Super', ['ollama']],
      ['deepseek-v4-pro:0813', 'DeepSeek V4 Pro 0813', ['ollama']],
      ['qwen3.5:397b', 'Qwen 3.5 397B', ['ollama']],
    ],
  )
})
