// Split Session persistence: canonical projection and the one server writer.
Deno.env.set('DB_PATH', ':memory:')
let { apply, backfillSessionFacets } = await import('./db.ts')
let { sessionRow, writeSession } = await import('./session_store.ts')
let { freshDb } = await import('./testdb.ts')
let { assertEquals } = await import('@std/assert')

let uid = () => crypto.randomUUID()
let OWNED = `entity = (select id from entity where eid = ?)`

Deno.test('sessionRow overlays canonical nulls on stale aliases', () => {
  let db = freshDb()
  let eid = uid()
  apply(db, [{
    eid,
    name: 'session',
    comp: { id: uid(), cwd: '/old', pid: 7, provider: 'claude' },
  }])
  db.prepare(`update session set cwd = '/stale', pid = 9 where ${OWNED}`)
    .run(eid)
  db.prepare(`update worktree set cwd = null where ${OWNED}`).run(eid)
  db.prepare(`update runtime set pid = null where ${OWNED}`).run(eid)
  assertEquals(sessionRow(db, eid)?.cwd, null)
  assertEquals(sessionRow(db, eid)?.pid, null)
  db.close()
})

Deno.test('writeSession moves one patch through canonical and alias homes', () => {
  let db = freshDb()
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  db.exec('begin')
  let changes = writeSession(db, eid, {
    cwd: '/tree',
    branch: 'session/S-1',
    pid: 42,
    provider_session_id: 'thread',
    provider: 'codex',
  })
  db.exec('commit')
  assertEquals(changes.map((change) => change.name), [
    'session',
    'spawn',
    'worktree',
    'runtime',
  ])
  assertEquals(
    db.prepare(`select cwd, branch from worktree where ${OWNED}`)
      .get(eid),
    { cwd: '/tree', branch: 'session/S-1' },
  )
  assertEquals(
    db.prepare(
      `select pid, provider_session_id from runtime where ${OWNED}`,
    ).get(eid),
    { pid: 42, provider_session_id: 'thread' },
  )
  assertEquals(
    db.prepare(
      `select cwd, branch, pid, provider_session_id, provider from session where ${OWNED}`,
    ).get(eid),
    {
      cwd: '/tree',
      branch: 'session/S-1',
      pid: 42,
      provider_session_id: 'thread',
      provider: 'codex',
    },
  )
  assertEquals(sessionRow(db, eid)?.provider_session_id, 'thread')
  db.close()
})

Deno.test('lifecycle moves from run to settled and reopens without stale state', () => {
  let db = freshDb()
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  db.exec('begin')
  let started = writeSession(db, eid, {
    status: 'running',
    started_at: '2026-08-27T12:00:00Z',
    finished_at: null,
  })
  db.exec('commit')
  assertEquals(started.map((change) => change.name), ['session', 'run'])
  assertEquals(sessionRow(db, eid)?.status, 'running')

  db.exec('begin')
  let ended = writeSession(db, eid, {
    status: 'failed',
    finished_at: '2026-08-27T12:01:00Z',
    exit_code: 2,
    final_text: 'partial',
    stderr: 'provider stopped',
  })
  db.exec('commit')
  assertEquals(ended.map((change) => change.name), [
    'session',
    'run',
    'settled',
    'yield',
  ])
  assertEquals(
    db.prepare(`select * from run where ${OWNED}`).get(eid),
    undefined,
  )
  assertEquals(sessionRow(db, eid)?.finished_at, '2026-08-27T12:01:00Z')
  assertEquals(sessionRow(db, eid)?.final_text, 'partial')

  db.exec('begin')
  let resumed = writeSession(db, eid, {
    status: 'running',
    finished_at: null,
    exit_code: null,
    stop_reason: null,
  })
  db.exec('commit')
  assertEquals(resumed.map((change) => change.name), [
    'session',
    'settled',
    'run',
  ])
  assertEquals(sessionRow(db, eid)?.status, 'running')
  assertEquals(sessionRow(db, eid)?.finished_at, null)
  db.close()
})

Deno.test('boot backfill makes aliases canonical and canonical nulls win', () => {
  let db = freshDb()
  let eid = uid()
  apply(db, [{ eid, name: 'session', comp: { id: uid() } }])
  db.prepare(
    `update session set status = 'completed', finished_at = ?,
       final_text = 'done', stderr = 'tail' where ${OWNED}`,
  ).run('2026-08-27T12:02:00Z', eid)
  backfillSessionFacets(db)
  assertEquals(
    db.prepare(`select at, status from settled where ${OWNED}`).get(eid),
    { at: '2026-08-27T12:02:00Z', status: 'completed' },
  )
  assertEquals(
    db.prepare(`select final_text, stderr from "yield" where ${OWNED}`).get(
      eid,
    ),
    { final_text: 'done', stderr: 'tail' },
  )

  db.prepare(`update settled set at = null where ${OWNED}`).run(eid)
  backfillSessionFacets(db)
  assertEquals(sessionRow(db, eid)?.finished_at, null)
  assertEquals(
    db.prepare(`select finished_at from session where ${OWNED}`).get(eid),
    { finished_at: null },
  )
  db.close()
})
