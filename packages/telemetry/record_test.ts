// record never throws, never loops, and lands what it was given.

import { assertEquals } from '@std/assert'
import type { Driver } from './driver.ts'
import { record } from './record.ts'
import { recent } from './read.ts'
import { mem, tag } from './harness.ts'

let mine = (db: Driver, name: string, opts = {}) =>
  recent(db, { limit: 500, ...opts }).filter((r) => r.name == name)

Deno.test('round-trip, newest first, ms rounded, ties broken by rowid', () => {
  let db = mem()
  let name = tag()
  record(db, { source: 'mcp', name, session_id: 's1', ok: true, ms: 12.6 })
  record(db, { source: 'http', name, ok: false, error: 'boom' })
  let rows = mine(db, name)
  assertEquals(rows.length, 2)
  assertEquals(rows[0].source, 'http')
  assertEquals(rows[0].ok, 0)
  assertEquals(rows[0].error, 'boom')
  assertEquals(rows[0].ms, null)
  assertEquals(rows[1].session_id, 's1')
  assertEquals(rows[1].ok, 1)
  assertEquals(rows[1].ms, 13)
  assertEquals(typeof rows[1].ts, 'string')
})

Deno.test('a failing append is swallowed, not thrown', () => {
  let bomb: Driver = {
    query: () => {
      throw new Error('disk gone')
    },
    exec: () => {},
  }
  record(bomb, { source: 'srv', name: tag(), ok: true })
})

Deno.test('re-entry is dropped, not looped', () => {
  let db = mem()
  let name = tag()
  let bomb: Driver = {
    query: () => {
      record(db, { source: 'srv', name, ok: false, error: 're-entry' })
      return []
    },
    exec: () => {},
  }
  record(bomb, { source: 'srv', name, ok: true })
  assertEquals(mine(db, name).length, 0)
})
