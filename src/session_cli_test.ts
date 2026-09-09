// The session verbs' pure seams: one status word for both session shapes, what
// counts as over, the exit code `wait` ends with, the listing line, native
// lines through the package renderer, and the poll loop with an injected clock.
import { assert, assertEquals, assertMatch, assertRejects } from '@std/assert'
import { arm, type Row } from './client.ts'
import {
  briefOf,
  exitCode,
  legacyStatus,
  native,
  nativeLines,
  nativeStatus,
  over,
  poll,
  sessionLine,
  statusFor,
  waitFor,
} from './session_cli.ts'

let row = (comps: Row['comps'], num = 7): Row => ({
  eid: `e${num}`,
  num,
  kind: 'session',
  comps,
})
let legacy = (session: Record<string, unknown>, more: Row['comps'] = {}) =>
  row({ session: { id: 'sid', ...session }, ...more })
// A native entry: prose alone is an input, prose with a source an output, and
// any other kind is the tag comp beside `entry`.
let entry = (seq: number, kind: string, text = ''): Row =>
  row({
    entry: { session: 'e7', seq },
    ...kind == 'input'
      ? { content: { body: text } }
      : kind == 'output'
      ? { content: { body: text, source: 'e101' } }
      : { [kind]: {} },
  }, 100 + seq)

Deno.test('legacy status: the column, then exit, then a recorded end', () => {
  assertEquals(legacyStatus(legacy({ status: 'running' }).comps), 'running')
  assertEquals(legacyStatus(legacy({ status: 'starting' }).comps), 'running')
  assertEquals(legacyStatus(legacy({ status: 'failed' }).comps), 'failed')
  assertEquals(legacyStatus(legacy({ status: 'lost' }).comps), 'failed')
  assertEquals(legacyStatus(legacy({ status: 'done' }).comps), 'settled')
  assertEquals(
    legacyStatus(legacy({ finished_at: '2026-09-08T00:00:00Z' }).comps),
    'settled',
  )
  // a non-zero exit code is a failure whatever the column says
  assertEquals(
    legacyStatus(legacy({ status: 'done', exit_code: 2 }).comps),
    'failed',
  )
  assertEquals(legacyStatus(legacy({}).comps), 'idle')
})

Deno.test('legacy status from the log: an exit entry, a call in flight', () => {
  let exit = (code: number, n = 3) =>
    row({ entry: { session: 'e7', seq: n }, exit: { code } }, 100 + n)
  let idle = legacy({}).comps
  assertEquals(legacyStatus(idle, [exit(0)]), 'settled')
  assertEquals(legacyStatus(idle, [exit(2)]), 'failed')
  // an exit that is not the newest entry ends nothing
  assertEquals(
    legacyStatus(idle, [
      exit(0, 1),
      row({ entry: { session: 'e7', seq: 2 }, message: {} }, 102),
    ]),
    'idle',
  )
  // A shell command's own exit rides a tool RESULT — it ends the command, not
  // the run, however many of them the log holds (T-35230).
  let ran = row({
    entry: { session: 'e7', seq: 4 },
    result: { call: 'e101' },
    content: { body: 'ok' },
    exit: { code: 0 },
  }, 104)
  assertEquals(legacyStatus(idle, [ran]), 'idle')
  assertEquals(
    legacyStatus(legacy({ status: 'running' }).comps, [ran]),
    'running',
  )
  // a call with no result is a turn in flight
  let call = row({ entry: { session: 'e7', seq: 1 }, call: { key: 'k' } }, 101)
  assertEquals(legacyStatus(idle, [call]), 'running')
  // the server's stamped end outranks the log
  assertEquals(
    legacyStatus(legacy({ finished_at: '2026-09-08T00:00:00Z' }).comps, [
      call,
    ]),
    'settled',
  )
})

Deno.test('native status: the newest entry decides', () => {
  assertEquals(nativeStatus([]), 'empty')
  assertEquals(nativeStatus([entry(1, 'input')]), 'pending')
  assertEquals(nativeStatus([entry(1, 'input'), entry(2, 'ask')]), 'running')
  assertEquals(nativeStatus([entry(2, 'output'), entry(1, 'input')]), 'settled')
  assertEquals(nativeStatus([entry(1, 'input'), entry(2, 'stop')]), 'stopped')
  assertEquals(
    nativeStatus([entry(1, 'input'), entry(2, 'exception')]),
    'failed',
  )
})

