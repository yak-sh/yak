// Graph-native Session entries: ordered append, immutable facts, lazy root
// sync, and server-owned runner outcomes.
import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert'
import {
  append,
  callKeys,
  cancelEntry,
  expiredLeases,
  failEntry,
  importedLines,
  readEntries,
  readEntry,
  readReplay,
  readyEntries,
  reclaimEntry,
  renewEntry,
  settleGeneration,
  takeEntry,
} from './entries.ts'
import { uuid } from './types.ts'
import { graphLog, standingOf } from './entry_log.ts'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, delta, numbered, open, snapshot } = await import('./db.ts')
let { freshDb } = await import('./testdb.ts')

let OWNED = `entity = (select id from entity where eid = ?)`

let session = (db: ReturnType<typeof open>, id = uuid()) => {
  let eid = uuid()
  apply(db, [{ eid, name: 'session', comp: { id } }])
  return eid
}

Deno.test('entries append in partition order and stay out of the root graph', () => {
  let db = freshDb()
  let a = session(db), b = session(db)
  let before = snapshot(db).cursor ?? 0
  let first = append(db, a, [
    { message: { role: 'user' }, content: { body: 'one' } },
    { attention: {} },
  ])
  let other = append(db, b, [{ message: { role: 'user' } }])

  assertEquals(readEntries(db, a).map((e) => e.seq), [1, 2])
  assertEquals(readEntries(db, b).map((e) => e.seq), [1])
  assertEquals(readEntries(db, a)[0].comps.content.body, 'one')
  assertEquals(readEntries(db, a)[0].comps.entity.num, null)
  assertEquals(numbered('entry'), false)
  let hidden = new Set([...first.eids, ...other.eids])
  assertEquals(
    snapshot(db).changes.some((c) => hidden.has(c.eid)),
    false,
  )
  assertEquals(delta(db, before).changes.some((c) => hidden.has(c.eid)), false)
  db.close()
})

Deno.test('entry facets are born together and immutable thereafter', () => {
  let db = freshDb()
  let sid = session(db)
  let { eids } = append(db, sid, [
    { message: { role: 'user' }, content: { body: 'fixed' } },
  ])
  assertThrows(
    () =>
      apply(db, [{ eid: eids[0], name: 'content', comp: { body: 'moved' } }]),
    Error,
    'immutable',
  )
  assertThrows(
    () => apply(db, [{ eid: eids[0], name: 'message', comp: null }]),
    Error,
    'immutable',
  )
  assertThrows(
    () =>
      apply(db, [{ eid: uuid(), name: 'content', comp: { body: 'orphan' } }]),
    Error,
    'needs entry in its batch',
  )
  assertThrows(
    () => apply(db, [{ eid: uuid(), name: 'entry', comp: {} }]),
    Error,
    'needs a session',
  )
  assertEquals(readEntries(db, sid)[0].comps.content.body, 'fixed')
  db.close()
})

Deno.test('the keyword-named apply facet round trips as one graph batch', () => {
  let db = freshDb()
  let sid = session(db)
  let eid = uuid()
  let changes = JSON.stringify([
    { eid, name: 'doc', comp: { title: 'x' } },
    { eid, name: 'task', comp: {} },
  ])
  append(db, sid, [{ apply: { changes } }])
  assertEquals(readEntries(db, sid)[0].comps.apply.changes, changes)
  db.close()
})

Deno.test('lease and usage facets are server-owned and one runner wins', () => {
  let db = freshDb()
  let sid = session(db)
  let runner = uuid(), rival = uuid()
  apply(db, [
    { eid: runner, name: 'runner', comp: { name: 'one' } },
    { eid: rival, name: 'runner', comp: { name: 'two' } },
  ])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: {
      through: input,
      provider: 'codex',
      model: 'gpt-test',
    },
  }]).eids[0]
  apply(db, [
    { eid: generation, name: 'lease', comp: {} },
    { eid: generation, name: 'usage', comp: {} },
  ])
  assertEquals(
    db.prepare(`select 1 from lease where ${OWNED}`).get(generation),
    undefined,
  )
  assertEquals(readyEntries(db, sid).map((e) => e.eid), [generation])
  let won = takeEntry(
    db,
    generation,
    runner,
    1000,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  assertEquals(takeEntry(db, generation, rival), undefined)
  assertEquals(readyEntries(db, sid), [])
  let settled = settleGeneration(db, won.token, {
    input: 10,
    cached: 4,
    output: 5,
    reasoning: 2,
  }, () => new Date('2026-08-10T12:00:01Z'))
  assertEquals(settled.map((c) => c.name), ['usage', 'delivered', 'lease'])
  let row = readEntries(db, sid).find((e) => e.eid == generation)!.comps
  assertEquals(row.usage, {
    eid: generation,
    input: 10,
    cached: 4,
    output: 5,
    reasoning: 2,
  })
  assertEquals(row.lease, undefined)
  assertEquals(readyEntries(db, sid), [])
  db.close()
})

