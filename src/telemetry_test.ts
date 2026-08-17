// The observability seam: recording never throws, recent() reads back
// newest-first with its filters and clamps, and the /mcp body classifier
// tells tool traffic from handshake noise.
Deno.env.set('DB_PATH', ':memory:')
let { db } = await import('./db.ts')
let { outcome, record, recent, stats, toolCall } = await import(
  './telemetry.ts'
)
let { assertEquals } = await import('@std/assert')
let ok = (v: unknown) => assertEquals(!!v, true)

// Each test tags its rows with a unique name, so they share one handle.
let tag = () => `t-${crypto.randomUUID().slice(0, 8)}`
let mine = (name: string, opts = {}) =>
  recent(db, { limit: 500, ...opts }).filter((r) => r.name == name)

Deno.test('record + recent: round-trip, newest first', () => {
  let name = tag()
  record(db, { source: 'mcp', name, session_id: 's1', ok: true, ms: 12.6 })
  record(db, { source: 'http', name, ok: false, error: 'boom' })
  let rows = mine(name)
  assertEquals(rows.length, 2)
  assertEquals(rows[0].source, 'http') // newest first, ties broken by rowid
  assertEquals(rows[0].ok, 0)
  assertEquals(rows[0].error, 'boom')
  assertEquals(rows[0].ms, null)
  assertEquals(rows[1].session_id, 's1')
  assertEquals(rows[1].ok, 1)
  assertEquals(rows[1].ms, 13) // rounded to whole ms
  assertEquals(typeof rows[1].ts, 'string')
})

// The server's own background work has no caller to disappoint, so a
// dropped row is a failure nobody ever hears about — the one source that
// most needs the check constraint to know it.
Deno.test('srv: the sync that could not land is recorded like any call', () => {
  let name = tag()
  record(db, { source: 'srv', name, ok: false, error: 'push refused' })
  assertEquals(mine(name, { only: 'errors' }).map((r) => r.source), ['srv'])
})

Deno.test('long text is clipped; the limit clamps at 500', () => {
  let name = tag()
  record(db, { source: 'web', name, ok: false, detail: 'la '.repeat(2000) })
  assertEquals(mine(name)[0].detail?.length, 2048)
  for (let i = 0; i < 505; i++) record(db, { source: 'mcp', name, ok: true })
  assertEquals(recent(db, { limit: 9999 }).length, 500)
  assertEquals(recent(db, { limit: 0 }).length, 50) // 0/NaN = the default
  assertEquals(recent(db, { limit: -3 }).length, 1) // never zero rows
})

Deno.test('filters: errors only, and since a timestamp', () => {
  let name = tag()
  record(db, { source: 'mcp', name, ok: true })
  record(db, { source: 'mcp', name, ok: false, error: 'nope' })
  assertEquals(mine(name, { only: 'errors' }).length, 1)
  assertEquals(mine(name, { since: '2000-01-01T00:00:00Z' }).length, 2)
  assertEquals(mine(name, { since: '2999-01-01T00:00:00Z' }).length, 0)
})

// N copies of one crash read as ONE counted cohort — the whole point of the
// fingerprint. Distinct crashes stay distinct; a lone error carries no count.
Deno.test('cohort: identical errors collapse to one counted row', () => {
  let name = tag()
  let crash = { source: 'web' as const, name, ok: false }
  for (let i = 0; i < 3; i++) {
    record(db, {
      ...crash,
      error: 'TypeError: boom',
      detail: 'at f (a.ts:1:2)',
    })
  }
  record(db, { ...crash, error: 'RangeError: nope', detail: 'at g (a.ts:9:1)' })
  let errs = mine(name, { only: 'errors' })
  assertEquals(errs.length, 2) // three TypeErrors folded into one
  let cohort = errs.find((r) => r.error == 'TypeError: boom')!
  assertEquals(cohort.count, 3)
  ok(cohort.first! <= cohort.last!) // span runs oldest → newest
  assertEquals(
    errs.find((r) => r.error == 'RangeError: nope')!.count,
    undefined,
  )
})

// The message varies (a user id, a line) but the class + frames don't, so the
// cohort key ignores the message and still folds them.
Deno.test('cohort: same class + frames, different message, still one cohort', () => {
  let name = tag()
  let stack = 'at render (ui.ts)\nat tick (loop.ts)'
  record(db, {
    source: 'web',
    name,
    ok: false,
    error: 'TypeError: user 1 x',
    detail: stack,
  })
  record(db, {
    source: 'web',
    name,
    ok: false,
    error: 'TypeError: user 2 x',
    detail: stack,
  })
  assertEquals(mine(name, { only: 'errors' }).length, 1)
})

