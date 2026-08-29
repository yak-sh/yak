// The Source seam: read doors consult ephemeral sources after SQL misses, and
// a pass-through entity NEVER lands a row. A synthetic in-memory source stands
// in for the file-backed session source — the seam is what's under test here.
Deno.env.set('DB_PATH', ':memory:')
let { apply, eager, entriesOf, matching, resolveId, rowsOf } = await import(
  './db.ts'
)
let { addSource, clearSources, sourceEntries } = await import('./source.ts')
let { freshDb } = await import('./testdb.ts')
let { assertEquals } = await import('@std/assert')

let OWNED = `entity = (select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`

let eid = '00000000-0000-4000-8000-0000000aaaaa'
let ghost = () => [
  { eid, name: 'entity', comp: { eid, num: null } },
  { eid, name: 'doc', comp: { title: 'legacy session', body: 'from a file' } },
  { eid, name: 'session', comp: { actor: 'ghost', id: 'ghost-sid' } },
]
let source = {
  resolve: (id: string) => id == 'ghost-sid' || id == eid ? ghost() : undefined,
  list: function* (_f: { sql: string; params: (string | number)[] }) {
    yield ghost()
  },
  entries: (e: string, after: number, _limit: number) =>
    e == eid && after < 1
      ? {
        state: 'found' as const,
        entries: [{
          eid: `${eid}-1`,
          seq: 1,
          comps: { entry: { eid: `${eid}-1`, session: e, seq: 1 } },
        }],
      }
      : { state: 'found' as const, entries: [] },
}

let count = (db: import('./sqlite.ts').DatabaseSync) =>
  (db.prepare('select count(*) as n from entity').get() as { n: number }).n

let withSource = (fn: (db: import('./sqlite.ts').DatabaseSync) => void) => {
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

Deno.test('source: graph partition handle wins before provider fallback', () => {
  let provider = addSource({
    entries: (handle: string) =>
      handle == 'provider-id'
        ? { state: 'found' as const, entries: [] }
        : undefined,
  })
  let graph = addSource({
    entries: (handle: string) =>
      handle == eid ? { state: 'empty' as const, entries: [] } : undefined,
  })
  try {
    // Source registration order must not let a provider-id match shadow the
    // graph-owned managed log. Handles are identity precedence; sources are
    // alternative implementations within each handle.
    assertEquals(sourceEntries([eid, 'provider-id'], 0, 500), {
      state: 'empty',
      entries: [],
    })
  } finally {
    graph()
    provider()
    clearSources()
  }
})

Deno.test('source: no source, no cost — a normal miss still returns undefined/empty', () => {
  let db = freshDb()
  assertEquals(resolveId(db, 'ghost-sid'), undefined)
  assertEquals(eager(db, eid), {})
  assertEquals(rowsOf(db, [eid]), [])
})

// Graduation (D-17790): a real write that ENGAGES an ephemeral entity hydrates
// its source comps into the same batch, so it persists + mints a num, keeping
// the same eid. The dot proof cases: engaged → graduated, un-engaged → still
// pass-through, already-persisted → not re-hydrated, non-source eid → untouched.

let has = (db: import('./sqlite.ts').DatabaseSync, table: string, id: string) =>
  db.prepare(
    table == 'entity' || table == 'tombstone'
      ? `select 1 from ${table} where eid = ?`
      : `select 1 from ${table} where ${OWNED}`,
  ).get(id) != undefined

// A source shaped EXACTLY like the file-backed one (source_file.ts resolve):
// session {id, provider} + doc {title}, no entity spine, no FK-bearing fields —
// so it can actually be WRITTEN, which the loose read-test `source` above (it
// forges an `actor` reference) cannot. Graduation goes through the real write
// loop, so it exercises the real column set.
let gid = '00000000-0000-4000-8000-0000000ccccc'
let gradSource = {
  resolve: (id: string) =>
    id == gid || id == 'grad-sid'
      ? [
        {
          eid: gid,
          name: 'session',
          comp: { id: 'grad-sid', provider: 'claude' },
        },
        { eid: gid, name: 'doc', comp: { title: 'Session grad-sid' } },
      ]
      : undefined,
}

Deno.test('graduation: a write to an ephemeral entity persists it, eid stable', () => {
  let db = freshDb()
  let off = addSource(gradSource)
  try {
    // Pre: pass-through — no row for the source eid.
    assertEquals(has(db, 'entity', gid), false)
    // A comment aimed at the ephemeral session IS the graduation write.
    let cid = crypto.randomUUID()
    apply(db, [
      { eid: cid, name: 'comment', comp: { target: gid } },
    ])
    // The session graduated at its unchanged eid, with a minted num and its
    // wire-writable source comps persisted.
    let e = db.prepare('select num from entity where eid = ?').get(gid) as
      | { num: number | null }
      | undefined
    assertEquals(typeof e?.num, 'number')
    assertEquals(
      (db.prepare(`select id, provider from session where ${OWNED}`).get(
        gid,
      ) as { id: string; provider: string }).id,
      'grad-sid',
    )
    assertEquals(
      (db.prepare(`select title from doc_value where ${OWNED}`).get(gid) as {
        title: string
      }).title,
      'Session grad-sid',
    )
    // The comment persisted too, still aimed at the same eid.
    assertEquals(
      (db.prepare(
        `select ${refEid('target')} as target from comment where ${OWNED}`,
      ).get(cid) as {
        target: string
      }).target,
      gid,
    )
    // And it resolves by eid to the SAME identity it had as a source.
    assertEquals(resolveId(db, gid), gid)
  } finally {
    off()
    clearSources()
  }
})

Deno.test('graduation: a second write does not re-hydrate a persisted entity', () => {
  let db = freshDb()
  let off = addSource(gradSource)
  try {
    apply(db, [{
      eid: crypto.randomUUID(),
      name: 'comment',
      comp: { target: gid },
    }])
    let n = count(db)
    // Now the entity is persisted; graduate() must skip it. Only the new
    // comment lands — no duplicate session/doc row.
    apply(db, [{
      eid: crypto.randomUUID(),
      name: 'comment',
      comp: { target: gid },
    }])
    assertEquals(count(db), n + 1) // exactly one new entity (the comment)
    assertEquals(
      (db.prepare(`select count(*) as n from session where ${OWNED}`).get(
        gid,
      ) as { n: number }).n,
      1,
    )
  } finally {
    off()
    clearSources()
  }
})

Deno.test('graduation: a write touching only persisted entities hydrates nothing', () => {
  let db = freshDb()
  let off = addSource(gradSource)
  try {
    // A brand-new task — no source owns its eid, so no graduation, and the
    // write path behaves exactly as it would with no sources at all.
    let tid = crypto.randomUUID()
    apply(db, [
      { eid: tid, name: 'doc', comp: { title: 'a real task' } },
      { eid: tid, name: 'task', comp: {} },
    ])
    assertEquals(has(db, 'task', tid), true)
    assertEquals(has(db, 'entity', gid), false) // the source eid stayed ephemeral
  } finally {
    off()
    clearSources()
  }
})
