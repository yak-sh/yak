// An unscoped lazy query reads the partition's TAIL: the newest entries its
// own compilable preds admit, across every session — so a fleet-wide
// `.message.role=user` answers the last user turns under the cap rather than
// the first 500 rows of whichever session sorts first.
import { assertEquals } from '@std/assert'
import { uuid } from './types.ts'
import { apply } from './db.ts'
import { append } from './entries.ts'
import { evalQuery } from './graph_query.ts'
import { freshDb } from './testdb.ts'

Deno.test('an unscoped facet query answers newest-first through its own narrowing', () => {
  let db = freshDb()
  let session = () => {
    let eid = uuid()
    apply(db, [{ eid, name: 'session', comp: { id: uuid() } }])
    return eid
  }
  let a = session(), b = session()
  append(db, a, [{ message: { role: 'user' }, content: { body: 'a first' } }])
  append(
    db,
    a,
    Array.from({ length: 600 }, (_, i) => ({ content: { body: `tool ${i}` } })),
  )
  append(db, b, [{ message: { role: 'user' }, content: { body: 'b last' } }])
  let hits = evalQuery(db, '.message.role=user', 0, 1).hits
  assertEquals(hits.map((h) => h.comps.content?.body), ['b last'])
  let both = evalQuery(db, '.message.role=user', 0, 500).hits
  assertEquals(
    both.map((h) => h.comps.content?.body).sort(),
    ['a first', 'b last'],
  )
  db.close()
})
