// Split Session persistence: canonical projection and the one server writer.
Deno.env.set('DB_PATH', ':memory:')
let { apply, open } = await import('./db.ts')
let { sessionRow, writeSession } = await import('./session_store.ts')
let { assertEquals } = await import('@std/assert')

let uid = () => crypto.randomUUID()

Deno.test('sessionRow overlays canonical nulls on stale aliases', () => {
  let db = open()
  let eid = uid()
  apply(db, [{
    eid,
    name: 'session',
    comp: { id: uid(), cwd: '/old', pid: 7, provider: 'claude' },
  }])
  db.prepare("update session set cwd = '/stale', pid = 9 where eid = ?")
    .run(eid)
  db.prepare('update worktree set cwd = null where eid = ?').run(eid)
  db.prepare('update runtime set pid = null where eid = ?').run(eid)
  assertEquals(sessionRow(db, eid)?.cwd, null)
  assertEquals(sessionRow(db, eid)?.pid, null)
  db.close()
})

Deno.test('writeSession moves one patch through canonical and alias homes', () => {
  let db = open()
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
    db.prepare('select cwd, branch from worktree where eid = ?')
      .get(eid),
    { cwd: '/tree', branch: 'session/S-1' },
  )
  assertEquals(
    db.prepare(
      'select pid, provider_session_id from runtime where eid = ?',
    ).get(eid),
    { pid: 42, provider_session_id: 'thread' },
  )
  assertEquals(
    db.prepare(
      'select cwd, branch, pid, provider_session_id, provider from session where eid = ?',
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
