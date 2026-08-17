// The managed-log source (source_managed.ts): a purged managed session
// materializes from ~/.tasks/logs/<eid>.jsonl through the SAME read doors, its
// dialect SNIFFED from the log, and NEVER lands a row. A temp LOGS_DIR stands in.
Deno.env.set('DB_PATH', ':memory:')

let store = Deno.makeTempDirSync()

// A claude managed log: a runner frame, the provider init, then narration.
let claudeEid = '6101c9fb-8b3a-4c9a-af4e-7350acdbf689'
Deno.writeTextFileSync(
  `${store}/${claudeEid}.jsonl`,
  [
    JSON.stringify({ type: 'session.prompt', text: 'house rules' }),
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      model: 'claude-opus-4-8',
    }),
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

// A codex managed log: `codex exec --json` stream (item.completed narration).
let codexEid = '24435f37-1b40-47b3-bc2e-cc614727a3fe'
Deno.writeTextFileSync(
  `${store}/${codexEid}.jsonl`,
  [
    JSON.stringify({ type: 'thread.started', thread_id: 'x' }),
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'hi there' },
    }),
  ].join('\n'),
)
Deno.env.set('LOGS_DIR', store)

let { eager, entriesOf, resolveId } = await import('./db.ts')
let { clearSources } = await import('./source.ts')
let { freshDb } = await import('./testdb.ts')
let { registerManagedSource, forgetManagedIndex, sniff } = await import(
  './source_managed.ts'
)
let { assertEquals } = await import('@std/assert')

let count = (db: import('./sqlite.ts').DatabaseSync) =>
  (db.prepare('select count(*) as n from entity').get() as { n: number }).n

let withSource = (fn: (db: import('./sqlite.ts').DatabaseSync) => void) => {
  let db = freshDb()
  let before = count(db)
  forgetManagedIndex()
  let off = registerManagedSource()
  try {
    fn(db)
    assertEquals(count(db), before) // no read ever persisted a row
  } finally {
    off()
    clearSources()
  }
}

Deno.test('sniff: settles the provider from the stream, skipping runner frames', () => {
  assertEquals(
    sniff(['{"type":"session.prompt"}', '{"type":"system"}']),
    'claude',
  )
  assertEquals(sniff(['{"type":"assistant"}']), 'claude')
  assertEquals(sniff(['{"type":"thread.started"}']), 'codex')
  assertEquals(sniff(['{"type":"item.completed"}']), 'codex')
  assertEquals(sniff(['{"type":"init"}', '{"type":"message"}']), 'fake')
  assertEquals(sniff(['{"type":"result","final_text":"x"}']), 'fake')
  assertEquals(sniff(['{"type":"result","subtype":"success"}']), 'claude')
  assertEquals(sniff(['garbage', '{"type":"assistant"}']), 'claude')
})

Deno.test('managed source: resolveId finds a purged managed session by its eid', () => {
  withSource((db) => {
    assertEquals(resolveId(db, claudeEid), claudeEid)
    assertEquals(resolveId(db, 'no-such-eid'), undefined)
  })
})

Deno.test('managed source: eager hydrates a claude managed session, dialect sniffed', () => {
  withSource((db) => {
    let comps = eager(db, claudeEid)
    assertEquals((comps.session as { origin: string }).origin, 'managed')
    assertEquals((comps.session as { provider: string }).provider, 'claude')
    assertEquals((comps.entity as { num: unknown }).num, null)
    assertEquals((comps.doc as { title: string }).title.length > 0, true)
  })
})

Deno.test('managed source: entriesOf streams the claude stream tail, cursor-advanced', () => {
  withSource((db) => {
    let tail = entriesOf(db, claudeEid, 0, 500)
    assertEquals(tail.length >= 2, true)
    assertEquals(tail[0].seq, 1)
    for (let row of tail) {
      assertEquals((row.comps.entry as { session: string }).session, claudeEid)
    }
    let rest = entriesOf(db, claudeEid, tail[0].seq, 500)
    assertEquals(rest.every((r) => r.seq > tail[0].seq), true)
  })
})

Deno.test('managed source: a codex managed log streams through the codex stream door', () => {
  withSource((db) => {
    assertEquals(
      (eager(db, codexEid).session as { provider: string }).provider,
      'codex',
    )
    let tail = entriesOf(db, codexEid, 0, 500)
    assertEquals(tail.length >= 1, true)
  })
})
