// The store seam's two value predicates, held against SQLite itself: the same
// question asked in SQL and in JS has to give the same answer, or a filter
// means one thing to a store and another to the code reading its rows.
//
// The rest of this file drove the fleet's own file adapter through a second
// handle — a store without FTS5, a store planted from schemaDdl() — and went
// with that server (T-37584). What the platform store does on its own storage
// is workers/yak's do_test.ts and migrate.ts's tests.
import { assertEquals } from '@std/assert'
import { Database } from '@yaks/sqlite/db'
import { slow } from '../../../../bin/testing.ts'
import { present, textPresent, WHITESPACE } from './sql.ts'

// The WHITESPACE list is String.prototype.trim's, proven over the whole BMP
// (every Unicode space lives there).
slow('WHITESPACE is String.prototype.trim over the BMP', () => {
  let ws = new Set(WHITESPACE)
  let off: string[] = []
  for (let cp = 0; cp < 0x10000; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    if ((String.fromCodePoint(cp).trim() == '') != ws.has(cp)) {
      off.push(`U+${cp.toString(16)}`)
    }
  }
  assertEquals(off, [])
})

Deno.test('present() in SQL is textPresent() in JS', () => {
  let db = new Database(':memory:')
  let ask = db.prepare(`select ${present('?')} as p`)
  for (let v of ['', ' \t\n', ' ﻿　', ' x ', ' y', null]) {
    assertEquals(
      !!ask.get<{ p: unknown }>(v)?.p,
      textPresent(v),
      JSON.stringify(v),
    )
  }
  db.close()
})