Deno.test('only expired generation and read-only call leases can be reclaimed', () => {
  let db = freshDb()
  let sid = session(db), old = uuid(), next = uuid()
  apply(db, [
    { eid: old, name: 'runner', comp: { name: 'old' } },
    { eid: next, name: 'runner', comp: { name: 'next' } },
  ])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-test' },
  }]).eids[0]
  let stale = takeEntry(
    db,
    generation,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  assertEquals(
    reclaimEntry(
      db,
      stale.token,
      next,
      100,
      () => new Date('2026-08-10T12:00:00.050Z'),
    ),
    undefined,
  )
  let won = reclaimEntry(
    db,
    stale.token,
    next,
    100,
    () => new Date('2026-08-10T12:00:00.200Z'),
  )!
  assertEquals(won.token.eid, generation)
  assertEquals(won.token.holder, next)
  assertEquals(won.kind, 'generation')
  assertEquals(settleGeneration(db, stale.token), [])

  let query = append(db, sid, [{
    output: { source: generation },
    call: { key: 'read-only' },
    graph_query: { query: '.task.status=open' },
  }]).eids[0]
  let queryLease = takeEntry(
    db,
    query,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  let queryRetry = reclaimEntry(
    db,
    queryLease.token,
    next,
    100,
    () => new Date('2026-08-10T12:00:00.200Z'),
  )!
  assertEquals(queryRetry.token.eid, query)
  assertEquals(queryRetry.kind, 'call')

  let context = append(db, sid, [{
    output: { source: generation },
    call: { key: 'read-context' },
    task_context: {},
  }]).eids[0]
  let contextLease = takeEntry(
    db,
    context,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  let contextRetry = reclaimEntry(
    db,
    contextLease.token,
    next,
    100,
    () => new Date('2026-08-10T12:00:00.200Z'),
  )!
  assertEquals(contextRetry.token.eid, context)
  assertEquals(contextRetry.kind, 'call')

  append(db, sid, [{
    output: { source: generation },
    call: { key: 'side-effect' },
    bash: { command: 'echo once' },
  }])
  let call = readEntries(db, sid).at(-1)!.eid
  let sideEffect = takeEntry(
    db,
    call,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  assertEquals(
    reclaimEntry(
      db,
      sideEffect.token,
      next,
      100,
      () => new Date('2026-08-10T12:00:00.200Z'),
    ),
    undefined,
  )
  db.close()
})

Deno.test('a held lease renews forward, blocking a successor reclaim', () => {
  let db = freshDb()
  let sid = session(db), old = uuid(), next = uuid()
  apply(db, [
    { eid: old, name: 'runner', comp: { name: 'old' } },
    { eid: next, name: 'runner', comp: { name: 'next' } },
  ])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-test' },
  }]).eids[0]
  let held = takeEntry(
    db,
    generation,
    old,
    100,
    () => new Date('2026-08-10T12:00:00Z'),
  )!
  // The lease would lapse at 12:00:00.100; renew past it before it does.
  let renewed = renewEntry(
    db,
    held.token,
    100,
    () => new Date('2026-08-10T12:00:00.050Z'),
  )!
  assertEquals(renewed.token.until, '2026-08-10T12:00:00.150Z')
  assertEquals(renewed.token.holder, old)
  assertEquals(renewed.token.at, held.token.at)
  // A successor sees no expired lease and cannot reclaim it.
  assertEquals(expiredLeases(db, '2026-08-10T12:00:00.120Z'), [])
  assertEquals(
    reclaimEntry(
      db,
      held.token,
      next,
      100,
      () => new Date('2026-08-10T12:00:00.120Z'),
    ),
    undefined,
  )
  // The holder's own settle still owns it: renewal left holder+at untouched.
  assert(
    settleGeneration(
      db,
      held.token,
      undefined,
      () => new Date('2026-08-10T12:00:00.130Z'),
    ).length,
  )
  db.close()
})

