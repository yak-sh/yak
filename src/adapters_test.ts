// The adapter readers against REAL captured events — each fixture line is
// pasted from a live probe of the CLI it mimics (trimmed, same shape).
// If a vendor changes dialect, these say exactly which reader went deaf.
import { assertEquals } from '@std/assert'
import { adapters, providers } from './adapters.ts'

let { claude, codex } = adapters

Deno.test('claude: init names the session and the serving model', () => {
  let e = {
    type: 'system',
    subtype: 'init',
    cwd: '/tmp/x',
    session_id: 'b620ba4a-4a1d-44a1-aad0-2b31b3d01499',
    model: 'claude-haiku-4-5-20251001',
    permissionMode: 'bypassPermissions',
  }
  assertEquals(claude.init(e), {
    status: 'running',
    provider_session_id: 'b620ba4a-4a1d-44a1-aad0-2b31b3d01499',
    serving_model: 'claude-haiku-4-5-20251001',
  })
  assertEquals(claude.init({ type: 'system', subtype: 'hook_started' }), null)
  assertEquals(claude.terminal(e), null)
})

Deno.test('claude: the result event is the last word', () => {
  let e = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 2065,
    result: 'OK',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 38 },
  }
  assertEquals(claude.terminal(e), {
    final_text: 'OK',
    usage_json: '{"input_tokens":10,"output_tokens":38}',
  })
  // an error result still ends the run — and says so
  let bad = claude.terminal({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: null,
  })
  assertEquals(bad?.error, 'result: error_during_execution')
})

Deno.test('codex: thread.started is the init, sans model', () => {
  assertEquals(
    codex.init({
      type: 'thread.started',
      thread_id: '019f6f3e-f562-7263-9364-5d6d2fe419d6',
    }),
    {
      status: 'running',
      provider_session_id: '019f6f3e-f562-7263-9364-5d6d2fe419d6',
    },
  )
})

Deno.test('codex: each agent_message overwrites final_text; usage closes', () => {
  let msg = codex.init({
    type: 'item.completed',
    item: { id: 'item_0', type: 'agent_message', text: 'OK' },
  })
  assertEquals(msg, { final_text: 'OK' })
  // other item kinds are just log
  assertEquals(
    codex.init({
      type: 'item.completed',
      item: { id: 'item_1', type: 'command_execution', text: 'ls' },
    }),
    null,
  )
  assertEquals(
    codex.terminal({
      type: 'turn.completed',
      usage: { input_tokens: 13966, output_tokens: 5 },
    }),
    { usage_json: '{"input_tokens":13966,"output_tokens":5}' },
  )
  assertEquals(
    codex.terminal({ type: 'turn.failed', error: { message: 'boom' } })
      ?.error,
    'boom',
  )
})

Deno.test('providers: every adapter, allowlists only — no argv', () => {
  let ps = providers()
  assertEquals(ps.map((p) => p.name), Object.keys(adapters))
  assertEquals(
    ps.map((p) => Object.keys(p)),
    ps.map(() => [
      'name',
      'models',
      'efforts',
    ]),
  )
  // the browser offers exactly what a start request is checked against
  assertEquals(
    ps.find((p) => p.name == 'claude')?.models,
    adapters.claude.models,
  )
  assertEquals(ps.find((p) => p.name == 'claude')?.efforts, [])
  assertEquals(
    ps.find((p) => p.name == 'codex')?.efforts,
    adapters.codex.efforts,
  )
})

Deno.test('argv: no secrets, instruction rides last', () => {
  let j = {
    instruction: 'do the thing',
    session_id: 'sid',
    model: 'haiku',
    effort: undefined,
  }
  assertEquals(claude.argv(j).at(-1), 'do the thing')
  assertEquals(claude.argv(j).includes('--session-id'), true)
  let c = codex.argv({ ...j, model: 'gpt-5.6-sol', effort: 'high' })
  assertEquals(c.at(-1), 'do the thing')
  assertEquals(c.includes('model_reasoning_effort=high'), true)
})
