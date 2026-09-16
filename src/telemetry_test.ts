// The fleet's seat at @yaks/telemetry. The package owns — and tests — the
// table, the scrubbing, the cohorts, the clamps and the MCP classifier; what
// is fleet-only is that a live `Sql` handle answers the package's driver, that
// open() planted the table, and that every source the fleet records survives
// the CHECK the package bakes.
Deno.env.set('DB_PATH', ':memory:')
let { db } = await import('./live_db.ts')
let { record, recent, stats } = await import('./telemetry.ts')
let { assertEquals } = await import('@std/assert')

let tag = () => `t-${crypto.randomUUID().slice(0, 8)}`
let mine = (name: string, opts = {}) =>
  recent(db, { limit: 500, ...opts }).filter((r) => r.name == name)

Deno.test('the fleet handle records and reads back through the package', () => {
  let name = tag()
  record(db, { source: 'mcp', name, session_id: 's1', ok: true, ms: 12.6 })
  record(db, { source: 'http', name, ok: false, error: 'boom' })
  let rows = mine(name)
  assertEquals(rows.length, 2)
  assertEquals(rows[0].source, 'http') // newest first, ties broken by rowid
  assertEquals(rows[1].ms, 13) // rounded to whole ms
  assertEquals(mine(name, { only: 'errors' }).map((r) => r.error), ['boom'])
  assertEquals(stats(db, {}).find((s) => s.name == name)?.n, 1)
})

// `srv` and `cli` have no caller to disappoint: a row the CHECK refused would
// be a failure nobody ever hears about.
Deno.test('every source the fleet records survives the table CHECK', () => {
  let name = tag()
  for (let source of ['mcp', 'http', 'web', 'srv', 'cli'] as const) {
    record(db, { source, name, ok: false, error: 'x' })
  }
  assertEquals(mine(name, { only: 'errors' }).length, 5)
})
