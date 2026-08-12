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

Deno.test('a tool_use and tool_result become an atomic, unrunnable pair', async () => {
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

  // The pair is adjacent in the single specs batch, correlated by the one tool
  // id carried in each opaque payload (the seam T-16815 pairs on).
  let useAt = work.specs.findIndex((s) =>
    s.opaque?.format == 'anthropic:tool_use'
  )
  let resultAt = work.specs.findIndex((s) =>
    s.opaque?.format == 'anthropic:tool_result'
  )
  assert(useAt >= 0 && resultAt == useAt + 1)
  assertMatch(String(work.specs[useAt].opaque.data), /toolu-scrubbed/)
  assertMatch(String(work.specs[resultAt].opaque.data), /toolu-scrubbed/)
  // Claude ran its own tools: the runner returns nothing for the scheduler to
  // execute, and no `call` facet exists to be re-run.
  assertEquals(work.calls.length, 0)

  append(db, sid, work.specs)
  let rows = readEntries(db, sid)
  assert(rows.every((row) => !row.comps.call))
  // Nothing appended is a runnable call; the ready-call SQL can never re-run
  // the Bash Claude already executed.
  let ready = new Set(readyEntries(db, sid).map((r) => r.eid))
  assert(rows.every((row) => !row.comps.call || !ready.has(row.eid)))
  assert(rows.some((row) => row.comps.opaque?.format == 'anthropic:tool_use'))
  assert(
    rows.some((row) => row.comps.opaque?.format == 'anthropic:tool_result'),
  )
  db.close()
})

Deno.test('a text answer maps to an agent message, thinking to reasoning', async () => {
  let turn = await printFixture(claudeStream)
  let work = claudeWork(turn, 'gen-1')
  let message = work.specs.find((s) => s.message?.role == 'agent')
  assertEquals(message?.content?.body, 'It printed hello-from-probe.')
  let reasoning = work.specs.find((s) => s.reasoning)
  assert(reasoning)
  assertEquals(reasoning?.opaque?.format, 'anthropic:thinking')
  // Housekeeping (hooks, thinking-token estimates, rate limits) and the terminal
  // `result` line never become durable entries — exactly five specs remain:
  // init, thinking, tool_use, tool_result, message.
  assertEquals(work.specs.length, 5)
  assert(!work.specs.some((s) => s.opaque?.format == 'anthropic:result'))
  assert(!work.specs.some((s) => s.opaque?.format == 'anthropic:hook_started'))
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
