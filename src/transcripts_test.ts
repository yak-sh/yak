// External provider transcripts against captured interactive JSONL shapes.
// Managed streams have their own fixtures in adapters_test.ts.
import { assertEquals } from '@std/assert'
import { codexTranscript } from './transcripts.ts'

let event = (type: string, payload: Record<string, unknown>) =>
  codexTranscript({ timestamp: '2026-07-26T12:00:00Z', type, payload })

Deno.test('Codex transcript says each turn once and keeps injected context quiet', () => {
  assertEquals(
    event('event_msg', {
      type: 'user_message',
      message: 'Please inspect this',
    }),
    {
      kind: 'say',
      role: 'user',
      text: 'Please inspect this',
      at: '2026-07-26T12:00:00Z',
    },
  )
  assertEquals(
    event('event_msg', {
      type: 'agent_message',
      message: 'I found it',
      phase: 'final_answer',
    }),
    {
      kind: 'say',
      role: 'agent',
      text: 'I found it',
      at: '2026-07-26T12:00:00Z',
    },
  )
  // The rollout repeats conversation messages as response items. The
  // event_msg pair above is canonical, so injected context and copies stay raw.
  assertEquals(
    event('response_item', {
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: 'injected context' }],
    }),
    null,
  )
  assertEquals(
    event('response_item', {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'I found it' }],
    }),
    null,
  )
})

Deno.test('Codex transcript narrates activity and reports request context', () => {
  assertEquals(
    event('response_item', {
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'Check the source' }],
    }),
    {
      kind: 'reason',
      text: 'Check the source',
    },
  )
  assertEquals(
    event('response_item', {
      type: 'function_call',
      name: 'task_show',
      arguments: '{"id":"T-3"}',
    }),
    {
      kind: 'tool',
      name: 'task_show',
      detail: '{"id":"T-3"}',
    },
  )
  assertEquals(
    event('response_item', {
      type: 'function_call_output',
      output: { content: 'done', success: true },
    }),
    {
      kind: 'tool',
      name: '↳',
      ok: true,
      detail: 'done',
    },
  )
  assertEquals(
    event('event_msg', {
      type: 'task_complete',
      duration_ms: 1250,
    }),
    {
      kind: 'turn',
      ms: 1250,
    },
  )
  assertEquals(
    event('event_msg', {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: 530632 },
        last_token_usage: { input_tokens: 75009 },
        model_context_window: 258400,
      },
    }),
    {
      kind: 'sys',
      tag: 'tokens',
      context: 75009,
    },
  )
  assertEquals(event('event_msg', { type: 'token_count', info: {} }), {
    kind: 'sys',
    tag: 'tokens',
  })
})
