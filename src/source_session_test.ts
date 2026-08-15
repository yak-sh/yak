// The file-backed session source (source_session.ts): a purged legacy session
// materializes from its transcript file through the SAME read doors, and NEVER
// lands a row. A temp ~/.claude/projects store stands in for the operator's.
Deno.env.set('DB_PATH', ':memory:')

let sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
let store = Deno.makeTempDirSync()
let proj = `${store}/some-project`
Deno.mkdirSync(proj)
Deno.writeTextFileSync(
  `${proj}/${sid}.jsonl`,
  [
    JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'text', text: 'hello' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi there' }] },
    }),
  ].join('\n'),
)
Deno.env.set('CLAUDE_PROJECTS', store)

let { eager, entriesOf, resolveId } = await import('./db.ts')
let { clearSources } = await import('./source.ts')
let { freshDb } = await import('./testdb.ts')
let { registerSessionSource, sidEid, forgetSessionIndex } = await import(
  './source_session.ts'
)
let { assertEquals } = await import('@std/assert')

let eid = sidEid(sid)

let count = (db: import('node:sqlite').DatabaseSync) =>
  (db.prepare('select count(*) as n from entity').get() as { n: number }).n

let withSource = (fn: (db: import('node:sqlite').DatabaseSync) => void) => {
  let db = freshDb()
  let before = count(db)
  forgetSessionIndex() // pick up the fixture regardless of cache state
  let off = registerSessionSource()
  try {
    fn(db)
    assertEquals(count(db), before) // no read ever persisted a row
  } finally {
    off()
    clearSources()
  }
}

Deno.test('sidEid: deterministic and shaped as a v5 uuid', () => {
  assertEquals(sidEid(sid), sidEid(sid))
  assertEquals(sidEid('other') != sidEid(sid), true)
  assertEquals(sidEid(sid)[14], '5') // version nibble
})

Deno.test('session source: resolveId finds a purged session by sid and by eid', () => {
  withSource((db) => {
    assertEquals(resolveId(db, sid), eid)
    assertEquals(resolveId(db, eid), eid)
    assertEquals(resolveId(db, 'no-such-sid'), undefined)
  })
})

Deno.test('session source: eager hydrates the session from its transcript', () => {
  withSource((db) => {
    let comps = eager(db, eid)
    assertEquals((comps.session as { id: string }).id, sid)
    assertEquals((comps.session as { origin: string }).origin, 'native')
    assertEquals((comps.entity as { num: unknown }).num, null)
    assertEquals((comps.doc as { title: string }).title.length > 0, true)
  })
})

Deno.test('session source: entriesOf streams the transcript tail, cursor-advanced', () => {
  withSource((db) => {
    let tail = entriesOf(db, eid, 0, 500)
    assertEquals(tail.length >= 1, true)
    assertEquals(tail[0].seq, 1)
    for (let row of tail) {
      assertEquals((row.comps.entry as { session: string }).session, eid)
    }
    // `after` is a real cursor: asking past the first entry drops it.
    let rest = entriesOf(db, eid, tail[0].seq, 500)
    assertEquals(rest.every((r) => r.seq > tail[0].seq), true)
  })
})

Deno.test('session source: no source, no cost — a normal miss stays empty', () => {
  let db = freshDb()
  assertEquals(resolveId(db, sid), undefined)
  assertEquals(eager(db, eid), {})
})