Deno.test('renewal refuses a cancelled or absent lease', () => {
  let db = freshDb()
  let sid = session(db), runner = uuid()
  apply(db, [{ eid: runner, name: 'runner', comp: { name: 'one' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-test' },
  }]).eids[0]
  let held = takeEntry(db, generation, runner, 1000)!
  append(db, sid, [{ cancel: { target: generation } }])
  assertEquals(renewEntry(db, held.token, 1000), undefined)
  cancelEntry(db, held.token)
  assertEquals(renewEntry(db, held.token, 1000), undefined)
  db.close()
})

Deno.test('cancellation rejects late generation settlement', () => {
  let db = freshDb()
  let sid = session(db), runner = uuid()
  apply(db, [{ eid: runner, name: 'runner', comp: { name: 'one' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-test' },
  }]).eids[0]
  let won = takeEntry(db, generation, runner)!
  append(db, sid, [{ cancel: { target: generation } }])
  assertEquals(
    settleGeneration(db, won.token, {
      input: 1,
      cached: 0,
      output: 1,
      reasoning: 0,
    }),
    [],
  )
  assertEquals(
    readEntries(db, sid).find((e) => e.eid == generation)!.comps
      .usage,
    undefined,
  )
  db.close()
})

Deno.test('failed leased work stays visible and cannot rerun', () => {
  let db = freshDb()
  let sid = session(db), runner = uuid()
  apply(db, [{ eid: runner, name: 'runner', comp: { name: 'one' } }])
  let input = append(db, sid, [{ message: { role: 'user' } }]).eids[0]
  let generation = append(db, sid, [{
    generation: { through: input, provider: 'codex', model: 'gpt-test' },
  }]).eids[0]
  let won = takeEntry(db, generation, runner)!
  let failed = failEntry(db, won.token, 'provider unavailable')
  assertEquals(failed.map((c) => c.name), ['error', 'lease'])
  assertMatch(
    String(
      readEntries(db, sid).find((e) => e.eid == generation)!.comps.error
        .message,
    ),
    /provider unavailable/,
  )
  assertEquals(readyEntries(db, sid), [])
  db.close()
})

// Writes 504 entries on purpose — to outgrow the 500-row page and prove the
// whole partition still reads back. The at-scale write is the point, not
// trimmable, so it rides the slow tier.
slow('readEntries returns the whole partition past the pagination cap', () => {
  let db = freshDb()
  let sid = session(db)
  // A long-lived Session outgrows one entriesOf page. The runner reads the
  // WHOLE partition every operation, so the newest generation and a late call
  // must both stay visible: a truncated tail is what stamped a live session
  // "no generation entry" (generate() found no generation row) and "reading
  // 'comps'" (rowOf() returned undefined for a call it could not see) — T-16793.
  let bulk = Array.from({ length: 504 }, () => ({
    message: { role: 'user' as const },
  }))
  let base = append(db, sid, bulk)
  let tail = append(db, sid, [
    {
      generation: { through: base.eids.at(-1)!, provider: 'codex', model: 'x' },
    },
    { call: { key: 'call_tail' }, bash: { command: 'echo hi' } },
  ])
  let rows = readEntries(db, sid)
  assertEquals(rows.length, 506)
  let [gen, call] = tail.eids
  assert(rows.find((e) => e.eid == gen)?.comps.generation)
  assert(rows.find((e) => e.eid == call)?.comps.call)
  assertEquals(readEntry(db, call)?.comps.call.key, 'call_tail')
  db.close()
})

Deno.test('replay selects the newest provider-valid checkpoint tail', () => {
  let db = freshDb()
  let sid = session(db)
  let begin = uuid(), source = uuid(), checkpoint = uuid()
  append(
    db,
    sid,
    [
      { message: { role: 'user' }, content: { body: 'old prefix' } },
      {
        generation: { through: begin, provider: 'codex', model: 'old' },
      },
    ],
    undefined,
    [begin, source],
  )
  append(db, sid, Array.from({ length: 5 }, () => ({ attention: {} })))
  append(
    db,
    sid,
    [{
      output: { source },
      checkpoint: { through: source },
      opaque: {
        format: 'openai:compaction',
        data: JSON.stringify({ type: 'compaction', encrypted_content: 'cut' }),
      },
    }],
    undefined,
    [checkpoint],
  )
  let foreignSource = append(db, sid, [{
    generation: { through: checkpoint, provider: 'claude', model: 'other' },
  }]).eids[0]
  let foreign = append(db, sid, [{
    output: { source: foreignSource },
    checkpoint: { through: foreignSource },
    opaque: {
      format: 'openai:compaction',
      data: JSON.stringify({ type: 'compaction', encrypted_content: 'other' }),
    },
  }]).eids[0]
  let bad = append(db, sid, [{
    output: { source },
    checkpoint: { through: source },
    opaque: { format: 'openai:compaction', data: '{bad json' },
  }]).eids[0]
  let tail = append(db, sid, [{
    message: { role: 'user' },
    content: { body: 'bounded tail' },
  }]).eids[0]
  let current = append(db, sid, [{
    generation: { through: tail, provider: 'codex', model: 'new' },
  }]).eids[0]

  let replay = readReplay(db, current)
  assertEquals(replay.map((row) => row.eid), [
    checkpoint,
    foreignSource,
    foreign,
    bad,
    tail,
    source,
    current,
  ])
  assertEquals(readEntries(db, sid).length, 13)
  db.close()
})

Deno.test('append with a coord stamps imported on every entry it mints; the wire cannot', () => {
  let db = freshDb()
  let sid = session(db)
  let { eids } = append(
    db,
    sid,
    [{ call: { key: 'c1' }, bash: { command: 'ls' } }, {
      message: { role: 'agent' },
      content: { body: 'ok' },
    }],
    null,
    undefined,
    { source: 'managed', line: 7 },
  )
  let rows = readEntries(db, sid)
  // both entries of the one source line share its coordinate — the derived
  // cursor, all-or-nothing per line.
  for (let e of rows) {
    assertEquals(
      [e.comps.imported.source, e.comps.imported.line],
      ['managed', 7],
    )
  }
  assertEquals([...importedLines(db, sid, 'managed')], [7])
  assertEquals(callKeys(db, sid).get('c1'), eids[0])

  // A WIRE client naming imported in its own entry batch is refused: the entry
  // is created but the coordinate is dropped, so no client can pre-stamp one to
  // poison the ingester's dedup.
  let wireEid = uuid()
  apply(db, [
    { eid: wireEid, name: 'entry', comp: { session: sid } },
    { eid: wireEid, name: 'imported', comp: { source: 'evil', line: 99 } },
  ])
  let made = readEntries(db, sid).find((e) => e.eid == wireEid)!
  assert(made) // the entry itself landed
  assertEquals(made.comps.imported, undefined) // but its coordinate did not
  db.close()
})

Deno.test('deleting a Session cascades its lazy entries', () => {
  let db = freshDb()
  let sid = session(db)
  append(db, sid, [{ message: { role: 'user' } }, { attention: {} }])
  apply(db, [{ eid: sid, name: 'entity', comp: null }])
  assertEquals(readEntries(db, sid), [])
  db.close()
})

// A spine-less entry row is inert, never a landmine (T-19261). A partial
// ingest left two live sessions with an `entry`(+`content`) row whose entity
// spine never persisted; readEntries hands that to standingOf/graphLog, whose
// `row.comps.x` reads threw on the undefined comps a bare `!` produced —
// aborting the whole unattended sweep once per cycle. The fix gives such a row
// `{}` comps at the sole construction site, so the sweep's own seam completes.
Deno.test('a spine-less entry row reads as inert comps, not a throw', () => {
  let db = freshDb()
  let sid = session(db)
  append(db, sid, [
    { message: { role: 'user' }, content: { body: 'one' } },
    { message: { role: 'agent' }, content: { body: 'two' } },
  ])
  // Reproduce the live shape: an entry (with content) whose spine is gone. FK
  // enforcement forbids orphaning a spine through the normal path, so plant the
  // shape directly with the constraint off — the corruption, not its cause.
  let ghost = uuid()
  db.exec('pragma foreign_keys = off')
  // Give ghost a spine to obtain its integer id, wire entry+content to it, then
  // drop the spine — the partial-ingest shape under the id-keyed schema: an
  // `entry`(+`content`) whose entity spine no longer exists.
  db.prepare('insert into entity (eid) values (?)').run(ghost)
  let ghostId =
    (db.prepare('select id from entity where eid = ?').get(ghost) as {
      id: number
    }).id
  let sidId = (db.prepare('select id from entity where eid = ?').get(sid) as {
    id: number
  }).id
  db.prepare('insert into entry (entity, session, seq) values (?, ?, ?)')
    .run(ghostId, sidId, 99)
  db.prepare('insert into content (entity, body) values (?, ?)')
    .run(ghostId, 'orphaned tail')
  db.prepare('delete from entity where id = ?').run(ghostId)
  db.exec('pragma foreign_keys = on')

  let rows = readEntries(db, sid)
  // The row is still returned (dropping it would miscount the caller's paging),
  // but its comps are an empty object — never undefined.
  assertEquals(rows.length, 3)
  assertEquals(rows.find((r) => r.seq == 99)!.comps, {})
  // The sweep's own read (server.ts resumable): standingOf + graphLog over the
  // full log, including the ghost — completes rather than throwing. A pending
  // user turn with no agent generation is 'idle' (not busy, not terminal).
  assertEquals(standingOf(rows), 'idle')
  assertEquals(typeof graphLog(rows).terminal, 'boolean')
  db.close()
})
