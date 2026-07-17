// The observability seam: recording never throws, recent() reads back
// newest-first with its filters and clamps, and the /mcp body classifier
// tells tool traffic from handshake noise.
Deno.env.set('DB_PATH', ':memory:')
let { db } = await import('./db.ts')
let { outcome, record, recent, toolCall } = await import('./telemetry.ts')
let { assertEquals } = await import('@std/assert')

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

Deno.test('long text is clipped; the limit clamps at 500', () => {
  let name = tag()
  record(db, { source: 'web', name, ok: false, detail: 'x'.repeat(5000) })
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
