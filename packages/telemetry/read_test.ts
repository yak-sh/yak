// recent: filters, clamps, and cohorts inside the cap. stats: percentiles per
// door and tool, untimed calls never counted.

import { assertEquals } from '@std/assert'
import type { Driver } from './driver.ts'
import { record } from './record.ts'
import { recent, stats } from './read.ts'
import { mem, tag } from './harness.ts'

let mine = (db: Driver, name: string, opts = {}) =>
  recent(db, { limit: 500, ...opts }).filter((r) => r.name == name)

Deno.test('limit clamps to [1, 500], 50 when absent or nonsense', () => {
  let db = mem()
  let name = tag()
  for (let i = 0; i < 505; i++) record(db, { source: 'mcp', name, ok: true })
  assertEquals(recent(db, { limit: 9999 }).length, 500)
  assertEquals(recent(db, { limit: 0 }).length, 50)
  assertEquals(recent(db).length, 50)
  assertEquals(recent(db, { limit: -3 }).length, 1)
})

Deno.test('filters: errors only, and since a timestamp', () => {
  let db = mem()
  let name = tag()
  record(db, { source: 'mcp', name, ok: true })
  record(db, { source: 'mcp', name, ok: false, error: 'nope' })
  assertEquals(mine(db, name, { only: 'errors' }).length, 1)
  assertEquals(mine(db, name, { since: '2000-01-01T00:00:00Z' }).length, 2)
  assertEquals(mine(db, name, { since: '2999-01-01T00:00:00Z' }).length, 0)
})

Deno.test('identical errors collapse to one counted row; a lone one carries no count', () => {
  let db = mem()
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
  let errs = mine(db, name, { only: 'errors' })
  assertEquals(errs.length, 2)
  let c = errs.find((r) => r.error == 'TypeError: boom')!
  assertEquals(c.count, 3)
  assertEquals(c.first! <= c.last!, true)
  assertEquals(
    errs.find((r) => r.error == 'RangeError: nope')!.count,
    undefined,
  )
})

Deno.test('stats: timed calls only, percentiles per (source, name)', () => {
  let db = mem()
  let name = tag()
  for (let ms of [10, 20, 30, 40]) {
    record(db, { source: 'mcp', name, ok: true, ms })
  }
  record(db, { source: 'mcp', name, ok: true })
  let [s] = stats(db).filter((r) => r.name == name)
  assertEquals(s.n, 4)
  assertEquals(s.p50, 25)
  assertEquals(stats(db, { since: '2999-01-01T00:00:00Z' }).length, 0)
})