// Served publicly, so home paths, URLs, high-entropy tokens and control bytes
// are stripped on write — the stored row is already clean.
Deno.test('scrub: secrets and entropy stripped on the way in', () => {
  let name = tag()
  record(db, {
    source: 'web',
    name,
    ok: false,
    error: 'TypeError at https://api.example.com/x?token=abc',
    detail: '/home/yaks/code/a.ts\n550e8400-e29b-41d4-a716-446655440000\n' +
      'sk deadbeefdeadbeefdeadbeef\nctrl\x07bell',
  })
  let r = mine(name)[0]
  assertEquals(r.error?.includes('example.com'), false)
  ok(r.error?.includes('«url»'))
  assertEquals(r.detail?.includes('/home/yaks'), false)
  ok(r.detail?.includes('~/code/a.ts'))
  ok(r.detail?.includes('«id»')) // uuid
  ok(r.detail?.includes('«hex»')) // long hex run
  // deno-lint-ignore no-control-regex -- assert the BEL was stripped
  assertEquals(/[\x00-\x08]/.test(r.detail ?? ''), false)
})

// A sink that logs its own append failure must not loop: the second, nested
// record() sees the guard and drops, so nothing lands for this name.
Deno.test('record: re-entry is dropped, not looped', () => {
  let name = tag()
  let bomb = {
    prepare: () => ({
      run: () => {
        record(db, { source: 'srv', name, ok: false, error: 're-entry' })
        return {}
      },
    }),
  } as unknown as typeof db
  record(bomb, { source: 'srv', name, ok: true })
  assertEquals(mine(name).length, 0)
})

Deno.test('stats: p50/p95/p99 per door+tool in SQL, untimed rows skipped', () => {
  let name = tag()
  for (let v of [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
    record(db, { source: 'mcp', name, ok: true, ms: v })
  }
  record(db, { source: 'mcp', name, ok: true, ms: null }) // untimed: uncounted
  let row = stats(db).find((s) => s.name == name && s.source == 'mcp')!
  assertEquals(row.n, 10)
  assertEquals(row.p50, 55) // percentile_cont interpolates the median
  assertEquals(row.p95, 95.5)
  assertEquals(row.p99, 99.1)
})

Deno.test('stats: errors-only and since screen the distribution', () => {
  let name = tag()
  record(db, { source: 'http', name, ok: true, ms: 5 })
  record(db, { source: 'http', name, ok: false, ms: 100, error: 'x' })
  assertEquals(stats(db).find((s) => s.name == name)!.n, 2)
  let errs = stats(db, { only: 'errors' }).find((s) => s.name == name)!
  assertEquals(errs.n, 1)
  assertEquals(errs.p50, 100)
  assertEquals(
    stats(db, { since: '2999-01-01T00:00:00Z' }).find((s) => s.name == name),
    undefined,
  )
})

Deno.test('record never throws: a broken db warns, the caller lives', () => {
  let warned = 0
  let warn = console.warn
  console.warn = () => warned++
  try {
    record({} as never, { source: 'mcp', name: 'x', ok: true })
    // a source the check constraint refuses: sqlite throws, we don't
    record(db, { source: 'carrier pigeon' as 'mcp', name: 'x', ok: true })
  } finally {
    console.warn = warn
  }
  assertEquals(warned, 2)
})

Deno.test('toolCall: tools/call is traffic, the handshake is noise', () => {
  let call = (method: string, params?: unknown) => toolCall({ method, params })
  assertEquals(call('initialize'), null)
  assertEquals(call('tools/list'), null)
  assertEquals(call('tools/call'), null) // no params.name = not a call
  assertEquals(toolCall(null), null)
  assertEquals(call('tools/call', { name: 'task_list' }), {
    name: 'task_list',
    session_id: null,
  })
  assertEquals(
    call('tools/call', { name: 'task_claim', arguments: { session: 's7' } }),
    { name: 'task_claim', session_id: 's7' },
  )
})

Deno.test('outcome: jsonrpc errors and isError results both count as !ok', () => {
  let cases: [string, unknown, boolean, string | null][] = [
    [
      'plain result',
      { result: { content: [{ type: 'text', text: 'hi' }] } },
      true,
      null,
    ],
    [
      'jsonrpc error',
      { error: { code: -32602, message: 'bad params' } },
      false,
      'bad params',
    ],
    ['jsonrpc error, mute', { error: {} }, false, 'jsonrpc error'],
    [
      'tool error',
      {
        result: {
          isError: true,
          content: [{ type: 'text', text: 'no such task' }],
        },
      },
      false,
      'no such task',
    ],
    ['tool error, mute', { result: { isError: true } }, false, 'tool error'],
  ]
  for (let [what, reply, ok, error] of cases) {
    assertEquals(outcome(reply), { ok, error }, what)
  }
})
