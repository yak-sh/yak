// The session verbs' pure seams: one status word for both session shapes, what
// counts as over, the exit code `wait` ends with, the listing line, native
// lines through the package renderer, and the poll loop with an injected clock.
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertThrows,
} from '@std/assert'
import { arm, type Row } from './client.ts'
import {
  briefOf,
  entryFollower,
  entryLines,
  exitCode,
  followFilter,
  following,
  legacyStatus,
  native,
  nativeLines,
  nativeStatus,
  over,
  poll,
  sessionLine,
  statusFor,
  tail,
  timeoutMs,
  waitFor,
} from './session_cli.ts'
import { manuals, parse } from './manual.ts'

Deno.test('wait timeout converts seconds, minutes, and hours without an unbounded fallback (T-35458)', () => {
  assertEquals(timeoutMs(), 0)
  for (
    let [raw, expected] of Object.entries({
      '900': 900_000,
      '900s': 900_000,
      '45m': 2_700_000,
      '2h': 7_200_000,
    })
  ) assertEquals(timeoutMs(raw), expected)
  for (let raw of ['', '0', 'bad', '45minutes', '999999999999999h']) {
    assertThrows(
      () => timeoutMs(raw),
      Error,
      '--timeout needs a positive duration',
    )
  }
})

let row = (comps: Row['comps'], num = 7): Row => ({
  eid: `e${num}`,
  num,
  kind: 'session',
  comps,
})
let wire = (r: Row) => ({
  kind: r.kind,
  entity: { eid: r.eid, num: r.num },
  ...r.comps,
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

Deno.test('session brief includes the measured tool account once', () => {
  let call = row({ bash: { command: 'deno task check' } }, 100)
  let result = row({ result: { call: call.eid, ms: 90_000 } }, 101)
  let entries = [call, result]
  let text = briefOf(legacy({ final_text: 'landed' }), entries)
  assertEquals(
    text,
    'landed\n\nTool wall-clock: 1m30s (sum of 1 measured calls; parallel waits add).\nSlowest commands/tools:\n- 1m30s — deno task check',
  )
  assertEquals(briefOf(legacy({}, { brief: { text } }), entries), text)
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

Deno.test('follow filters use typed row predicates and a presence OR default (T-35492)', () => {
  let es = ['input', 'notify', 'error', 'stop', 'call'].map((k, i) =>
    entry(i + 1, k)
  )
  assertEquals(es.filter(followFilter(undefined, true)), es.slice(1, 4))
  assertEquals(es.filter(followFilter()), es)
  for (let [i, name] of ['notify', 'error', 'stop'].entries()) {
    assertEquals(es.filter(followFilter(`.${name}`)), [es[i + 1]])
    assertEquals(es.filter(followFilter(`.${name}!`)), [es[i + 1]])
  }
  assertEquals(es.filter(followFilter('.entry.seq=2,4')), [es[1], es[3]])
  assertEquals(
    es.filter(followFilter('.entry.seq>=2&.entry.seq<4')),
    es.slice(1, 3),
  )
  assertEquals(
    es.filter(followFilter('.entry.seq!=2')),
    es.filter((_, i) => i != 1),
  )
  assertEquals(es.filter(followFilter('.error=')), es.filter((_, i) => i != 2))
  assert(
    followFilter('.content.body~=landed')(entry(9, 'output', 'Landed abc')),
  )
  for (
    let bad of [
      '',
      '.typo',
      '.entry.seq=bad',
      '.order=hot',
      'words',
      '.entry.session.doc.title=x',
    ]
  ) {
    assertThrows(() => followFilter(bad))
  }
})

Deno.test('spawn and tail parse bare/filtered follow, JSON, and redundant --wait (T-35492)', () => {
  for (let name of ['spawn', 'tail']) {
    for (
      let option of ['--follow', '--follow=.error', '--follow=.entry.seq=2,4']
    ) {
      let got = parse(name, manuals[name], [
        option,
        'S-7',
        '--json',
        ...name == 'spawn' ? ['--wait'] : [],
      ])
      assert(following(got))
      assert(got.flags.has('--json'))
      if (option == '--follow') assert(got.flags.has('--follow'))
      else assertEquals(got.opts['--follow'], option.slice('--follow='.length))
    }
    assertThrows(() => parse(name, manuals[name], ['S-7', '--follow=']))
  }
})

Deno.test('entry follower emits complete bundles once, one physical line each (T-35492)', () => {
  let r = legacy({ status: 'running' })
  let note = row({
    entry: { session: 'e7', seq: 2 },
    notify: {},
    content: { body: 'hello\nworld\u001b\u0085' },
    extra: { arbitrary: true },
  }, 102)
  let stop = entry(3, 'stop')
  let es = [entry(1, 'input'), note, stop]
  let got = parse('spawn', manuals.spawn, ['T-1', '--follow', '--json'])
  let show = entryFollower(got, true)
  let lines = show(r, es.slice(0, 2))
  assertEquals(lines.map((l) => JSON.parse(l)), [wire(note)])
  assertEquals(lines[0].split('\n').length, 1)
  assertEquals(show(r, es).map((l) => JSON.parse(l)), [wire(stop)])
  assertEquals(show(r, es), [])
  let text = entryLines(r, es, [note, stop])
  assertEquals(text.length, 2)
  assert(text.every((l) => l && !l.includes('\n') && !l.includes('\u001b')))
  // Fork entries use identities, not the greatest seq in an inherited prefix.
  let forked = row({ entry: { session: 'child', seq: 1 }, notify: {} }, 200)
  assertEquals(show(r, [...es, forked]).map((l) => JSON.parse(l)), [
    wire(forked),
  ])
})

Deno.test('wait follow polls unfiltered status, emits the terminal entry, and exits by outcome (T-35492)', async () => {
  let lines: string[] = []
  let log = console.log
  let exit = Deno.exit
  let codes: number[] = []
  let reads = 0
  let r = legacy({ status: 'running' })
  let es = [entry(1, 'call'), entry(2, 'notify'), entry(3, 'stop')]
  console.log = (line: string) => void lines.push(line)
  Deno.exit = ((code: number) => {
    codes.push(code)
  }) as typeof Deno.exit
  arm.query = (filters) => {
    if (filters.some((f) => f.startsWith('.entry'))) {
      return Promise.resolve(es.slice(0, ++reads == 1 ? 2 : 3))
    }
    return Promise.resolve([
      reads ? legacy({ status: 'failed', exit_code: 7 }) : r,
    ])
  }
  try {
    await waitFor(
      'S-7',
      parse('spawn', manuals.spawn, [
        'T-1',
        '--follow=.stop',
        '--json',
        '--interval=1',
      ]),
    )
    assertEquals(lines.map((l) => JSON.parse(l)), [wire(es[2])])
    assertEquals(codes, [7])
  } finally {
    console.log = log
    Deno.exit = exit
    delete arm.query
  }
})

Deno.test('tail JSONL filters its initial window and stops without a status receipt (T-35492)', async () => {
  let r = legacy({ status: 'done' })
  let es = [entry(1, 'input'), entry(2, 'notify'), entry(3, 'stop')]
  let lines: string[] = []
  let log = console.log
  console.log = (line: string) => void lines.push(line)
  arm.query = (filters) =>
    Promise.resolve(filters.some((f) => f.startsWith('.entry')) ? es : [r])
  try {
    await tail(
      parse('tail', manuals.tail, ['S-7', '--follow=.notify', '--json']),
    )
    assertEquals(lines.map((l) => JSON.parse(l)), [wire(es[1])])
  } finally {
    console.log = log
    delete arm.query
  }
})

Deno.test('entry JSONL uses the query bundle spine and strips storage eids (T-35492)', () => {
  let e = row({
    entity: { eid: 'e101', num: 101 },
    entry: { eid: 'e101', session: 'e7', seq: 1 },
    notify: { eid: 'e101' },
    content: { eid: 'e101', body: 'first\nsecond' },
  }, 101)
  e.kind = 'notify'
  let lines = entryLines(legacy({ status: 'running' }), [e], [e], true)
  assertEquals(lines.length, 1)
  assertEquals(lines[0].split('\n').length, 1)
  assertEquals(JSON.parse(lines[0]), {
    kind: 'notify',
    entity: { eid: 'e101', num: 101 },
    entry: { session: 'e7', seq: 1 },
    notify: {},
    content: { body: 'first\nsecond' },
  })
})

Deno.test('native follower defaults to notify/error/stop, including a hidden stop (T-35492)', () => {
  let r = row({ session: { id: 'native' } })
  let es = [
    entry(1, 'input', 'input'),
    entry(2, 'notify'),
    entry(3, 'error'),
    entry(4, 'stop'),
  ]
  let show = entryFollower(
    parse('spawn', manuals.spawn, ['T-1', '--follow']),
    true,
  )
  let lines = show(r, es)
  assertEquals(lines.length, 3)
  assert(lines.every((l) => l.length > 0 && !l.includes('\n')))
  assertEquals(show(r, es), [])
})

Deno.test('waitFor re-arms after a transient restart end and prints only the stable end (T-37196)', async () => {
  let lines: string[] = []
  let log = console.log
  let reads = 0
  let states = ['failed', 'running', 'running', 'done', 'done']
  console.log = (line: string) => void lines.push(line)
  arm.query = (filters) => {
    if (filters.some((f) => f.startsWith('.entry'))) {
      reads++
      return Promise.resolve([])
    }
    return Promise.resolve([
      legacy(
        { status: states[Math.min(reads, 4)] },
        reads >= 3 ? { brief: { text: 'really finished' } } : {},
      ),
    ])
  }
  try {
    await waitFor(
      'S-7',
      parse('session wait', manuals['session wait'], [
        'S-7',
        '--interval=1',
      ]),
    )
    assertEquals(reads, 5)
    assertEquals(lines, ['S-7: settled', 'really finished'])
  } finally {
    console.log = log
    delete arm.query
  }
})
