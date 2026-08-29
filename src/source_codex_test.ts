// The codex-native source (source_codex.ts): a purged codex rollout materializes
// through the SAME read doors — resolve by sid and by eid, hydrate, stream the
// tail — and NEVER lands a row. A temp ~/.codex/sessions store stands in.
Deno.env.set('DB_PATH', ':memory:')

let sid = '01a006a8-07b2-7453-a54d-6a851201169f'
let store = Deno.makeTempDirSync()
let day = `${store}/2026/08/15`
Deno.mkdirSync(day, { recursive: true })
Deno.writeTextFileSync(
  `${day}/rollout-2026-08-15T14-21-10-${sid}.jsonl`,
  [
    // The session_meta header the source ignores (sid rides the filename).
    JSON.stringify({ type: 'session_meta', payload: { session_id: sid } }),
    // The rollout dialect: event_msg envelopes carry user/agent narration.
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'user_message', message: 'hello' },
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'agent_message',
        message: 'hi there',
        phase: 'final_answer',
      },
    }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'function_call',
        call_id: 'call-1',
        name: 'exec_command',
        arguments: JSON.stringify({ cmd: 'pwd' }),
      },
    }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output:
          'Chunk ID: one\nProcess exited with code 0\nFinal output:\n/tmp',
      },
    }),
  ].join('\n'),
)
Deno.env.set('CODEX_SESSIONS', store)

let { apply, eager, entriesOf, resolveId } = await import('./db.ts')
let { evalGraph } = await import('./graph_query.ts')
let { clearSources } = await import('./source.ts')
let { freshDb } = await import('./testdb.ts')
let { registerCodexSource, forgetCodexIndex } = await import(
  './source_codex.ts'
)
let { sidEid } = await import('./source_file.ts')
let { assertEquals } = await import('@std/assert')

let eid = sidEid(sid)

let count = (db: import('./sqlite.ts').DatabaseSync) =>
  (db.prepare('select count(*) as n from entity').get() as { n: number }).n

let withSource = (
  fn: (db: import('./sqlite.ts').DatabaseSync) => void,
  written = 0,
) => {
  let db = freshDb()
  let before = count(db)
  forgetCodexIndex()
  let off = registerCodexSource()
  try {
    fn(db)
    assertEquals(count(db), before + written) // reads never persist rows
  } finally {
    off()
    clearSources()
  }
}

Deno.test('codex source: resolveId finds a purged rollout by sid and by eid', () => {
  withSource((db) => {
    assertEquals(resolveId(db, sid), eid)
    assertEquals(resolveId(db, eid), eid)
    assertEquals(resolveId(db, 'no-such-sid'), undefined)
  })
})

Deno.test('codex source: eager hydrates the session from its rollout', () => {
  withSource((db) => {
    let comps = eager(db, eid)
    assertEquals((comps.session as { id: string }).id, sid)
    assertEquals((comps.session as { origin: string }).origin, 'native')
    assertEquals((comps.session as { provider: string }).provider, 'codex')
    assertEquals((comps.entity as { num: unknown }).num, null)
    assertEquals((comps.doc as { title: string }).title.length > 0, true)
  })
})

Deno.test('codex source: entriesOf streams the rollout tail, cursor-advanced', () => {
  withSource((db) => {
    let tail = entriesOf(db, eid, 0, 500)
    assertEquals(tail.length >= 2, true)
    assertEquals(tail[0].seq, 1)
    for (let row of tail) {
      assertEquals((row.comps.entry as { session: string }).session, eid)
    }
    let rest = entriesOf(db, eid, tail[0].seq, 500)
    assertEquals(rest.every((r) => r.seq > tail[0].seq), true)
  })
})

Deno.test('codex source: persisted identity projects rollout rows and preserves paging identities', () => {
  withSource((db) => {
    let persisted = crypto.randomUUID()
    apply(db, [{ eid: persisted, name: 'session', comp: { id: sid } }])
    let all = entriesOf(db, persisted, 0, 500)
    assertEquals(
      entriesOf(db, persisted, 0, 500).map((row) => row.eid),
      all.map((row) => row.eid),
    )
    let first = entriesOf(db, persisted, 0, 1)
    assertEquals(first.length, 1)
    assertEquals(first[0].comps.entry?.session, persisted)
    let rest = entriesOf(db, persisted, first[0].seq, 500)
    assertEquals(
      [...first, ...rest].map((row) => row.eid),
      all.map((row) => row.eid),
    )
    let call = all.find((row) => row.comps.call)
    let result = all.find((row) => row.comps.result)
    assertEquals(result?.comps.result?.call, call?.eid)
    assertEquals(rest.every((row) => row.seq > first[0].seq), true)
    assertEquals(
      rest.every((row) => row.comps.entry?.session == persisted),
      true,
    )
    let hits = evalGraph(db, `.entry.session=${persisted}`).hits
    assertEquals(hits.length >= 2, true)
    assertEquals(
      hits.every((row) => row.comps.entry?.session == persisted),
      true,
    )
  }, 1)
})
