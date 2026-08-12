// The Claude print-mode contract, asserted against the scrubbed capture
// (T-16812, D-16810). If the CLI's stream-json dialect drifts, one of these
// says exactly which reader went deaf — the same guard adapters_test.ts gives
// the hand-written samples, here over a whole real generation in emission
// order. T-16814/T-16815 build their transport and entry mapping against this.
import { assertEquals } from '@std/assert'
import { adapters } from './adapters.ts'
import {
  claudeResumeMissing,
  claudeStream,
  scrubbedSessionId,
} from './adapters_claude_fixture.ts'

let { claude } = adapters

Deno.test('claude fixture: init names the thread and the serving model', () => {
  // Exactly one init in the stream; the hook lines and everything else yield
  // null, so the reader can scan the whole stream and pick it out.
  let inits = claudeStream.map((e) => claude.init(e)).filter(Boolean)
  assertEquals(inits.length, 1)
  assertEquals(inits[0], {
    status: 'running',
    provider_session_id: scrubbedSessionId,
    serving_model: 'claude-haiku-4-5-20251001',
  })
})

Deno.test('claude fixture: observe reads the serving model off assistant lines', () => {
  let seen = claudeStream.map((e) => claude.observe?.(e)).filter(Boolean)
  // Three assistant lines (thinking, tool_use, text), each states the model.
  assertEquals(seen.length, 3)
  for (let s of seen) {
    assertEquals(s?.serving_model, 'claude-haiku-4-5-20251001')
  }
})

Deno.test('claude fixture: terminal is the last word — final text and usage', () => {
  let terminals = claudeStream.map((e) => claude.terminal(e)).filter(Boolean)
  assertEquals(terminals.length, 1)
  let t = terminals[0]!
  assertEquals(t.final_text, 'It printed hello-from-probe.')
  // usage rides as a JSON string, not exploded onto columns.
  assertEquals(typeof t.usage_json, 'string')
  assertEquals(JSON.parse(t.usage_json as string).output_tokens, 124)
  assertEquals('error' in t, false)
})

Deno.test('claude fixture: the whole stream narrates in order', () => {
  // Each event → its renderer row kind (or a skip). The SHAPE of the turn:
  // hooks and init are dim sys chatter, thinking dims, the Bash call is an
  // exec, its result a ↳ chip, the answer says, the result closes the turn.
  let rows = claudeStream.map((e) => claude.row(e))
  let kinds = rows.map((r) => (r ? ('kind' in r ? r.kind : '?') : null))
  assertEquals(kinds, [
    'sys', // hook_started
    'sys', // hook_response
    'sys', // init
    'sys', // thinking_tokens
    'reason', // assistant thinking
    'exec', // assistant tool_use:Bash
    'sys', // rate_limit_event
    'tool', // user tool_result
    'say', // assistant text
    'turn', // result/success
  ])

  // The load-bearing transforms, spot-checked against their events.
  let reason = rows[4]
  assertEquals(reason, { kind: 'reason', text: '<scrubbed reasoning>' })

  let exec = rows[5]
  assertEquals(exec, {
    kind: 'exec',
    command: 'echo hello-from-probe',
    desc: 'Echo a probe string',
  })

  // The tool_result is its own chip: ok from is_error, name the return glyph.
  let result = rows[7] as { kind: string; name: string; ok: boolean }
  assertEquals(result.kind, 'tool')
  assertEquals(result.name, '↳')
  assertEquals(result.ok, true)

  // The say wears the event clock so the transcript shows when it landed.
  assertEquals(rows[8], {
    kind: 'say',
    role: 'agent',
    text: 'It printed hello-from-probe.',
    at: '2026-08-12T16:00:03.000Z',
  })

  // The terminal result closes the turn with usage and duration.
  let turn = rows[9] as { kind: string; ms: number; usage: string }
  assertEquals(turn.kind, 'turn')
  assertEquals(turn.ms, 4200)
  assertEquals(JSON.parse(turn.usage).output_tokens, 124)
})

Deno.test('claude fixture: a missing-thread resume is a durable terminal error', () => {
  // The runner must stamp a durable error, never claim exact replay, when the
  // provider continuation is gone (D-16810 recovery). The CLI hands it back as
  // a terminal error line — terminal() turns it into an `error` fact.
  let t = claude.terminal(claudeResumeMissing)
  assertEquals(t?.error, 'result: error_during_execution')
  // It also renders as an error row, not a turn.
  assertEquals(claude.row(claudeResumeMissing), {
    kind: 'error',
    text: 'result: error_during_execution',
  })
})
