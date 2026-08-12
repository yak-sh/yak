// The bounded `claude -p` transport, proved against the scrubbed print-mode
// fixture (adapters_claude_fixture.ts / T-16812) with no subprocess: a full
// turn parses to the {specs, usage, model, finalText} contract, a
// tool_use+tool_result pair lands as an inert atomic pair the ready-call SQL
// can never re-run, and an auth-failure line collapses to a known string with
// no credential leaking out.
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import {
  claudeResumeMissing,
  claudeStream,
  scrubbedSessionId,
} from './adapters_claude_fixture.ts'
import {
  type ClaudeChild,
  claudePrint,
  claudeWork,
  scrub,
} from './claude_print.ts'
import { type ObservationDelta } from './observations.ts'
import { append, readEntries, readyEntries } from './entries.ts'
import { apply } from './db.ts'
import { uuid } from './types.ts'
import { freshDb } from './testdb.ts'

Deno.env.set('DB_PATH', ':memory:')

// A stubbed child that streams the given events as line-delimited JSON, then
// exits. No `claude` binary, no worktree, no credential.
let streamChild = (
  events: unknown[],
  opts: { stderr?: string; code?: number } = {},
): ClaudeChild => {
  let body = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  let bytes = (text: string) =>
    ReadableStream.from(text ? [new TextEncoder().encode(text)] : [])
  let code = opts.code ?? 0
  return {
    stdout: bytes(body),
    stderr: bytes(opts.stderr ?? ''),
    status: Promise.resolve({ code, success: code == 0 }),
    kill: () => {},
  }
}

let printFixture = (
  events: unknown[],
  opts?: { stderr?: string; code?: number },
) =>
  claudePrint({
    argv: ['claude', '-p'],
    env: {},
    spawn: () => streamChild(events, opts),
  })

Deno.test('a full turn parses to the generation contract', async () => {
  let deltas: ObservationDelta[] = []
  let turn = await claudePrint({
    argv: ['claude', '-p'],
    env: {},
    spawn: () => streamChild(claudeStream),
    emit: (delta) => deltas.push(delta),
  })
  assertEquals(turn.model, 'claude-haiku-4-5-20251001')
  assertEquals(turn.finalText, 'It printed hello-from-probe.')
  assertEquals(turn.providerSessionId, scrubbedSessionId)
  assertEquals(turn.usage, {
    input: 8,
    cached: 24000,
    output: 124,
    reasoning: 40,
  })
  // Live deltas: reasoning, a tool start, then model text — the terminal
  // result never re-emits the answer as a model delta.
  assertEquals(deltas.map((d) => d.kind), ['reasoning', 'tool', 'model'])
  let tool = deltas.find((d) => d.kind == 'tool')
  assertEquals((tool as { name: string }).name, 'Bash')
})

Deno.test('a tool_use and tool_result become a typed, unrunnable pair', async () => {
  let turn = await printFixture(claudeStream)
  let db = freshDb()
  let sid = uuid()
  apply(db, [{
    eid: sid,
    name: 'session',
    comp: { id: uuid(), provider: 'claude', model: 'haiku' },
  }])
  let [input] = append(db, sid, [{
    message: { role: 'user' },
    content: { body: 'run it' },
  }]).eids
  let [gen] = append(db, sid, [{
    generation: { through: input, provider: 'claude', model: 'haiku' },
  }]).eids
  let work = claudeWork(turn, gen)

  // The tool_use is a typed call carrying the Bash command; its tool_result is
  // the very next spec, a `result` naming that call — the pair the shared mapper
  // correlates across the two stream lines by Claude's tool id.
  let useAt = work.specs.findIndex((s) => s.call)
  assert(useAt >= 0)
  assertEquals(work.specs[useAt].bash?.command, 'echo hello-from-probe')
  let result = work.specs[useAt + 1]
  assertEquals(result.exit?.code, 0)
  assertEquals(result.content?.body, 'hello-from-probe')
  // A tool_use/tool_result is NOT a generation-output request; only the agent's
  // own message/reasoning name the generation via `output`.
  assertEquals(work.specs[useAt].output, undefined)
  assertEquals(result.output, undefined)
  // Claude ran its own tools: the runner hands the scheduler nothing to execute.
  assertEquals(work.calls.length, 0)

  // Appended WITH the pre-minted ids, so result → call resolves to the appended
  // call entry (without them append re-mints and the call looks answerless).
  append(db, sid, work.specs, null, work.ids)
  let rows = readEntries(db, sid)
  let call = rows.find((row) => row.comps.call)
  assert(call)
  assertEquals(call.comps.call.key, 'toolu-scrubbed')
  assert(rows.some((row) => row.comps.result?.call == call.eid))
  // The invariant: nothing in the settled turn is runnable — the ready-call SQL
  // never re-runs the Bash Claude already executed, and the generation is
  // consumed by its own outputs.
  assertEquals(readyEntries(db, sid).length, 0)
  db.close()
})