Deno.test('statusFor picks the shape by the session columns', () => {
  let n = row({ session: { id: 's' } })
  assert(native(n))
  assertEquals(statusFor(n, [entry(1, 'output')]), 'settled')
  let l = legacy({ status: 'running' })
  assert(!native(l))
  assertEquals(statusFor(l, [entry(1, 'output')]), 'running')
})

Deno.test('over: settled, stopped and failed end a wait; the rest do not', () => {
  for (let s of ['settled', 'stopped', 'failed'] as const) assert(over(s))
  for (let s of ['empty', 'pending', 'running', 'idle'] as const) {
    assert(!over(s))
  }
})

Deno.test('exitCode: the legacy code, else 1 for failed, 0 for a quiet end', () => {
  let exit3 = row({ entry: { session: 'e7', seq: 9 }, exit: { code: 3 } }, 109)
  assertEquals(exitCode(legacy({}), 'failed', [exit3]), 3)
  assertEquals(exitCode(legacy({ exit_code: 4 }), 'failed'), 4)
  assertEquals(exitCode(legacy({ status: 'lost' }), 'failed'), 1)
  assertEquals(exitCode(legacy({ status: 'done' }), 'settled'), 0)
  assertEquals(exitCode(row({ session: { id: 's' } }), 'stopped'), 0)
})

Deno.test('briefOf: the brief, else the legacy final text', () => {
  assertEquals(briefOf(legacy({ final_text: 'bye' })), 'bye')
  assertEquals(
    briefOf(legacy({ final_text: 'bye' }, { brief: { text: ' hi \n' } })),
    'hi',
  )
  assertEquals(briefOf(legacy({})), '')
})

Deno.test('sessionLine: id, status, runner, age, and what it is about', () => {
  let now = Date.parse('2026-09-08T12:30:00Z')
  let r = legacy(
    { provider: 'codex', model: 'gpt-6-astra', requested_task: 'T-1' },
    { updated: { at: '2026-09-08T12:00:00Z' }, brief: { text: 'done\nmore' } },
  )
  assertEquals(
    sessionLine(r, 'settled', now),
    'S-7      settled  codex/gpt-6-astra       30m done',
  )
  assertMatch(sessionLine(legacy({ requested_task: 'T-1' }), 'idle'), /T-1$/)
})

Deno.test('nativeLines: the package Line renderer, seq kind text', () => {
  let lines = nativeLines([
    entry(1, 'input', 'List your tools'),
    row({ entry: { session: 'e7', seq: 2 }, ask: { to: 'm' } }, 102),
    row(
      { entry: { session: 'e7', seq: 3 }, call: { to: 't', source: 'e102' } },
      103,
    ),
  ])
  assertEquals(lines[0], '1 input     List your tools')
  assertEquals(lines[1], '2 ask       → m')
  assertEquals(lines[2], '3 call      → t')
})

Deno.test('poll: reads until done, sleeping between, and times out', async () => {
  let reads = 0
  let naps: number[] = []
  let sleep = (ms: number) => {
    naps.push(ms)
    return Promise.resolve()
  }
  let got = await poll(() => Promise.resolve(++reads), (n) => n == 3, {
    interval: 5,
    sleep,
  })
  assertEquals(got, 3)
  assertEquals(naps, [5, 5])
  await assertRejects(
    () => poll(() => Promise.resolve(0), () => false, { timeout: 1, sleep }),
    Error,
    'timed out',
  )
})

// The seam `task session wait` and `task spawn --wait` share: a fake session
// that is already settled, read through the local arm, so the wait ends on its
// first read and prints what it found.
let waited = async (r: Row, flags: string[] = []) => {
  let lines: string[] = []
  let log = console.log
  console.log = (line: string) => void lines.push(line)
  arm.query = (filters) =>
    Promise.resolve(filters.some((f) => f.startsWith('.entry')) ? [] : [r])
  try {
    await waitFor('S-7', {
      args: {},
      many: {},
      opts: {},
      flags: new Set(flags),
      params: [],
      words: [],
    })
  } finally {
    console.log = log
    delete arm.query
  }
  return lines
}

Deno.test('waitFor: the settled session, its brief, and the --json line', async () => {
  let r = legacy({ status: 'done' }, { brief: { text: 'landed abc123' } })
  assertEquals(await waited(r), ['S-7: settled', 'landed abc123'])
  assertEquals(await waited(r, ['--json']), [
    '{"id":"S-7","status":"settled","code":0,"brief":"landed abc123"}',
  ])
})
