// The Source seam: read doors consult ephemeral sources after SQL misses, and
// a pass-through entity NEVER lands a row. A synthetic in-memory source stands
// in for the file-backed session source — the seam is what's under test here.
Deno.env.set('DB_PATH', ':memory:')
let { eager, entriesOf, matching, resolveId, rowsOf } = await import('./db.ts')
let { addSource, clearSources } = await import('./source.ts')
let { freshDb } = await import('./testdb.ts')
let { assertEquals } = await import('@std/assert')

let eid = '00000000-0000-4000-8000-0000000aaaaa'
let ghost = () => [
  { eid, name: 'entity', comp: { eid, num: null } },
  { eid, name: 'doc', comp: { title: 'legacy session', body: 'from a file' } },
  { eid, name: 'session', comp: { actor: 'ghost', sid: 'ghost-sid' } },
]
let source = {
  resolve: (id: string) => id == 'ghost-sid' || id == eid ? ghost() : undefined,
  list: function* (_f: { sql: string; params: (string | number)[] }) {
    yield ghost()
  },
  entries: (e: string, after: number, _limit: number) =>
    e == eid && after < 1
      ? [{
        eid: `${eid}-1`,
        seq: 1,
        comps: { entry: { eid: `${eid}-1`, session: e, seq: 1 } },
      }]
      : [],
}

let count = (db: import('node:sqlite').DatabaseSync) =>
  (db.prepare('select count(*) as n from entity').get() as { n: number }).n

let withSource = (fn: (db: import('node:sqlite').DatabaseSync) => void) => {
  let db = freshDb()
  let before = count(db)
  let off = addSource(source)
  try {
    fn(db)
    assertEquals(count(db), before) // nothing persisted by any read
  } finally {
    off()
    clearSources()
  }
}

Deno.test('source: resolveId finds an ephemeral entity by handle and by eid', () => {
  withSource((db) => {
    assertEquals(resolveId(db, 'ghost-sid'), eid)
    assertEquals(resolveId(db, eid), eid)
    assertEquals(resolveId(db, 'no-such-handle'), undefined)
  })
})

Deno.test('source: eager hydrates a pass-through entity from its source', () => {
  withSource((db) => {
    let comps = eager(db, eid)
    assertEquals((comps.doc as { title: string }).title, 'legacy session')
    assertEquals((comps.session as { actor: string }).actor, 'ghost')
    assertEquals((comps.entity as { num: unknown }).num, null)
  })
})

Deno.test('source: rowsOf fills a keyed read for an eid SQL has no rows for', () => {
  withSource((db) => {
    let rows = rowsOf(db, [eid])
    assertEquals(rows.length, 1)
    assertEquals(rows[0].eid, eid)
    assertEquals(
      (rows[0].comps.doc as { title: string }).title,
      'legacy session',
    )
  })
})

Deno.test('source: matching unions ephemeral entities into a query result', () => {
  withSource((db) => {
    // A filter that matches nothing in SQL — the union must still surface the
    // source's match.
    let out = matching(db, {
      sql: 'select eid from entity where 1 = 0',
      params: [],
    })
    assertEquals(out.some((e) => e.eid == eid), true)
  })
})

Deno.test('source: entriesOf streams a pass-through session tail', () => {
  withSource((db) => {
    let tail = entriesOf(db, eid, 0, 500)
    assertEquals(tail.length, 1)
    assertEquals(tail[0].seq, 1)
  })
})

Deno.test('source: no source, no cost — a normal miss still returns undefined/empty', () => {
  let db = freshDb()
  assertEquals(resolveId(db, 'ghost-sid'), undefined)
  assertEquals(eager(db, eid), {})
  assertEquals(rowsOf(db, [eid]), [])
})