Deno.test('a text answer maps to an agent message, thinking to reasoning', async () => {
  let turn = await printFixture(claudeStream)
  let work = claudeWork(turn, 'gen-1')
  let message = work.specs.find((s) => s.message?.role == 'agent')
  assertEquals(message?.content?.body, 'It printed hello-from-probe.')
  // Agent output names the generation that produced it.
  assertEquals(message?.output?.source, 'gen-1')
  let reasoning = work.specs.find((s) => s.reasoning)
  assert(reasoning)
  // Thinking is now a typed reasoning entry with visible content, not opaque.
  assertEquals(reasoning?.content?.body, '<scrubbed reasoning>')
  assertEquals(reasoning?.output?.source, 'gen-1')
  assert(!reasoning?.opaque)
  // The init line survives as named opaque evidence for provenance/replay.
  assert(work.specs.some((s) => s.opaque?.format == 'anthropic:init'))
  // Housekeeping (hooks, thinking-token estimates, rate limits) and the terminal
  // `result` line never become durable entries — exactly five specs remain:
  // init, reasoning, tool_use, tool_result, message.
  assertEquals(work.specs.length, 5)
  // One pre-minted id per spec, so an intra-batch reference survives append.
  assertEquals(work.ids?.length, work.specs.length)
  assert(!work.specs.some((s) => s.opaque?.format == 'anthropic:result'))
  assert(!work.specs.some((s) => s.opaque?.format == 'anthropic:hook_started'))
})

Deno.test('usage stays settlement, an unknown line stays opaque evidence', async () => {
  let turn = await printFixture([
    { type: 'system', subtype: 'init', model: 'haiku', uuid: 'i' },
    { type: 'wibble', note: 'an event the mapper does not model', uuid: 'w' },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      usage: { input_tokens: 3, output_tokens: 5 },
      uuid: 'r',
    },
  ])
  // usage rides the settlement (settleGeneration reads turn.usage), never a row.
  assertEquals(turn.usage, { input: 3, cached: 0, output: 5, reasoning: 0 })
  let work = claudeWork(turn, 'gen-1')
  // init and the unknown line survive as named opaque evidence; the terminal
  // result is settlement, not a transcript row.
  assertEquals(
    work.specs.map((s) => s.opaque?.format).sort(),
    ['anthropic:init', 'anthropic:wibble'],
  )
  assert(work.specs.every((s) => s.output?.source == 'gen-1'))
})

Deno.test('an auth failure scrubs to a known string, never the credential', async () => {
  let leak = 'Invalid API key: sk-ant-abc123DEF456ghi789zzz'
  let error = await assertRejects(() =>
    printFixture([{
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      session_id: scrubbedSessionId,
      errors: [{ message: leak }],
      usage: {},
      uuid: 'e',
    }], { code: 1 })
  )
  assertMatch(String((error as Error).message), /authentication failed/)
  assertEquals(String((error as Error).message).includes('sk-ant-abc'), false)
})

Deno.test('a missing-thread resume is a durable sanitized error', async () => {
  let error = await assertRejects(() =>
    printFixture([claudeResumeMissing], { code: 1 })
  )
  assertMatch(String((error as Error).message), /thread not found/)
})

Deno.test('a non-auth error still scrubs any credential shape', async () => {
  let error = await assertRejects(() =>
    printFixture([{
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: [{ message: 'boom leaked sk-ant-TOPSECRET000111' }],
      uuid: 'e',
    }], { code: 1 })
  )
  let message = String((error as Error).message)
  assertMatch(message, /sk-ant-\[redacted\]/)
  assertEquals(message.includes('TOPSECRET'), false)
})

Deno.test('a stream with no terminal result fails, not hangs', async () => {
  let error = await assertRejects(() =>
    printFixture([{
      type: 'system',
      subtype: 'init',
      model: 'haiku',
      uuid: 'i',
    }], {
      code: 1,
    })
  )
  assertMatch(String((error as Error).message), /without a result/)
})

Deno.test('a malformed stream is a durable error', async () => {
  // A line that is not JSON poisons the turn (D-16810 malformed-stream rule).
  let child = (): ClaudeChild => ({
    stdout: ReadableStream.from([new TextEncoder().encode('not json\n')]),
    stderr: ReadableStream.from([]),
    status: Promise.resolve({ code: 0, success: true }),
    kill: () => {},
  })
  let error = await assertRejects(() =>
    claudePrint({ argv: ['claude'], env: {}, spawn: child })
  )
  assertMatch(String((error as Error).message), /malformed stream/)
})

Deno.test('scrub redacts credential markers but keeps opaque replay tokens', () => {
  assertEquals(scrub('use sk-ant-abc123def456'), 'use sk-ant-[redacted]')
  assertMatch(
    scrub('Authorization: Bearer abcdef123456.ghij'),
    /Bearer \[redacted\]/,
  )
  assertMatch(scrub('api_key=abcdef12345678'), /api_key=\[redacted\]/)
  // A thinking signature is a long base64-ish replay token with no credential
  // marker — it must survive so T-16815 can keep it as opaque evidence.
  let signature = 'EqQBCkYIBRgCKkD' + 'a'.repeat(60) + '+/Zx=='
  assertEquals(scrub(signature), signature)
})
