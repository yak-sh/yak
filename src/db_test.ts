// apply()/snapshot() semantics against an in-memory db — the wire's
// contract: patches, creates, deletes, tombstones, and the claim lease.
Deno.env.set('DB_PATH', ':memory:')
let {
  apply,
  backfillOpened,
  backfillVia,
  db,
  delta,
  eager,
  journalBy,
  journalOf,
  mendMail,
  open,
  search,
  senderActor,
  snapshot,
  touch,
  vocabHashOf,
  vocabularyDoc,
  writerActor,
} = await import(
  './db.ts'
)
let { assertEquals, assertMatch, assertNotEquals, assertThrows } = await import(
  '@std/assert'
)
let { comps } = await import('./types.ts')

let fresh = () => open() // each test file shares one :memory: handle; use eids per test
let uid = () => crypto.randomUUID()

let vocab = (props: Record<string, import('./types.ts').PropType>) => ({
  note: props,
})

Deno.test('vocabHash: stamped readable declarations invalidate a cache', () => {
  let writable = vocab({ body: 'body' })
  assertNotEquals(
    vocabHashOf(writable, {}),
    vocabHashOf(writable, vocab({ at: 'time' })),
  )
})

Deno.test('vocabHash: writable declarations still invalidate a cache', () => {
  assertNotEquals(
    vocabHashOf(vocab({ body: 'body' }), {}),
    vocabHashOf(vocab({ title: 'text' }), {}),
  )
})

let compOf = (d: ReturnType<typeof open>, eid: string, name: string) =>
  snapshot(d).changes.find((c) => c.eid == eid && c.name == name)?.comp
let comp = (eid: string, name: string) => compOf(db, eid, name)

let tag = (
  db: ReturnType<typeof fresh>,
  name: string,
  value: Record<string, unknown> = {},
) => {
  let eid = uid()
  apply(db, [{ eid, name, comp: value }])
  return eid
}

type Local = ReturnType<typeof fresh>
type Props = Record<string, unknown>

let contract = (
  name: string,
  col: string,
  target: string,
  rest: Props | ((db: Local) => Props) = {},
  before?: (db: Local, eid: string) => void,
) => ({
  name,
  col,
  target,
  rest: typeof rest == 'function' ? rest : () => rest,
  before,
})

let contracts = [
  contract('task', 'project_eid', 'project', { status: 'open' }),
  contract('role', 'scope_eid', 'project'),
  contract('camera', 'client_eid', 'client', (d) => ({
    canvas_eid: tag(d, 'canvas'),
  })),
  contract('fold', 'client_eid', 'client', (d) => ({
    board_eid: tag(d, 'board'),
  })),
  contract('fold', 'board_eid', 'board', (d) => ({
    client_eid: tag(d, 'client'),
  })),
  contract('shelf', 'client_eid', 'client'),
  contract(
    'claim',
    'session_eid',
    'session',
    {},
    (d, eid) => apply(d, [{ eid, name: 'doc', comp: { title: 'claimed' } }]),
  ),
  contract('stop_request', 'target_eid', 'session'),
  contract('session', 'role_eid', 'role', { id: 'role-session' }),
  contract('mail', 'reply_to_eid', 'mail', {
    to: 'operator@example.test',
  }),
  contract('persona', 'home_eid', 'project'),
  contract('memory', 'scope_eid', 'project', { type: 'project' }),
]

Deno.test('create + patch + column clear', () => {
  let t = uid()
  let out = apply(db, [
    { eid: t, name: 'doc', comp: { title: 'A', body: 'b' } },
    { eid: t, name: 'task', comp: { status: 'open' } },
  ])
  assertEquals(comp(t, 'doc')?.title, 'A')
  assertEquals(comp(t, 'task')?.priority, 0) // schema default
  assertEquals(
    out.find((c) => c.eid == t && c.name == 'task')?.comp,
    {
      status: 'open',
      priority: 0,
      project_eid: null,
      assignee_eid: null,
      domain: null,
    },
  ) // the live batch carries the same defaults as a snapshot
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'B' } }])
  assertEquals(comp(t, 'doc')?.title, 'B')
  assertEquals(comp(t, 'doc')?.body, 'b') // patch: untouched column survives
})

Deno.test('entity delete tombstones; nothing resurrects the eid', () => {
  let t = uid()
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'gone' } }])
  apply(db, [{ eid: t, name: 'entity', comp: null }])
  assertEquals(comp(t, 'doc'), undefined)
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'zombie' } }]) // voided
  assertEquals(comp(t, 'doc'), undefined)
})

Deno.test('comment.event: the machine mark rides the wire, absent by default', () => {
  let t = uid(), c = uid(), plain = uid()
  apply(db, [
    { eid: t, name: 'doc', comp: { title: 'work' } },
    { eid: c, name: 'doc', comp: { title: '', body: 'S-1 failed' } },
    { eid: c, name: 'comment', comp: { target_eid: t, event: 1 } },
    { eid: plain, name: 'doc', comp: { title: '', body: 'words' } },
    { eid: plain, name: 'comment', comp: { target_eid: t } },
  ])
  assertEquals(comp(c, 'comment')?.event, 1)
  assertEquals(comp(plain, 'comment')?.event, null)
})

Deno.test('review: a comment carries one canonical verdict', () => {
  let t = uid(), c = uid()
  apply(db, [
    { eid: t, name: 'doc', comp: { title: 'work' } },
    { eid: c, name: 'doc', comp: { title: '', body: '' } },
    { eid: c, name: 'comment', comp: { target_eid: t } },
    { eid: c, name: 'review', comp: { verdict: 'approve' } },
  ])
  assertEquals(comp(c, 'review')?.verdict, 'approved')
  assertThrows(
    () =>
      apply(db, [{
        eid: uid(),
        name: 'review',
        comp: { verdict: 'maybe' },
      }]),
    Error,
    "verdict is one of approved, rejected, changes_requested — got 'maybe'",
  )
})

Deno.test('graph-out carries declared columns only', () => {
  let d = fresh()
  let eid = uid()
  d.exec('alter table web add column dormant text')
  apply(d, [{ eid, name: 'web', comp: { url: 'https://example.test' } }])
  d.prepare(
    'update web set frozen_at = ?, dormant = ? where eid = ?',
  ).run('2026-07-26T00:00:00Z', 'migration input', eid)
  let expected = {
    eid,
    url: 'https://example.test',
    frozen_at: '2026-07-26T00:00:00Z',
  }
  let snap = snapshot(d).changes.find((c) => c.eid == eid && c.name == 'web')
    ?.comp
  assertEquals(snap, expected)
  assertEquals(eager(d, eid).web, expected)
  d.close()
})

Deno.test('declared booleans bind as SQLite integers', () => {
  let s = uid()
  apply(db, [{
    eid: s,
    name: 'session',
    comp: { id: uid(), operator: false },
  }])
  assertEquals(comp(s, 'session')?.operator, 0)
  apply(db, [{ eid: s, name: 'session', comp: { operator: true } }])
  assertEquals(comp(s, 'session')?.operator, 1)
})

Deno.test('apply canonicalizes every scalar and reference spelling', () => {
  let target = uid(), subject = uid()
  apply(db, [
    { eid: target, name: 'doc', comp: { title: 'Target' } },
    { eid: target, name: 'person', comp: {} },
    { eid: target, name: 'alias', comp: { slug: 'typed-target' } },
    { eid: subject, name: 'doc', comp: { title: 'Subject' } },
    { eid: subject, name: 'task', comp: { status: 'open', priority: 0 } },
    { eid: subject, name: 'session', comp: { id: `typed-${subject}` } },
    { eid: subject, name: 'project', comp: {} },
    { eid: subject, name: 'board', comp: { query: '' } },
    { eid: subject, name: 'web', comp: { url: '' } },
    { eid: subject, name: 'alias', comp: { slug: 'typed-subject' } },
  ])
  let out = apply(db, [
    {
      eid: 'typed-subject',
      name: 'task',
      comp: {
        status: 'WIP',
        priority: 'P02',
        assignee_eid: 'typed-target',
        domain: 'Eng',
      },
    },
    {
      eid: 'typed-subject',
      name: 'session',
      comp: { pid: '06e2', operator: 'YES', pane: '%7', turn: 'IDLE' },
    },
    {
      eid: 'typed-subject',
      name: 'project',
      comp: { retired_at: '2026-07-01T00:00:00Z' },
    },
    {
      eid: 'typed-subject',
      name: 'board',
      comp: { query: '.status=open' },
    },
    {
      eid: 'typed-subject',
      name: 'web',
      comp: { url: 'https://example.test' },
    },
  ])
  assertEquals(out.slice(0, 5), [
    {
      eid: subject,
      name: 'task',
      comp: {
        status: 'wip',
        priority: 2,
        assignee_eid: target,
        domain: 'Eng',
      },
    },
    {
      eid: subject,
      name: 'session',
      comp: { pid: 600, operator: 1, pane: '%7', turn: 'idle' },
    },
    {
      eid: subject,
      name: 'project',
      comp: { retired_at: '2026-07-01T00:00:00.000Z' },
    },
    {
      eid: subject,
      name: 'board',
      comp: { query: '.status=open' },
    },
    {
      eid: subject,
      name: 'web',
      comp: { url: 'https://example.test' },
    },
  ])
  assertEquals(comp(subject, 'task')?.priority, 2)
  assertEquals(comp(subject, 'session')?.operator, 1)
  let logged = (db.prepare(
    'select batch from journal order by rowid desc',
  ).get() as { batch: string }).batch
  assertEquals(logged.includes('P02'), false)
  assertEquals(logged.includes('2026-07-01T00:00:00.000Z'), true)

  let num = Number(comp(target, 'entity')?.num)
  let [edge] = apply(db, [{
    eid: 'typed-subject',
    name: 'dependency',
    comp: { type: 'ABOUT', child_eid: String(num), gone: 'no' },
  }])
  assertEquals(edge, {
    eid: subject,
    name: 'dependency',
    comp: { type: 'about', child_eid: target, gone: 0 },
  })
})

Deno.test('typed rejection rolls back; optional empty scalars clear', () => {
  let s = uid()
  apply(db, [{
    eid: s,
    name: 'session',
    comp: { id: `typed-empty-${s}`, pid: 7, operator: 1 },
  }])
  apply(db, [{
    eid: s,
    name: 'session',
    comp: { pid: '', operator: '' },
  }])
  assertEquals(comp(s, 'session')?.pid, null)
  assertEquals(comp(s, 'session')?.operator, null)

  let before = journalCount()
  assertThrows(
    () =>
      apply(db, [
        { eid: s, name: 'doc', comp: { title: 'must roll back' } },
        { eid: s, name: 'session', comp: { operator: 'maybe' } },
      ]),
    Error,
    'operator is a boolean',
  )
  assertEquals(comp(s, 'doc'), undefined)
  assertEquals(journalCount(), before)
})

Deno.test('unknown component names are ignored, batch survives', () => {
  let t = uid()
  let out = apply(db, [
    { eid: t, name: 'hovercraft', comp: { eels: 9 } },
    { eid: t, name: 'doc', comp: { title: 'ok' } },
  ])
  assertEquals(comp(t, 'doc')?.title, 'ok')
  assertEquals(out.some((c) => c.name == 'hovercraft'), false)
  assertEquals(
    journalOf(db, t)[0].changes.some((c) => c.name == 'hovercraft'),
    false,
  )
})

// The other half of the hovercraft rule: an unknown COMPONENT is a
// compatible no-op, but a misspelled COLUMN inside a known one has no
// version story — it used to be stripped, the column's DEFAULT written,
// and 200 returned, so a caller asking for `done` got `open` and success.
Deno.test('a column naming nothing is refused, not silently defaulted', () => {
  let t = uid()
  assertThrows(
    () => apply(db, [{ eid: t, name: 'task', comp: { statuss: 'done' } }]),
    Error,
    'unknown column: task.statuss',
  )
  assertEquals(comp(t, 'task'), undefined) // nothing landed at the default
  // the batch is refused WHOLE — a good change beside a typo does not slip
  assertThrows(
    () =>
      apply(db, [
        { eid: t, name: 'doc', comp: { title: 'fine' } },
        { eid: t, name: 'task', comp: { status: 'done', statuss: 'done' } },
      ]),
    Error,
    'unknown column: task.statuss',
  )
  assertEquals(comp(t, 'doc'), undefined)
})

// A board is a saved query, so an unparseable one is broken forever and
// silent about it — the query names a prop or an enum value that cannot
// exist, and the board just opens empty. Refuse it while the typo is
// still in front of somebody.
Deno.test('a board query the grammar cannot parse is refused', () => {
  let b = uid()
  let save = (query: string) =>
    apply(db, [
      { eid: b, name: 'doc', comp: { title: 'a board' } },
      { eid: b, name: 'board', comp: { query } },
    ])
  assertThrows(() => save('.zzz=1'), Error, 'board query refused')
  assertThrows(() => save('.status=nonsens'), Error, 'board query refused')
  assertEquals(comp(b, 'board'), undefined) // refused whole, doc included
  // every legitimate shape still saves: a filter, empty (= every task),
  // bare words (text preds), an opless dot-word (a term, not a filter)
  for (let q of ['.project=P-19&.status=open,wip', '', 'bare words', '.env']) {
    save(q)
    assertEquals(comp(b, 'board')?.query, q)
  }
})

Deno.test('server-owned columns never ride persistence or effective batches', () => {
  let t = uid()
  let since = (db.prepare('select max(rowid) as n from journal').get() as {
    n: number | null
  }).n ?? 0
  let out = apply(db, [{
    eid: t,
    name: 'web',
    comp: { url: 'http://x', frozen_at: 'FAKE' },
  }])
  assertEquals(comp(t, 'web')?.frozen_at, null)
  let expected = { url: 'http://x' }
  assertEquals(out.find((c) => c.name == 'web')?.comp, expected)
  assertEquals(
    journalOf(db, t)[0].changes.find((c) => c.name == 'web')?.comp,
    expected,
  )
  assertEquals(
    delta(db, since).changes.find((c) => c.name == 'web')?.comp,
    expected,
  )
})

Deno.test('a write emptied by projection is wholly ignored', () => {
  let t = uid()
  let before = (db.prepare('select count(*) as n from journal').get() as {
    n: number
  }).n
  assertEquals(
    apply(db, [{
      eid: t,
      name: 'web',
      comp: { frozen_at: 'FAKE' },
    }]),
    [],
  )
  assertEquals(comp(t, 'entity'), undefined)
  assertEquals(comp(t, 'web'), undefined)
  assertEquals(
    (db.prepare('select count(*) as n from journal').get() as { n: number }).n,
    before,
  )
})

Deno.test('repo is a tag on a project: wire-writable, never the kind', () => {
  let p = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'a venture' } },
    { eid: p, name: 'project', comp: {} },
    { eid: p, name: 'repo', comp: { path: '/tmp/x', base_branch: 'trunk' } },
  ])
  assertEquals(comp(p, 'repo')?.path, '/tmp/x')
  assertEquals(comp(p, 'repo')?.base_branch, 'trunk')
  assertEquals(search(db, 'venture')[0]?.kind, 'project') // repo doesn't name it
})

Deno.test('shelf tags a canvas to a client; rides the snapshot', () => {
  let c = uid(), canvas = uid()
  apply(db, [
    { eid: c, name: 'client', comp: { user_agent: 'x' } },
    { eid: canvas, name: 'canvas', comp: {} },
    { eid: canvas, name: 'shelf', comp: { client_eid: c } },
  ])
  assertEquals(comp(canvas, 'shelf')?.client_eid, c)
  assertEquals(comp(canvas, 'canvas') != null, true) // still a canvas, not a kind
})

Deno.test('session lifecycle columns are server-owned', () => {
  let s = uid()
  apply(db, [{
    eid: s,
    name: 'session',
    comp: {
      id: 'sess-owned',
      cwd: '/tmp',
      status: 'running',
      origin: 'managed',
    },
  }])
  assertEquals(comp(s, 'session')?.cwd, '/tmp') // wire-writable
  assertEquals(comp(s, 'session')?.status, null) // lifecycle: server only
  assertEquals(comp(s, 'session')?.origin, 'external') // the default holds
  assertEquals(comp(s, 'session')?.latest_seq, 0)
  // A lifecycle column aimed at the wrong facet names nothing at all —
  // `spawn` is launch fields only. That used to be stripped in silence,
  // keeping `provider` and answering success; the caller's belief that it
  // had set a status went uncorrected. Server-owned is a silence (above);
  // nonexistent is an error.
  assertThrows(
    () =>
      apply(db, [{
        eid: s,
        name: 'spawn',
        comp: { provider: 'fake', status: 'completed', exit_code: 0 },
      }]),
    Error,
    'unknown columns: spawn.status, spawn.exit_code',
  )
  // refused whole: the facet the session minted is still blank
  assertEquals(comp(s, 'spawn')?.provider, null)
  apply(db, [{ eid: s, name: 'spawn', comp: { provider: 'fake' } }])
  assertEquals(comp(s, 'spawn')?.provider, 'fake')
  assertEquals(comp(s, 'session')?.provider, 'fake') // dormant reader alias
  assertEquals(comp(s, 'session')?.status, null)
})

Deno.test('legacy session launch fields dual-materialize', () => {
  let d = fresh()
  let s = uid(), persona = uid()
  apply(d, [{ eid: persona, name: 'persona', comp: {} }])
  let out = apply(d, [{
    eid: s,
    name: 'session',
    comp: {
      id: uid(),
      provider: 'fake',
      model: 'fake-fast',
      effort: 'low',
      persona_eid: persona,
    },
  }])
  let spec = {
    provider: 'fake',
    model: 'fake-fast',
    effort: 'low',
    persona_eid: persona,
  }
  assertEquals(
    Object.fromEntries(
      Object.keys(spec).map((k) => [k, compOf(d, s, 'spawn')?.[k]]),
    ),
    spec,
  )
  assertEquals(
    Object.fromEntries(
      Object.keys(spec).map((k) => [k, compOf(d, s, 'session')?.[k]]),
    ),
    spec,
  )
  assertEquals(out.some((c) => c.eid == s && c.name == 'spawn'), true)
})

Deno.test('canonical session launch fields dual-materialize', () => {
  let d = fresh()
  let s = uid(), task = uid()
  apply(d, [{ eid: task, name: 'task', comp: { status: 'open' } }])
  let out = apply(d, [
    {
      eid: s,
      name: 'spawn',
      comp: { provider: 'fake', model: 'fake-fast', effort: 'high' },
    },
    {
      eid: s,
      name: 'session',
      comp: {
        id: uid(),
        requested_task_eid: task,
        provider: 'claude',
        model: 'claude-sonnet-4-5',
        effort: 'low',
      },
    },
  ])
  assertEquals(compOf(d, s, 'spawn')?.provider, 'fake')
  assertEquals(compOf(d, s, 'spawn')?.model, 'fake-fast')
  assertEquals(compOf(d, s, 'spawn')?.effort, 'high')
  assertEquals(compOf(d, s, 'session')?.provider, 'fake')
  assertEquals(compOf(d, s, 'session')?.model, 'fake-fast')
  assertEquals(compOf(d, s, 'session')?.effort, 'high')
  assertEquals(compOf(d, s, 'session')?.requested_task_eid, task)
  assertEquals(
    out.filter((c) => c.eid == s && c.name == 'session').length,
    1,
  )
})

Deno.test('a task spawn hint never becomes a session', () => {
  let d = fresh()
  let task = uid()
  apply(d, [
    { eid: task, name: 'doc', comp: { title: 'hinted' } },
    { eid: task, name: 'task', comp: { status: 'open' } },
    {
      eid: task,
      name: 'spawn',
      comp: { provider: 'fake', model: 'fake-fast' },
    },
  ])
  assertEquals(compOf(d, task, 'spawn')?.provider, 'fake')
  assertEquals(compOf(d, task, 'session'), undefined)
  assertEquals(search(d, 'hinted')[0]?.kind, 'task')
  apply(d, [{ eid: task, name: 'spawn', comp: null }])
  assertEquals(compOf(d, task, 'spawn'), undefined)
  assertEquals(compOf(d, task, 'session'), undefined)
})

Deno.test('deleting a session spawn clears both homes without removing it', () => {
  let d = fresh()
  let clear = (s: string) => {
    assertEquals(compOf(d, s, 'spawn')?.provider, null)
    assertEquals(compOf(d, s, 'spawn')?.model, null)
    assertEquals(compOf(d, s, 'session')?.provider, null)
    assertEquals(compOf(d, s, 'session')?.model, null)
  }
  let existing = uid()
  apply(d, [
    { eid: existing, name: 'session', comp: { id: uid() } },
    {
      eid: existing,
      name: 'spawn',
      comp: { provider: 'fake', model: 'fake-fast' },
    },
  ])
  apply(d, [{ eid: existing, name: 'spawn', comp: null }])
  clear(existing)

  let oneBatch = uid()
  apply(d, [
    { eid: oneBatch, name: 'session', comp: { id: uid() } },
    {
      eid: oneBatch,
      name: 'spawn',
      comp: { provider: 'fake', model: 'fake-fast' },
    },
    { eid: oneBatch, name: 'spawn', comp: null },
  ])
  clear(oneBatch)
})

Deno.test('canonical mirrors roll back with a refused batch', () => {
  let d = fresh()
  let s = uid()
  apply(d, [
    { eid: s, name: 'session', comp: { id: uid() } },
    {
      eid: s,
      name: 'spawn',
      comp: { provider: 'fake', model: 'fake-fast' },
    },
  ])
  let bad = uid(), ghost = uid()
  assertThrows(
    () =>
      apply(d, [
        { eid: s, name: 'session', comp: { cwd: '/changed' } },
        { eid: s, name: 'spawn', comp: { model: 'changed' } },
        {
          eid: bad,
          name: 'task',
          comp: { status: 'open', project_eid: ghost },
        },
      ]),
    Error,
    'project_eid',
  )
  assertEquals(compOf(d, s, 'spawn')?.model, 'fake-fast')
  assertEquals(compOf(d, s, 'session')?.model, 'fake-fast')
  assertEquals(compOf(d, s, 'session')?.cwd, null)
  assertEquals(compOf(d, s, 'spawn')?.persona_eid, null)
  assertEquals(compOf(d, s, 'session')?.persona_eid, null)
  assertEquals(compOf(d, bad, 'entity'), undefined)
})

Deno.test('old snapshot readers keep the legacy session view', async () => {
  let { rows } = await import('./client.ts')
  let d = fresh()
  let s = uid()
  apply(d, [{
    eid: s,
    name: 'session',
    comp: { id: uid(), provider: 'fake', model: 'fake-fast' },
  }])
  let snap = snapshot(d)
  assertEquals(snap.capabilities, ['spawn'])
  let old = {
    changes: snap.changes.filter((c) => c.name != 'spawn'),
    deps: snap.deps,
  }
  let row = rows(old).find((r) => r.eid == s)!
  assertEquals(row.kind, 'session')
  assertEquals(row.comps.session?.provider, 'fake')
  assertEquals(row.comps.session?.model, 'fake-fast')
})

Deno.test('claim is a lease: conflict throws + audits, same session refreshes', () => {
  let task = uid(), a = uid(), b = uid()
  apply(db, [
    { eid: task, name: 'doc', comp: { title: 'contested' } },
    { eid: a, name: 'session', comp: { id: 'sess-a' } },
    { eid: b, name: 'session', comp: { id: 'sess-b' } },
    { eid: task, name: 'claim', comp: { session_eid: a } },
  ])
  assertThrows(
    () => apply(db, [{ eid: task, name: 'claim', comp: { session_eid: b } }]),
    Error,
    'already claimed by sess-a',
  )
  // the bounce left an audit row naming both sides
  let audit = snapshot(db).changes.filter((c) =>
    c.name == 'conflict' && c.comp?.target_eid == task
  )
  assertEquals(audit.length, 1)
  assertEquals(audit[0].comp?.loser, 'sess-b')
  assertEquals(audit[0].comp?.holder, 'sess-a')
  // same session again: no-op, no throw, no extra audit
  apply(db, [{ eid: task, name: 'claim', comp: { session_eid: a } }])
  // release, then the other side may take it
  apply(db, [{ eid: task, name: 'claim', comp: null }])
  apply(db, [{ eid: task, name: 'claim', comp: { session_eid: b } }])
  assertEquals(comp(task, 'claim')?.session_eid, b)
})

Deno.test('a failing claim voids its whole batch', () => {
  let task = uid(), a = uid(), c = uid()
  apply(db, [
    { eid: task, name: 'doc', comp: { title: 'atomic' } },
    { eid: a, name: 'session', comp: { id: 'sess-atomic' } },
    { eid: task, name: 'claim', comp: { session_eid: a } },
  ])
  assertThrows(() =>
    apply(db, [
      { eid: c, name: 'doc', comp: { title: 'rides along' } },
      { eid: task, name: 'claim', comp: { session_eid: uid() } },
    ])
  )
  assertEquals(comp(c, 'doc'), undefined) // rolled back with the claim
})

Deno.test('an FK refusal fails the whole batch loudly, naming the column', () => {
  let s = uid(), ghost = uid(), rider = uid()
  let err = assertThrows(
    () =>
      apply(db, [
        { eid: rider, name: 'doc', comp: { title: 'rides along' } },
        { eid: s, name: 'session', comp: { id: 'sess-fk', actor_eid: ghost } },
      ]),
    Error,
    'actor_eid',
  )
  assertMatch(err.message, /no such entity/)
  assertEquals(comp(s, 'session'), undefined) // the row never landed
  assertEquals(comp(s, 'entity'), undefined) // no zombie spine either
  assertEquals(comp(rider, 'doc'), undefined) // the whole batch rolled back
})

Deno.test('task project_eid requires a project and fails atomically', () => {
  let bare = uid(), task = uid(), rider = uid()
  apply(db, [{ eid: bare, name: 'doc', comp: { title: 'not a project' } }])
  let err = assertThrows(
    () =>
      apply(db, [
        { eid: rider, name: 'doc', comp: { title: 'rides along' } },
        {
          eid: task,
          name: 'task',
          comp: { status: 'open', project_eid: bare },
        },
      ]),
    Error,
    task,
  )
  assertMatch(err.message, new RegExp(`project_eid.*${bare}`))
  assertEquals(comp(task, 'entity'), undefined)
  assertEquals(comp(rider, 'doc'), undefined)

  let project = uid(), existing = uid(), patchRider = uid()
  apply(db, [
    { eid: project, name: 'project', comp: {} },
    {
      eid: existing,
      name: 'task',
      comp: { status: 'open', project_eid: project },
    },
  ])
  assertThrows(() =>
    apply(db, [
      { eid: patchRider, name: 'doc', comp: { title: 'also rides' } },
      { eid: existing, name: 'task', comp: { project_eid: bare } },
    ])
  )
  assertEquals(comp(existing, 'task')?.project_eid, project)
  assertEquals(comp(patchRider, 'doc'), undefined)

  let ghost = uid()
  assertThrows(
    () =>
      apply(db, [{
        eid: uid(),
        name: 'task',
        comp: { status: 'open', project_eid: ghost },
      }]),
    Error,
    'project_eid',
  )
})

Deno.test('a later project does not reorder unrelated births', () => {
  let first = uid(), later = uid()
  apply(db, [
    { eid: first, name: 'doc', comp: { title: 'first' } },
    { eid: later, name: 'project', comp: {} },
  ])
  assertEquals(
    Number(comp(first, 'entity')?.num) < Number(comp(later, 'entity')?.num),
    true,
  )
})

Deno.test('task project_eid accepts projects created anywhere in its batch', () => {
  let before = uid(), after = uid(), a = uid(), b = uid()
  apply(db, [
    { eid: before, name: 'project', comp: {} },
    {
      eid: a,
      name: 'task',
      comp: { status: 'open', project_eid: before },
    },
  ])
  apply(db, [
    {
      eid: b,
      name: 'task',
      comp: { status: 'open', project_eid: after },
    },
    { eid: after, name: 'project', comp: {} },
  ])
  assertEquals(comp(a, 'task')?.project_eid, before)
  assertEquals(comp(b, 'task')?.project_eid, after)
})

Deno.test('typed eid contracts are the complete vocabulary set', () => {
  let declared = Object.entries(comps).flatMap(([name, props]) =>
    Object.entries(props).flatMap(([col, type]) =>
      typeof type == 'object' && 'eid' in type && type.eid
        ? [`${name}.${col}:${type.eid}`]
        : []
    )
  ).sort()
  assertEquals(
    declared,
    contracts.map((c) => `${c.name}.${c.col}:${c.target}`).sort(),
  )
})

Deno.test('every typed eid rejects a target missing its component', () => {
  for (let c of contracts) {
    let local = fresh()
    let wrong = tag(local, 'doc', { title: 'wrong kind' })
    let source = uid()
    c.before?.(local, source)
    let err = assertThrows(
      () =>
        apply(local, [{
          eid: source,
          name: c.name,
          comp: { ...c.rest(local), [c.col]: wrong },
        }]),
      Error,
      c.name == 'stop_request' ? 'gone' : c.col,
    )
    if (c.name != 'stop_request') {
      assertMatch(err.message, new RegExp(`no such ${c.target}`))
    }
    assertEquals(
      snapshot(local).changes.some((change) =>
        change.eid == source && change.name == c.name
      ),
      false,
    )
    local.close()
  }
})

Deno.test('typed refs may precede their targets without reordering births', () => {
  let local = fresh()
  let memory = uid(), middle = uid(), project = uid()
  apply(local, [
    {
      eid: memory,
      name: 'memory',
      comp: { type: 'reference', scope_eid: project },
    },
    { eid: middle, name: 'doc', comp: { title: 'middle' } },
    { eid: project, name: 'project', comp: {} },
  ])
  let num = (eid: string) =>
    Number(
      snapshot(local).changes.find((c) => c.eid == eid && c.name == 'entity')
        ?.comp?.num,
    )
  assertEquals(num(memory) < num(middle), true)
  assertEquals(num(middle) < num(project), true)
  local.close()
})

Deno.test('a target component cannot leave typed references dangling', () => {
  let local = fresh()
  let project = tag(local, 'project')
  let task = uid(), rider = uid()
  apply(local, [{
    eid: task,
    name: 'task',
    comp: { status: 'open', project_eid: project },
  }])
  assertThrows(
    () =>
      apply(local, [
        { eid: rider, name: 'doc', comp: { title: 'rides along' } },
        { eid: project, name: 'project', comp: null },
      ]),
    Error,
    'project_eid',
  )
  let changes = snapshot(local).changes
  assertEquals(
    changes.some((c) => c.eid == project && c.name == 'project'),
    true,
  )
  assertEquals(
    changes.some((c) => c.eid == rider && c.name == 'doc'),
    false,
  )
  local.close()
})

Deno.test('a NOT NULL refusal fails the whole batch', () => {
  let s = uid(), rider = uid()
  assertThrows(
    () =>
      apply(db, [
        { eid: rider, name: 'doc', comp: { title: 'rides along' } },
        { eid: s, name: 'session', comp: { model: 'claude-opus-4-8' } },
      ]),
    Error,
    'session.id',
  )
  assertEquals(comp(s, 'entity'), undefined)
  assertEquals(comp(rider, 'doc'), undefined)
})

Deno.test('a comment aimed at a ghost refuses the same way', () => {
  let c = uid()
  assertThrows(
    () =>
      apply(db, [
        { eid: c, name: 'doc', comp: { title: '', body: 'into the void' } },
        { eid: c, name: 'comment', comp: { target_eid: uid() } },
      ]),
    Error,
    'target_eid',
  )
  assertEquals(comp(c, 'doc'), undefined)
})

Deno.test('one batch creates referent then referrer: both land', () => {
  let who = uid(), s = uid()
  apply(db, [
    { eid: who, name: 'doc', comp: { title: 'an actor' } },
    { eid: s, name: 'session', comp: { id: 'sess-pair', actor_eid: who } },
  ])
  assertEquals(comp(s, 'session')?.actor_eid, who)
})

Deno.test('a tombstoned referent refuses and says so', () => {
  let t = uid(), s = uid()
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'brief' } }])
  apply(db, [{ eid: t, name: 'entity', comp: null }])
  assertThrows(
    () =>
      apply(db, [
        { eid: s, name: 'session', comp: { id: 'sess-grave', actor_eid: t } },
      ]),
    Error,
    'tombstoned',
  )
})

Deno.test('an FK refusal on the patch path bounces too', () => {
  let s = uid()
  apply(db, [{ eid: s, name: 'session', comp: { id: 'sess-patch' } }])
  assertThrows(
    () => apply(db, [{ eid: s, name: 'session', comp: { actor_eid: uid() } }]),
    Error,
    'actor_eid',
  )
  assertEquals(comp(s, 'session')?.actor_eid, null) // untouched
})

Deno.test('spine mints once, num is monotonic', () => {
  let x = uid(), y = uid()
  apply(db, [{ eid: x, name: 'entity', comp: {} }])
  apply(db, [{ eid: y, name: 'entity', comp: {} }])
  let num = (eid: string) => Number(comp(eid, 'entity')?.num)
  assertEquals(num(y), num(x) + 1)
  apply(db, [{ eid: x, name: 'doc', comp: { title: 't' } }])
  assertEquals(Number(comp(x, 'entity')?.num), num(x)) // touch ≠ re-mint
})

Deno.test('a birth rides the return: the minted spine, once', () => {
  let t = uid()
  let born = apply(db, [{ eid: t, name: 'doc', comp: { title: 'newborn' } }])
    .filter((c) => c.eid == t && c.name == 'entity')
  assertEquals(born.length, 1)
  assertEquals(Number(born[0].comp?.num) > 0, true)
  // a patch touches an EXISTING spine — no re-announcement
  let patched = apply(db, [{ eid: t, name: 'doc', comp: { title: 'named' } }])
  assertEquals(patched.some((c) => c.name == 'entity'), false)
  // create-then-delete in one batch: the spine is gone, nothing rides
  let x = uid()
  let brief = apply(db, [
    { eid: x, name: 'doc', comp: { title: 'mayfly' } },
    { eid: x, name: 'entity', comp: null },
  ])
  assertEquals(brief.some((c) => c.name == 'entity' && c.comp), false)
})

Deno.test('provenance: created once at birth, updated absent until edited', () => {
  let t = uid()
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'aging' } }])
  let bornAt = comp(t, 'created')?.at
  assertEquals(typeof bornAt, 'string')
  // updated is ABSENT until the first real modification (T-6670)
  assertEquals(comp(t, 'updated'), undefined)
  // the wire can't fake the frozen `at` — it's out of the writable set
  apply(db, [{ eid: t, name: 'created', comp: { at: 'FAKE' } }])
  assertEquals(comp(t, 'created')?.at, bornAt) // unchanged
  // an edit stamps updated, at ≥ birth
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'aged' } }])
  let editedAt = comp(t, 'updated')?.at
  assertEquals(typeof editedAt, 'string')
  assertEquals(String(editedAt) >= String(bornAt), true)
  assertEquals(comp(t, 'created')?.at, bornAt) // created.at still frozen
})

Deno.test('provenance: created.by defaults to the writer actor; the wire overrides', () => {
  // A fresh :memory: graph so the lone person IS the box owner writerActor
  // falls back to (the shared db may already hold several).
  let d = fresh()
  let at = (eid: string, name: string) =>
    snapshot(d).changes.find((c) => c.eid == eid && c.name == name)?.comp
  let jeff = uid(), amy = uid()
  apply(d, [
    { eid: jeff, name: 'person', comp: {} },
    { eid: amy, name: 'doc', comp: { title: 'Amy' } },
  ])
  // default: no writer named → the box owner authors
  let t = uid()
  apply(d, [{ eid: t, name: 'doc', comp: { title: 'filed' } }])
  assertEquals(at(t, 'created')?.by, jeff)
  // override: the batch names the author explicitly
  let u = uid()
  apply(d, [
    { eid: u, name: 'doc', comp: { title: 'by hand' } },
    { eid: u, name: 'created', comp: { by: amy, via: 'FAKE' } },
  ])
  assertEquals(at(u, 'created')?.by, amy)
  assertEquals(typeof at(u, 'created')?.at, 'string') // at still stamped
  assertEquals(at(u, 'created')?.via, null) // via is never wire-writable
})

Deno.test('provenance: via resolves session ids and eids, never direct actors', () => {
  let d = fresh()
  let actor = uid(), session = uid(), sid = uid()
  apply(d, [
    { eid: actor, name: 'project', comp: {} },
    {
      eid: session,
      name: 'session',
      comp: { id: sid, actor_eid: actor },
    },
  ])
  let stamp = (eid: string) =>
    snapshot(d).changes.find((c) => c.eid == eid && c.name == 'created')?.comp
  for (let writer of [sid, session]) {
    let eid = uid()
    apply(d, [{ eid, name: 'doc', comp: { title: 'said' } }], undefined, writer)
    assertEquals(stamp(eid)?.by, actor)
    assertEquals(stamp(eid)?.via, session)
  }
  let direct = uid()
  apply(
    d,
    [{ eid: direct, name: 'doc', comp: { title: 'direct' } }],
    undefined,
    actor,
  )
  assertEquals(stamp(direct)?.by, actor)
  assertEquals(stamp(direct)?.via, null)
})

Deno.test('lifecycle stamps: bare presence server-stamps provenance; the wire cannot', () => {
  // Fresh graph so the lone person IS the box-owner writerActor default.
  let d = fresh()
  let stamp = (eid: string, name: string) =>
    snapshot(d).changes.find((c) => c.eid == eid && c.name == name)?.comp
  let jeff = uid(), client = uid()
  apply(d, [
    { eid: jeff, name: 'person', comp: {} },
    { eid: client, name: 'client', comp: { actor_eid: jeff } },
  ])
  let t = uid()
  apply(d, [{ eid: t, name: 'doc', comp: { title: 'a letter' } }])

  // A bare {} presence write: absent before, then the server freezes the stamp.
  assertEquals(stamp(t, 'opened'), undefined)
  let out = apply(
    d,
    [{ eid: t, name: 'opened', comp: {} }],
    undefined,
    client,
  )
  let at1 = stamp(t, 'opened')?.at
  assertEquals(typeof at1, 'string')
  assertEquals(stamp(t, 'opened')?.by, jeff) // the writing actor
  assertEquals(stamp(t, 'opened')?.via, client) // its instrument
  // …and the stamp rides back on apply()'s RETURN (the echo follows the bare
  // wire write, like created's), or optimistic caches show a blank stamp.
  let rode = out.findLast((c) => c.eid == t && c.name == 'opened')
  assertEquals(rode?.comp?.at, at1)
  assertEquals(rode?.comp?.by, jeff)
  assertEquals(rode?.comp?.via, client)

  // Monotonic: a re-write never moves at/by (insert-or-ignore + by-is-null).
  apply(d, [{ eid: t, name: 'opened', comp: {} }])
  assertEquals(stamp(t, 'opened')?.at, at1)
  assertEquals(stamp(t, 'opened')?.via, client)

  // The wire can set none of the stamp — all live in `stamped`, out of comps.
  let u = uid()
  apply(d, [{ eid: u, name: 'doc', comp: { title: 'forge' } }])
  apply(d, [{ eid: u, name: 'archived', comp: {} }], undefined, client)
  let archived = stamp(u, 'archived')
  let forged = apply(
    d,
    [{
      eid: u,
      name: 'archived',
      comp: { at: 'FAKE', by: 'evil', via: 'FAKE' },
    }],
    undefined,
    client,
  )
  assertEquals(forged, [])
  assertMatch(String(archived?.at), /^\d{4}-/)
  assertEquals(stamp(u, 'archived'), archived)
})

Deno.test('lifecycle stamps: one-list — snapshot, showMd, and GRAMMAR pick them up with no extra edits', async () => {
  let { rows, showMd } = await import('./client.ts')
  let { GRAMMAR } = await import('./grammar.ts')
  let d = fresh()
  let jeff = uid()
  apply(d, [{ eid: jeff, name: 'person', comp: {} }])
  let t = uid()
  apply(d, [{ eid: t, name: 'doc', comp: { title: 'a letter' } }])
  apply(d, [{ eid: t, name: 'opened', comp: {} }])
  let snap = snapshot(d)
  // cache shape: snapshot carries the tag comp with its stamped at
  let carried = snap.changes.find((c) => c.eid == t && c.name == 'opened')
  assertEquals(typeof carried?.comp?.at, 'string')
  // showMd: the stamped outcome renders, derived from comps + stamped
  let all = rows(snap)
  let row = all.find((r) => r.eid == t)!
  assertMatch(showMd(snap, all, row), /opened\.by: /)
  // MCP/CLI grammar teaches each as a tag comp
  for (let n of ['notified', 'opened', 'archived']) {
    assertMatch(GRAMMAR, new RegExp(`${n}: \\(tag\\)`))
  }
  // The stampedPresence derive is {at,by}-shaped ONLY: `conflict` is also an
  // empty wire comp with a stamped `at`, but it has no `by` column and is a
  // server-minted audit — a bare wire write of it must drop quietly, NOT
  // reach the by-fill loop and throw "no such column: by" on the live entity.
  apply(d, [{ eid: t, name: 'conflict', comp: {} }]) // dropped, no throw
  assertEquals(snapshot(d).changes.find((c) => c.name == 'conflict'), undefined)
})

// The read→opened migration (T-7006): the backfill seeds `opened` from
// every already-read letter, so no mail flickers unread when the readers
// flip to NOT opened. Insert-or-ignore on the pk makes it a no-op on
// re-boot; read_at lingers dormant as the rollback source.
Deno.test('backfill: mail.read_at seeds opened, idempotently', () => {
  let d = fresh()
  let m = uid()
  // a legacy read letter: read_at set the OLD way, no `opened` stamp yet
  apply(d, [
    { eid: m, name: 'doc', comp: { title: 'old letter' } },
    {
      eid: m,
      name: 'mail',
      comp: { to: 'jeff', read_at: '2026-07-01T00:00:00Z' },
    },
  ])
  let openedAt = () =>
    (d.prepare('select at from opened where eid = ?').get(m) as
      | { at: string }
      | undefined)?.at
  assertEquals(openedAt(), undefined) // the wire write of read_at made no stamp
  backfillOpened(d)
  assertEquals(openedAt(), '2026-07-01T00:00:00.000Z') // canonical read_at
  // idempotent: a re-run never moves an existing stamp
  d.prepare('update opened set at = ? where eid = ?').run('MOVED', m)
  backfillOpened(d)
  assertEquals(openedAt(), 'MOVED')
})

Deno.test('open backfills every pre-spawn session, once', () => {
  let path = Deno.makeTempFileSync({ prefix: 'tasks-spawn-', suffix: '.db' })
  let legacy = uid(), external = uid()
  let d = open(path)
  apply(d, [
    {
      eid: legacy,
      name: 'session',
      comp: {
        id: uid(),
        provider: 'fake',
        model: 'fake-fast',
        effort: 'low',
      },
    },
    { eid: external, name: 'session', comp: { id: uid(), cwd: '/tmp' } },
  ])
  d.exec('drop table spawn')
  d.close()

  d = open(path)
  assertEquals(
    (d.prepare('select count(*) as n from spawn').get() as { n: number }).n,
    (d.prepare('select count(*) as n from session').get() as { n: number }).n,
  )
  assertEquals(compOf(d, legacy, 'spawn')?.model, 'fake-fast')
  assertEquals(compOf(d, external, 'spawn')?.provider, null)
  d.prepare("update spawn set model = 'canonical' where eid = ?").run(legacy)
  d.close()

  d = open(path)
  assertEquals(compOf(d, legacy, 'spawn')?.model, 'canonical')
  assertEquals(compOf(d, legacy, 'session')?.model, 'fake-fast')
  apply(d, [{ eid: legacy, name: 'spawn', comp: null }])
  d.close()

  d = open(path)
  assertEquals(compOf(d, legacy, 'spawn')?.provider, null)
  assertEquals(compOf(d, legacy, 'spawn')?.model, null)
  assertEquals(compOf(d, legacy, 'session')?.provider, null)
  assertEquals(compOf(d, legacy, 'session')?.model, null)
  d.close()
  Deno.removeSync(path)
})

Deno.test('open drops a retired acked_at, and keeps the session', () => {
  let path = Deno.makeTempFileSync({ prefix: 'tasks-acked-', suffix: '.db' })
  let sess = uid()
  let d = open(path)
  apply(d, [{ eid: sess, name: 'session', comp: { id: 'probe', cwd: '/tmp' } }])
  // A database written before the stamp replaced the cursor.
  d.exec('alter table session add column acked_at text')
  d.prepare('update session set acked_at = ? where eid = ?')
    .run('2026-01-01T00:00:00.000Z', sess)
  d.close()

  let cols = (db: ReturnType<typeof open>) =>
    (db.prepare("select name from pragma_table_info('session')")
      .all() as { name: string }[]).map((c) => c.name)
  d = open(path)
  assertEquals(cols(d).includes('acked_at'), false)
  assertEquals(compOf(d, sess, 'session')?.cwd, '/tmp') // the row survives
  d.close()

  d = open(path) // idempotent: a second boot has nothing to drop
  assertEquals(cols(d).includes('acked_at'), false)
  d.close()
  Deno.removeSync(path)
})

Deno.test('backfill: comment instruments move into created.via', () => {
  let d = fresh()
  let target = uid(), author = uid(), comment = uid()
  apply(d, [
    { eid: target, name: 'doc', comp: { title: 'target' } },
    { eid: author, name: 'session', comp: { id: uid() } },
    { eid: comment, name: 'doc', comp: { title: '', body: 'old words' } },
    {
      eid: comment,
      name: 'comment',
      comp: { target_eid: target, author_eid: author },
    },
  ])
  assertEquals(
    (d.prepare('select author_eid from comment where eid = ?').get(comment) as {
      author_eid: string | null
    }).author_eid,
    null,
  ) // retired: the wire cannot write the dormant source
  d.prepare('update comment set author_eid = ? where eid = ?')
    .run(author, comment)
  assertEquals(
    snapshot(d).changes.find((c) => c.eid == comment && c.name == 'comment')
      ?.comp,
    { eid: comment, target_eid: target, event: null },
  ) // dormant migration input never rides graph-out
  d.prepare('update created set via = null where eid = ?').run(comment)
  backfillVia(d)
  let via = snapshot(d).changes.find((c) =>
    c.eid == comment && c.name == 'created'
  )?.comp?.via
  assertEquals(via, author)
  backfillVia(d)
  assertEquals(
    snapshot(d).changes.find((c) => c.eid == comment && c.name == 'created')
      ?.comp?.via,
    author,
  )
})

Deno.test('backfill: memory instruments move into created.via', () => {
  let d = fresh()
  let source = uid(), memory = uid()
  apply(d, [
    { eid: source, name: 'session', comp: { id: uid() } },
    { eid: memory, name: 'doc', comp: { title: 'old fact' } },
    { eid: memory, name: 'memory', comp: { type: 'reference' } },
  ])
  d.prepare('update memory set source_eid = ? where eid = ?')
    .run(source, memory)
  d.prepare('update created set via = null where eid = ?').run(memory)
  assertEquals(
    snapshot(d).changes.find((c) => c.eid == memory && c.name == 'memory')
      ?.comp,
    {
      eid: memory,
      type: 'reference',
      scope_eid: null,
      last_confirmed_at: null,
    },
  )
  backfillVia(d)
  let via = snapshot(d).changes.find((c) =>
    c.eid == memory && c.name == 'created'
  )?.comp?.via
  assertEquals(via, source)
  d.prepare('update memory set source_eid = ? where eid = ?')
    .run(uid(), memory)
  backfillVia(d)
  assertEquals(
    snapshot(d).changes.find((c) => c.eid == memory && c.name == 'created')
      ?.comp?.via,
    source,
  )
})

Deno.test('fts: search finds, follows edits, forgets the dead', () => {
  let t = uid(), c = uid()
  apply(db, [
    { eid: t, name: 'doc', comp: { title: 'Xylophone repair', body: 'tune' } },
    { eid: t, name: 'task', comp: { status: 'open' } },
  ])
  assertEquals(search(db, 'xylophone')[0]?.eid, t)
  assertEquals(search(db, 'xylo*')[0]?.kind, 'task') // prefix + derived kind
  // every term prefix-matches unasked — search is typed live
  assertEquals(search(db, 'xylo')[0]?.eid, t)
  assertEquals(search(db, 'xylophone repai')[0]?.eid, t)
  assertEquals(search(db, 'xylophone repairs').length, 0) // prefix ≠ fuzzy
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'Glockenspiel repair' } }])
  assertEquals(search(db, 'xylophone').length, 0) // the edit moved the index
  // a comment hit opens its TARGET, not itself
  apply(db, [
    { eid: c, name: 'doc', comp: { title: '', body: 'the quincunx angle' } },
    { eid: c, name: 'comment', comp: { target_eid: t } },
  ])
  assertEquals(search(db, 'quincunx')[0]?.open_eid, t)
  // …and wears the target's title — the aside has none of its own
  assertEquals(search(db, 'quincunx')[0]?.title, 'Glockenspiel repair')
  apply(db, [{ eid: t, name: 'entity', comp: null }])
  assertEquals(search(db, 'glockenspiel').length, 0) // tombstoned = unfindable
  assertEquals(search(db, 'quincunx').length, 0) // the comment died with it
  assertEquals(search(db, '"broken (syntax'), []) // user words, not operators
})

Deno.test('entity delete cascades to aimed entities, detaches soft refs', () => {
  let p = uid(), t = uid(), t2 = uid(), card = uid(), note = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'proj' } },
    { eid: p, name: 'project', comp: {} },
    { eid: t, name: 'doc', comp: { title: 'doomed' } },
    { eid: t, name: 'task', comp: { status: 'open', project_eid: p } },
    { eid: t2, name: 'doc', comp: { title: 'survivor' } },
    { eid: t2, name: 'task', comp: { status: 'open', project_eid: p } },
    { eid: card, name: 'card', comp: { target_eid: t, view: 'Task' } },
    { eid: note, name: 'doc', comp: { title: '', body: 'aimed at doomed' } },
    { eid: note, name: 'comment', comp: { target_eid: t } },
  ])
  let out = apply(db, [{ eid: t, name: 'entity', comp: null }])
  // the cascade rides the returned batch, so every cache hears about it
  for (let victim of [card, note]) {
    assertEquals(
      out.some((c) => c.eid == victim && c.name == 'entity' && !c.comp),
      true,
    )
    assertEquals(comp(victim, 'doc') ?? comp(victim, 'card'), undefined)
  }
  // deleting the project detaches its surviving tasks, kills nothing
  apply(db, [{ eid: p, name: 'entity', comp: null }])
  assertEquals(comp(t2, 'task')?.project_eid, null)
  assertEquals(comp(t2, 'doc')?.title, 'survivor')
})

// mail.target_eid is death-'keep' (a sent mail is history — its subject's
// death doesn't unsend it), so deleting the subject must succeed and the
// mail row must keep pointing at the grave.
Deno.test('mail survives its subject: death keeps the reference', () => {
  let t = uid(), m = uid()
  apply(db, [
    { eid: t, name: 'doc', comp: { title: 'subject' } },
    { eid: m, name: 'doc', comp: { title: 'sent word' } },
    { eid: m, name: 'mail', comp: { to: 'jeff', target_eid: t } },
  ])
  apply(db, [{ eid: t, name: 'entity', comp: null }])
  assertEquals(comp(t, 'doc'), undefined) // the subject is gone
  assertEquals(comp(m, 'mail')?.target_eid, t) // history stands
})

// The FK-era mail table vetoed that delete (T-4593); open() heals a live
// db through mendMail — rebuild once, then never again.
Deno.test('mendMail: rebuilds the FK-era table, no-ops when healed', () => {
  let d = fresh()
  // regress mail to the shape live dbs shipped with (FK on target_eid)
  d.exec('drop table mail')
  d.exec(`create table mail (
    eid        text primary key references entity(eid),
    "to"       text not null,
    "from"     text,
    target_eid text references entity(eid),
    acted_at   text,
    error      text,
    to_addr    text,
    message_id text, received_at text, verified integer)`)
  // open() appends the post-FK-era columns (addCol) BEFORE mendMail runs,
  // so the stale table always matches the rebuild ddl's shipping order.
  d.exec('alter table mail add column reply_to_eid text')
  d.exec('alter table mail add column sent_id text')
  d.exec('alter table mail add column read_at text')
  d.exec('alter table mail add column in_reply_to text')
  let t = uid(), m = uid()
  apply(d, [
    { eid: t, name: 'doc', comp: { title: 'subject' } },
    { eid: m, name: 'mail', comp: { to: 'jeff', target_eid: t } },
  ])
  assertThrows(() => apply(d, [{ eid: t, name: 'entity', comp: null }])) // the bug
  mendMail(d)
  apply(d, [{ eid: t, name: 'entity', comp: null }]) // healed
  let row = () => d.prepare('select target_eid from mail where eid = ?').get(m)
  assertEquals(row(), { target_eid: t }) // rows copied whole, ref kept
  let ddl = () =>
    d.prepare(`select sql from sqlite_master where name = 'mail'`).get()
  let healed = ddl()
  mendMail(d) // already-fixed db: a no-op
  assertEquals(ddl(), healed)
  assertEquals(row(), { target_eid: t })
})

// Every soft-detach rides the RETURN — a cache that misses one keeps a
// ghost (a lease with no holder, a task homed to a gone project) until
// reload. Casualties are excluded: their entity-null says everything.
Deno.test('death broadcasts its soft-detaches: no ghost claims', async () => {
  let { trace } = await import('./effects.ts')
  let s = uid(), t = uid(), p = uid(), t2 = uid(), who = uid(), t3 = uid()
  apply(db, [
    { eid: s, name: 'session', comp: { id: 'sess-ghost' } },
    { eid: t, name: 'doc', comp: { title: 'leased' } },
    { eid: t, name: 'claim', comp: { session_eid: s } },
    { eid: p, name: 'doc', comp: { title: 'home' } },
    { eid: p, name: 'project', comp: {} },
    { eid: t2, name: 'doc', comp: { title: 'homed' } },
    { eid: t2, name: 'task', comp: { status: 'open', project_eid: p } },
    { eid: who, name: 'doc', comp: { title: 'holder' } },
    { eid: who, name: 'person', comp: {} },
    { eid: t3, name: 'doc', comp: { title: 'plated' } },
    { eid: t3, name: 'task', comp: { status: 'open', assignee_eid: who } },
  ])
  // dead session: the freed lease rides the return AND the Trace
  let tr = trace()
  let out = apply(db, [{ eid: s, name: 'entity', comp: null }], tr)
  assertEquals(
    out.some((c) => c.eid == t && c.name == 'claim' && c.comp == null),
    true,
  )
  assertEquals(tr.removed.get(t)?.includes('claim'), true)
  // dead project: the surviving task's detach is a patch on the wire
  out = apply(db, [{ eid: p, name: 'entity', comp: null }])
  assertEquals(
    out.some((c) =>
      c.eid == t2 && c.name == 'task' && c.comp?.project_eid === null
    ),
    true,
  )
  // dead assignee: same
  out = apply(db, [{ eid: who, name: 'entity', comp: null }])
  assertEquals(
    out.some((c) =>
      c.eid == t3 && c.name == 'task' && c.comp?.assignee_eid === null
    ),
    true,
  )
})

Deno.test('assignee: whose plate round-trips, a dead assignee detaches', () => {
  let who = uid(), t = uid()
  apply(db, [
    { eid: who, name: 'doc', comp: { title: 'Jeff' } },
    { eid: who, name: 'person', comp: {} },
    { eid: t, name: 'doc', comp: { title: 'chore' } },
    { eid: t, name: 'task', comp: { status: 'open', assignee_eid: who } },
  ])
  assertEquals(comp(t, 'task')?.assignee_eid, who)
  // the person dies; the task stays, unassigned — soft ref, never cascade
  apply(db, [{ eid: who, name: 'entity', comp: null }])
  assertEquals(comp(t, 'task')?.assignee_eid, null)
  assertEquals(comp(t, 'doc')?.title, 'chore')
})

Deno.test('actor: instruments say who they act for; a dead actor detaches both', () => {
  let jeff = uid(), c = uid(), s = uid()
  apply(db, [
    { eid: jeff, name: 'doc', comp: { title: 'Jeff' } },
    { eid: jeff, name: 'person', comp: {} },
    { eid: c, name: 'client', comp: { user_agent: 'probe', actor_eid: jeff } },
    { eid: s, name: 'session', comp: { id: 'sess-for', actor_eid: jeff } },
  ])
  assertEquals(comp(c, 'client')?.actor_eid, jeff)
  assertEquals(comp(s, 'session')?.actor_eid, jeff)
  // the actor dies; instruments survive unattributed, and the wire hears it
  let out = apply(db, [{ eid: jeff, name: 'entity', comp: null }])
  assertEquals(
    out.some((x) =>
      x.eid == c && x.name == 'client' && x.comp?.actor_eid === null
    ),
    true,
  )
  assertEquals(
    out.some((x) =>
      x.eid == s && x.name == 'session' && x.comp?.actor_eid === null
    ),
    true,
  )
  assertEquals(comp(c, 'client')?.actor_eid, null)
  assertEquals(comp(s, 'session')?.actor_eid, null)
})

// The death words made real by derivation (types.ts deaths → db.ts):
// what a session was started on lets go when the task or persona dies —
// the T-3685 gap, closed by declaring the words.
Deno.test('detach: a dead task or persona lets its sessions go', () => {
  let task = uid(), muse = uid(), s = uid()
  apply(db, [
    { eid: task, name: 'doc', comp: { title: 'requested' } },
    { eid: task, name: 'task', comp: { status: 'open' } },
    { eid: muse, name: 'doc', comp: { title: 'muse' } },
    {
      eid: s,
      name: 'session',
      comp: { id: `dw-${s}`, requested_task_eid: task, persona_eid: muse },
    },
  ])
  let out = apply(db, [{ eid: task, name: 'entity', comp: null }])
  assertEquals(comp(s, 'session')?.requested_task_eid, null)
  // and the wire hears the release — no ghost provenance in any cache
  assertEquals(
    out.some((x) =>
      x.eid == s && x.name == 'session' && x.comp?.requested_task_eid === null
    ),
    true,
  )
  apply(db, [{ eid: muse, name: 'entity', comp: null }])
  assertEquals(comp(s, 'session')?.persona_eid, null)
  assertEquals(comp(s, 'spawn')?.persona_eid, null)
})

Deno.test('keep: a session remembers the role it served after deletion', () => {
  let role = uid(), s = uid()
  apply(db, [
    {
      eid: role,
      name: 'role',
      comp: { state: 'running', surface: 'managed' },
    },
    {
      eid: s,
      name: 'session',
      comp: { id: `role-history-${s}`, role_eid: role },
    },
  ])
  apply(db, [{ eid: role, name: 'entity', comp: null }])
  assertEquals(comp(s, 'session')?.role_eid, role)
})

Deno.test('release: a dead client sheds its shelf, the canvas survives', () => {
  let c = uid(), canvas = uid()
  apply(db, [
    { eid: c, name: 'client', comp: { user_agent: 'probe' } },
    { eid: canvas, name: 'canvas', comp: {} },
    { eid: canvas, name: 'shelf', comp: { client_eid: c } },
  ])
  let out = apply(db, [{ eid: c, name: 'entity', comp: null }])
  assertEquals(comp(canvas, 'shelf'), undefined) // the binding was the client's
  assertEquals(comp(canvas, 'canvas') != null, true) // the contents aren't
  assertEquals(
    out.some((x) => x.eid == canvas && x.name == 'shelf' && x.comp == null),
    true,
  )
})

Deno.test('keep: a dead instrument leaves the provenance standing', () => {
  let who = uid(), target = uid(), c = uid()
  apply(db, [
    { eid: target, name: 'doc', comp: { title: 'subject' } },
    { eid: who, name: 'session', comp: { id: `bye-${who}` } },
  ])
  apply(
    db,
    [
      { eid: c, name: 'doc', comp: { title: '', body: 'said once' } },
      { eid: c, name: 'comment', comp: { target_eid: target } },
    ],
    undefined,
    who,
  )
  apply(db, [{ eid: who, name: 'entity', comp: null }])
  // history, not a dangle: the words stay attributed to the dead session
  assertEquals(comp(c, 'created')?.via, who)
  assertEquals(comp(c, 'doc')?.body, 'said once')
})

Deno.test('vocabulary doc: alias-keyed, regenerated in place, never duplicated', () => {
  vocabularyDoc(db, '# v1')
  let vocab = () =>
    snapshot(db).changes.filter((x) =>
      x.name == 'alias' && x.comp?.slug == 'vocabulary'
    )
  assertEquals(vocab().length, 1)
  let eid = vocab()[0].eid
  assertEquals(comp(eid, 'doc')?.body, '# v1')
  let n = journalOf(db, eid).length
  vocabularyDoc(db, '# v1') // same body: a no-op, nothing journaled
  assertEquals(journalOf(db, eid).length, n)
  vocabularyDoc(db, '# v2') // new body: same entity, rewritten
  assertEquals(vocab().length, 1)
  assertEquals(vocab()[0].eid, eid)
  assertEquals(comp(eid, 'doc')?.body, '# v2')
})

Deno.test('edges: link once, unlink by the same sentence', () => {
  let p = uid(), c = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'epic' } },
    { eid: c, name: 'doc', comp: { title: 'step' } },
    { eid: p, name: 'dependency', comp: { type: 'contains', child_eid: c } },
    { eid: p, name: 'dependency', comp: { type: 'contains', child_eid: c } },
  ])
  let edges = () =>
    snapshot(db).deps.filter((d) => d.parent == p && d.child == c)
  assertEquals(edges(), [{ parent: p, type: 'contains', child: c }]) // once
  apply(db, [{
    eid: p,
    name: 'dependency',
    comp: { type: 'contains', child_eid: c, gone: true },
  }])
  assertEquals(edges(), [])
})

// Every verb in the vocabulary must clear the table's baked check — the
// 'about' verb once shipped in types.ts alone and every about edge
// bounced off the constraint silently.
Deno.test('edges: every vocabulary verb round-trips', async () => {
  let { edges } = await import('./types.ts')
  for (let type of edges) {
    let p = uid(), c = uid()
    apply(db, [
      { eid: p, name: 'doc', comp: { title: `parent ${type}` } },
      { eid: c, name: 'doc', comp: { title: `child ${type}` } },
      { eid: p, name: 'dependency', comp: { type, child_eid: c } },
    ])
    assertEquals(
      snapshot(db).deps.filter((d) => d.parent == p),
      [{ parent: p, type, child: c }],
    )
  }
})

Deno.test('edges: a bad type rejects its batch; a missing endpoint drops', () => {
  let p = uid(), c = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'solid' } },
    { eid: c, name: 'doc', comp: { title: 'other' } },
  ])
  assertThrows(
    () =>
      apply(db, [
        { eid: p, name: 'dependency', comp: { type: 'blocks', child_eid: c } },
        { eid: p, name: 'doc', comp: { body: 'rolled back' } },
      ]),
    Error,
    'dependency.type is one of',
  )
  assertEquals(comp(p, 'doc')?.body, '')
  apply(db, [
    { eid: p, name: 'dependency', comp: { type: 'reads', child_eid: uid() } },
    { eid: p, name: 'doc', comp: { body: 'survives' } }, // batch lives on
  ])
  assertEquals(snapshot(db).deps.some((d) => d.parent == p), false)
  assertEquals(comp(p, 'doc')?.body, 'survives')
})

Deno.test('edges: a dead endpoint voids the link; delete prunes edges', () => {
  let p = uid(), c = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'parent' } },
    { eid: c, name: 'doc', comp: { title: 'child' } },
    { eid: p, name: 'dependency', comp: { type: 'requires', child_eid: c } },
  ])
  apply(db, [{ eid: c, name: 'entity', comp: null }])
  assertEquals(snapshot(db).deps.some((d) => d.parent == p), false) // pruned
  apply(db, [
    { eid: p, name: 'dependency', comp: { type: 'requires', child_eid: c } },
  ])
  assertEquals(snapshot(db).deps.some((d) => d.parent == p), false) // voided
})

Deno.test('open() is idempotent and additive on live files', () => {
  assertMatch(String(fresh().prepare('select 1 as ok').get()?.ok), /1/)
})

Deno.test('open heals canonical stored values once and preserves failures', () => {
  let root = Deno.makeTempDirSync({ prefix: 'tasks-heal-' })
  let path = `${root}/tasks.db`
  let legacy = open(path)
  let project = uid(), task = uid(), bad = uid(), session = uid()
  apply(legacy, [
    { eid: project, name: 'project', comp: {} },
    {
      eid: task,
      name: 'task',
      comp: { status: 'open', priority: 2, project_eid: project },
    },
    { eid: bad, name: 'task', comp: { status: 'open' } },
    {
      eid: session,
      name: 'session',
      comp: { id: 'legacy-session', operator: 1 },
    },
  ])
  legacy.prepare(`update session set pid = '' where eid = ?`).run(session)
  legacy.prepare(`update created set at = ? where eid = ?`)
    .run('2026-07-26T12:34:56Z', task)
  legacy.prepare(`update task set status = 'gone' where eid = ?`).run(bad)
  legacy.prepare(`update project set retired_at = 'never' where eid = ?`)
    .run(project)
  let stable = legacy.prepare(
    `select quote(status) as status, typeof(status) as status_type,
            quote(priority) as priority, typeof(priority) as priority_type,
            quote(project_eid) as project_eid,
            typeof(project_eid) as project_eid_type
     from task where eid = ?`,
  ).get(task)
  legacy.close()

  let warnings: string[] = []
  let warn = console.warn
  console.warn = (...parts) => warnings.push(parts.join(' '))
  try {
    let first = open(path)
    assertEquals(
      first.prepare('select pid, operator from session where eid = ?')
        .get(session),
      { pid: null, operator: 1 },
    )
    assertEquals(
      first.prepare(
        'select at from created where eid = ?',
      ).get(task),
      { at: '2026-07-26T12:34:56.000Z' },
    )
    assertEquals(
      first.prepare(
        `select quote(status) as status, typeof(status) as status_type,
                quote(priority) as priority,
                typeof(priority) as priority_type,
                quote(project_eid) as project_eid,
                typeof(project_eid) as project_eid_type
         from task where eid = ?`,
      ).get(task),
      stable,
    )
    assertEquals(
      first.prepare('select status from task where eid = ?').get(bad),
      { status: 'gone' },
    )
    assertEquals(
      first.prepare('select retired_at from project where eid = ?')
        .get(project),
      { retired_at: 'never' },
    )
    first.close()

    let before = Deno.readFileSync(path)
    let second = open(path)
    assertEquals(
      second.prepare(
        `select status, priority, project_eid from task where eid = ?`,
      ).get(task),
      { status: 'open', priority: 2, project_eid: project },
    )
    second.close()
    assertEquals(Deno.readFileSync(path), before)
  } finally {
    console.warn = warn
    Deno.removeSync(root, { recursive: true })
  }
  assertEquals(
    warnings.filter((w) =>
      w.includes(`${bad} task.status is one of open, wip, done`)
    ).length,
    2,
  )
  assertEquals(
    warnings.filter((w) => w.includes(`${project} retired_at is a time`))
      .length,
    2,
  )
})

Deno.test('search: terms and filters mix in one line', () => {
  let a = uid(), b = uid()
  apply(db, [
    { eid: a, name: 'doc', comp: { title: 'Quokka feeding run' } },
    { eid: a, name: 'task', comp: { status: 'done' } },
    { eid: b, name: 'doc', comp: { title: 'Quokka photo shoot' } },
    { eid: b, name: 'task', comp: { status: 'open' } },
  ])
  let eids = (q: string) => search(db, q).map((h) => h.eid)
  assertEquals(eids('quokka').length, 2)
  assertEquals(eids('quokka .status=done'), [a])
  assertEquals(eids('quokka .status=open .created.at=today'), [b])
  assertEquals(eids('quokka .created.at=yesterday'), [])
  // filters alone are a listing, newest touched first
  assertEquals(eids('.status=done .created.at>=today').includes(a), true)
  assertEquals(eids('.status=done .created.at>=today').includes(b), false)
})

Deno.test('search: reference sugar + paths screen the hits', () => {
  let u = uid(), t = uid(), t2 = uid()
  apply(db, [
    { eid: u, name: 'doc', comp: { title: 'Jeff Peterson' } },
    { eid: u, name: 'person', comp: {} },
    { eid: u, name: 'alias', comp: { slug: 'jeffp' } },
    { eid: t, name: 'doc', comp: { title: 'Wurlitzer tuning' } },
    { eid: t, name: 'task', comp: { status: 'open', assignee_eid: u } },
    { eid: t2, name: 'doc', comp: { title: 'Wurlitzer restringing' } },
    { eid: t2, name: 'task', comp: { status: 'open' } },
  ])
  let eids = (q: string) => search(db, q).map((h) => h.eid)
  // the value resolves server-side: alias slug or human num, like find()
  assertEquals(eids('wurlitzer .assignee=jeffp'), [t])
  let num = comp(u, 'entity')?.num
  assertEquals(eids(`wurlitzer .assignee=U-${num}`), [t])
  assertEquals(eids('wurlitzer .assignee=ghost'), []) // a miss matches nothing
  // a path pred walks the reference into the assignee's doc
  assertEquals(eids('wurlitzer .assignee.title~=peterson'), [t])
  assertEquals(eids('wurlitzer .assignee.title~=nobody'), [])
  // filters alone still list — sugar included
  assertEquals(eids('.assignee=jeffp'), [t])
})

// ---- memory + recall: the decay model's storage half ----

Deno.test('memory: scope rides in, provenance and confirmation are stamped', () => {
  let m = uid(), s = uid(), p = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'a venture' } },
    { eid: p, name: 'project', comp: {} },
  ])
  apply(
    db,
    [
      { eid: s, name: 'session', comp: { id: `sess-${s}` } },
      { eid: m, name: 'doc', comp: { title: 'zebu index line', body: 'fact' } },
      {
        eid: m,
        name: 'memory',
        comp: {
          type: 'feedback',
          source_eid: s,
          scope_eid: p,
          last_confirmed_at: 'FAKE',
        },
      },
    ],
    undefined,
    `sess-${s}`,
  )
  let row = comp(m, 'memory')
  assertEquals(row?.type, 'feedback')
  assertEquals(row?.scope_eid, p)
  assertEquals(row?.last_confirmed_at, null) // server-owned
  assertEquals(
    (db.prepare('select source_eid from memory where eid = ?').get(m) as {
      source_eid: string | null
    }).source_eid,
    null,
  ) // retired: the wire cannot write the dormant source
  assertEquals(
    snapshot(db).changes.find((c) => c.eid == m && c.name == 'created')
      ?.comp?.via,
    s,
  )
  assertEquals(search(db, 'zebu')[0]?.kind, 'memory') // memory names it
})

Deno.test('recall never rides the wire; touch() is the one writer', () => {
  let m = uid()
  apply(db, [{ eid: m, name: 'doc', comp: { title: 'warm' } }])
  // a forged create drops (nothing writable, not-nulls refuse the touch)
  apply(db, [
    {
      eid: m,
      name: 'recall',
      comp: { count: 99, first_at: 'x', last_at: 'y' },
    },
  ])
  assertEquals(comp(m, 'recall'), undefined)
  let [first] = touch(db, [m])
  assertEquals(comp(m, 'recall')?.count, 1)
  touch(db, [m])
  let r = comp(m, 'recall')
  assertEquals(r?.count, 2)
  assertEquals(r?.first_at, first.comp?.first_at) // first_at never moves
  apply(db, [{ eid: m, name: 'recall', comp: { count: 99 } }]) // forged patch
  assertEquals(comp(m, 'recall')?.count, 2)
})

Deno.test('touch confirm stamps the memory; death takes the recall row', () => {
  let m = uid()
  apply(db, [
    { eid: m, name: 'doc', comp: { title: 'confirmable' } },
    { eid: m, name: 'memory', comp: { type: 'user' } },
  ])
  let out = touch(db, [m], true)
  assertEquals(out.map((c) => c.name), ['recall', 'memory'])
  assertMatch(String(comp(m, 'memory')?.last_confirmed_at), /^\d{4}-/)
  apply(db, [{ eid: m, name: 'entity', comp: null }])
  assertEquals(comp(m, 'recall'), undefined)
  assertEquals(touch(db, [m]), []) // tombstoned: no spine, no touch
})

// ---- the journal: the wire's record ----

let journalCount = () =>
  (db.prepare('select count(*) as n from journal').get() as { n: number }).n

Deno.test('journal: one row per batch, resolved to the writing actor; a rollback leaves none', () => {
  // The door names a writer (a session id); the journal keeps the ACTOR it
  // resolves to — never the raw label it used to store (T-6669).
  let who = uid(), s = uid(), t = uid()
  apply(db, [
    { eid: who, name: 'doc', comp: { title: 'operator' } },
    { eid: who, name: 'project', comp: {} },
    { eid: s, name: 'session', comp: { id: `jw-${s}`, actor_eid: who } },
  ])
  let before = journalCount()
  apply(
    db,
    [{ eid: t, name: 'doc', comp: { title: 'recorded' } }],
    undefined,
    `jw-${s}`,
  )
  assertEquals(journalCount(), before + 1)
  let row = db.prepare('select actor, batch from journal order by rowid desc')
    .get() as { actor: string; batch: string }
  assertEquals(row.actor, who) // the writer's session resolved to its actor
  assertMatch(row.batch, /recorded/) // the batch as applied, spine included
  // A bounced claim rolls the whole batch back — no journal row either
  // (the conflict audit is its own transaction and deliberately unjournaled).
  let s1 = uid(), s2 = uid()
  apply(db, [
    { eid: s1, name: 'session', comp: { id: `s1-${s1}` } },
    { eid: s2, name: 'session', comp: { id: `s2-${s2}` } },
    { eid: t, name: 'claim', comp: { session_eid: s1 } },
  ])
  let held = journalCount()
  assertThrows(() =>
    apply(db, [{ eid: t, name: 'claim', comp: { session_eid: s2 } }])
  )
  assertEquals(journalCount(), held)
})

Deno.test('journalBy: cuts the ledger by session, not its resolved actor', () => {
  let actor = uid(), one = uid(), two = uid(), first = uid(), second = uid()
  apply(db, [
    { eid: actor, name: 'person', comp: {} },
    { eid: one, name: 'session', comp: { id: `one-${one}`, actor_eid: actor } },
    { eid: two, name: 'session', comp: { id: `two-${two}`, actor_eid: actor } },
  ])
  apply(
    db,
    [{ eid: first, name: 'doc', comp: { title: 'first session' } }],
    undefined,
    `one-${one}`,
  )
  apply(
    db,
    [{ eid: second, name: 'doc', comp: { title: 'second session' } }],
    undefined,
    `two-${two}`,
  )
  let rows = journalBy(db, one)
  assertEquals(rows.length, 1)
  assertEquals(rows[0].actor, actor)
  assertEquals(rows[0].via, one)
  assertEquals(rows[0].changes[0].eid, first)
})

Deno.test('actor fill: a session that ran in a repo resolves to its venture', () => {
  // Shore up actors (T-6669): a session with a cwd but no actor gets one
  // from where it stands — cwd → repo → project — server-side, so the
  // writing identity is never blank however the session was reified. The
  // fill rides the return so caches hear it.
  let proj = uid(), s = uid()
  apply(db, [
    { eid: proj, name: 'doc', comp: { title: 'Venture' } },
    { eid: proj, name: 'project', comp: {} },
    { eid: proj, name: 'repo', comp: { path: '/srv/venture-abc' } },
  ])
  let out = apply(db, [
    {
      eid: s,
      name: 'session',
      comp: { id: `v-${s}`, cwd: '/srv/venture-abc/wt/a' },
    },
  ])
  assertEquals(comp(s, 'session')?.actor_eid, proj) // stamped from cwd → repo
  assertEquals(
    out.some((x) =>
      x.eid == s && x.name == 'session' && x.comp?.actor_eid == proj
    ),
    true,
  )
  // Wire-writable: a session that NAMES its actor keeps it, no override.
  let s2 = uid(), who = uid()
  apply(db, [{ eid: who, name: 'doc', comp: { title: 'chosen' } }, {
    eid: who,
    name: 'project',
    comp: {},
  }])
  apply(db, [{
    eid: s2,
    name: 'session',
    comp: { id: `v2-${s2}`, cwd: '/srv/venture-abc/wt/b', actor_eid: who },
  }])
  assertEquals(comp(s2, 'session')?.actor_eid, who) // named actor untouched
})

Deno.test('actor fill: a linked worktree resolves through its main repo', () => {
  let root = Deno.makeTempDirSync({ prefix: 'tasks-worktree-' })
  try {
    let repo = `${root}/venture`
    let tree = `${root}/detached/tree`
    Deno.mkdirSync(`${repo}/.git/worktrees/tree`, { recursive: true })
    Deno.mkdirSync(`${tree}/deep`, { recursive: true })
    Deno.writeTextFileSync(
      `${tree}/.git`,
      `gitdir: ${repo}/.git/worktrees/tree\n`,
    )
    let proj = uid(), s = uid(), comment = uid()
    let sid = `wt-${s}`
    apply(db, [
      { eid: proj, name: 'project', comp: {} },
      { eid: proj, name: 'repo', comp: { path: repo } },
      {
        eid: s,
        name: 'session',
        comp: { id: sid, cwd: `${tree}/deep`, origin: 'external' },
      },
    ])
    assertEquals(comp(s, 'session')?.actor_eid, proj)
    apply(
      db,
      [{ eid: comment, name: 'doc', comp: { title: '', body: 'agent word' } }],
      undefined,
      sid,
    )
    assertEquals(comp(comment, 'created')?.by, proj)
  } finally {
    Deno.removeSync(root, { recursive: true })
  }
})

Deno.test('journal: cascade casualties ride the record', () => {
  let a = uid(), c = uid()
  apply(db, [
    { eid: a, name: 'doc', comp: { title: 'doomed' } },
    { eid: c, name: 'doc', comp: { title: '' } },
    { eid: c, name: 'comment', comp: { target_eid: a } },
  ])
  apply(db, [{ eid: a, name: 'entity', comp: null }])
  let last = JSON.parse(
    (db.prepare('select batch from journal order by rowid desc').get() as {
      batch: string
    }).batch,
  ) as { eid: string; name: string; comp: unknown }[]
  assertEquals(
    last.some((x) => x.eid == c && x.name == 'entity' && x.comp == null),
    true,
  )
})

Deno.test('a change and its commentary land in one atomic batch', () => {
  let t = uid(), s = uid(), c = uid()
  apply(db, [
    { eid: s, name: 'session', comp: { id: `talker-${s}` } },
    { eid: t, name: 'doc', comp: { title: 'commented' } },
    { eid: t, name: 'task', comp: { status: 'open' } },
  ])
  // the v1 gap, closed: status move + plain comment, same transaction
  apply(
    db,
    [
      { eid: t, name: 'task', comp: { status: 'done' } },
      { eid: c, name: 'doc', comp: { title: '', body: 'proof landed' } },
      { eid: c, name: 'comment', comp: { target_eid: t } },
    ],
    undefined,
    s,
  )
  assertEquals(comp(t, 'task')?.status, 'done')
  assertEquals(comp(c, 'doc')?.body, 'proof landed')
  assertEquals(comp(c, 'created')?.via, s)
  // the old journal pseudo-change is dead vocabulary: it mints nothing
  let before = db.prepare('select count(*) n from comment').get() as {
    n: number
  }
  apply(db, [{ eid: t, name: 'journal', comp: { reason: 'ghost' } }])
  let after = db.prepare('select count(*) n from comment').get() as {
    n: number
  }
  assertEquals(after.n, before.n)
})

Deno.test('journal: recording failure never breaks the write', () => {
  db.exec('alter table journal rename to journal_hidden')
  let t = uid()
  try {
    apply(db, [{ eid: t, name: 'doc', comp: { title: 'still lands' } }])
  } finally {
    db.exec('alter table journal_hidden rename to journal')
  }
  assertEquals(comp(t, 'doc')?.title, 'still lands')
})

Deno.test('journalOf: newest first, cut to the eid', () => {
  let t = uid(), other = uid()
  apply(db, [
    { eid: t, name: 'doc', comp: { title: 'v1' } },
    { eid: other, name: 'doc', comp: { title: 'noise' } },
  ])
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'v2' } }])
  let past = journalOf(db, t)
  assertEquals(past.length, 2)
  assertEquals(past[0].changes, [{
    eid: t,
    name: 'doc',
    comp: { title: 'v2' },
  }])
  assertEquals(past.every((e) => e.changes.every((c) => c.eid == t)), true)
})

Deno.test('num is monotonic: a grave keeps its number off the market', () => {
  let a = uid(), b = uid()
  apply(db, [{ eid: a, name: 'doc', comp: { title: 'first' } }])
  apply(db, [{ eid: b, name: 'doc', comp: { title: 'last' } }])
  let num = (eid: string) =>
    (db.prepare('select num from entity where eid = ?').get(eid) as {
      num: number
    })?.num
  let high = num(b)
  apply(db, [{ eid: b, name: 'entity', comp: null }])
  let c = uid()
  apply(db, [{ eid: c, name: 'doc', comp: { title: 'after the grave' } }])
  assertEquals(num(c) > high, true)
  // and the tombstone remembers who it buried
  let grave = db.prepare('select num from tombstone where eid = ?').get(b) as {
    num: number
  }
  assertEquals(grave.num, high)
})

Deno.test('search: retired-project hits sink to the tail, flagged', () => {
  let p = uid(), sunk = uid(), live = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'Quagga venture' } },
    { eid: p, name: 'project', comp: { retired_at: '2026-07-21' } },
    { eid: sunk, name: 'doc', comp: { title: 'Quagga sunk chore' } },
    { eid: sunk, name: 'task', comp: { status: 'open', project_eid: p } },
    { eid: live, name: 'doc', comp: { title: 'Quagga live chore' } },
    { eid: live, name: 'task', comp: { status: 'open' } },
  ])
  let hits = search(db, 'quagga')
  assertEquals(hits[0].eid, live) // the only live hit leads
  assertEquals(hits[0].retired, undefined)
  // the retired project and its task queue behind, each flagged
  assertEquals(hits.slice(1).map((h) => h.retired), [true, true])
  assertEquals(new Set(hits.slice(1).map((h) => h.eid)), new Set([p, sunk]))
  // unretiring floats them back
  apply(db, [{ eid: p, name: 'project', comp: { retired_at: null } }])
  assertEquals(search(db, 'quagga').every((h) => !h.retired), true)
})

// Land changes into a plain {cache, deps} the same way live.ts applyLocal
// does — column-merge, comp:null drops the component, entity:null drops the
// entity and every edge touching it, dependency names its whole triple. A
// local twin (not the signal-backed applyLocal, which needs the browser) so
// the delta round-trip can assert on the net cache + deps.
type Wire = { eid: string; name: string; comp: Record<string, unknown> | null }
type Bag = {
  cache: Record<string, Record<string, Record<string, unknown>>>
  deps: { parent: string; type: string; child: string }[]
}
let land = (b: Bag, changes: Wire[]) => {
  for (let { eid, name, comp } of changes) {
    if (name == 'entity' && comp == null) {
      delete b.cache[eid]
      b.deps = b.deps.filter((d) => d.parent != eid && d.child != eid)
      continue
    }
    if (name == 'dependency') {
      if (!comp) continue
      let d = {
        parent: eid,
        type: String(comp.type),
        child: String(comp.child_eid),
      }
      let same = (x: typeof d) =>
        x.parent == d.parent && x.type == d.type && x.child == d.child
      b.deps = comp.gone
        ? b.deps.filter((x) => !same(x))
        : b.deps.some(same)
        ? b.deps
        : [...b.deps, d]
      continue
    }
    let row = b.cache[eid] ?? (b.cache[eid] = {})
    if (comp == null) delete row[name]
    else row[name] = { ...(row[name] ?? {}), ...comp }
  }
}
let fromSnap = (s: ReturnType<typeof snapshot>): Bag => {
  let b: Bag = { cache: {}, deps: s.deps.map((d) => ({ ...d })) }
  land(b, s.changes)
  return b
}
// The two paths emit deps in different orders.
let calm = (b: Bag) => {
  let deps = [...b.deps].sort((x, y) =>
    JSON.stringify(x).localeCompare(JSON.stringify(y))
  )
  return { cache: b.cache, deps }
}

Deno.test('delta: snapshot@C0 + delta(C0) matches the live broadcast stream, cascade and all', () => {
  let c0 = snapshot(db).cursor ?? 0
  let base = snapshot(db) // the whole graph at C0

  // A scripted sequence past C0 that ends in a CASCADING delete: a task, a
  // comment aimed at it, a claim on it, a `requires` edge into it — then the
  // task dies, tombstoning the comment + claim and dropping the edge.
  let t = uid(), other = uid(), cm = uid(), s = uid()
  let script = [
    [
      { eid: t, name: 'doc', comp: { title: 'doomed', body: 'v1' } },
      { eid: t, name: 'task', comp: { status: 'open' } },
    ],
    [{ eid: s, name: 'session', comp: { id: `d-${s}` } }],
    [
      { eid: cm, name: 'doc', comp: { title: '', body: 're: doomed' } },
      { eid: cm, name: 'comment', comp: { target_eid: t } },
    ],
    [{ eid: t, name: 'claim', comp: { session_eid: s } }],
    [
      { eid: other, name: 'doc', comp: { title: 'blocker' } },
      { eid: other, name: 'task', comp: { status: 'open' } },
      {
        eid: other,
        name: 'dependency',
        comp: { type: 'requires', child_eid: t },
      },
    ],
    [{ eid: t, name: 'doc', comp: { title: 'doomed', body: 'v2 edit' } }],
    [{ eid: other, name: 'task', comp: { status: 'wip' } }], // survivor re-touched
    [{ eid: t, name: 'entity', comp: null }], // cascade
  ] as Wire[][]

  // A live client's cache = snapshot@C0, then each batch's RETURN landed as
  // /ws broadcasts it (apply() returns [...changes, ...extra] — the tombstones
  // and provenance stamps included). This is the reference delta must match: a
  // returning delta client IS a catching-up live client, and the journal is
  // exactly what those broadcasts carried.
  let live: Bag = { cache: {}, deps: base.deps.map((x) => ({ ...x })) }
  land(live, base.changes)
  for (let batch of script) land(live, apply(db, batch))

  let full = snapshot(db) // the authoritative graph at Cn
  let d = delta(db, c0)

  // Reconstruct from the delta: hydrate the C0 snapshot, then replay the
  // delta stream (deps ride in it as dependency changes — no separate deps
  // array, unlike /snapshot).
  let recon: Bag = { cache: {}, deps: base.deps.map((x) => ({ ...x })) }
  land(recon, base.changes)
  land(recon, d.changes)

  // Equality here proves BOTH cascade fidelity (every tombstone, detach and
  // birth carried) AND exact provenance (created/updated carry the same stamp
  // and author) in one shot.
  assertEquals(d.cursor, full.cursor) // the window ends where the graph is
  assertEquals(calm(recon), calm(live))

  // And it agrees with the authoritative snapshot on population and edges —
  // the parts a full-row snapshot and a patch stream share (snapshot fills
  // schema-default columns a patch omits, so only entity-set + deps compare).
  assertEquals(
    new Set(Object.keys(recon.cache)),
    new Set(Object.keys(fromSnap(full).cache)),
  )
  assertEquals(calm(recon).deps, calm(fromSnap(full)).deps)

  // The cascade genuinely happened: the doomed task, its comment and claim
  // are gone, and the edge into it with them.
  assertEquals(full.changes.some((c) => c.eid == t), false)
  assertEquals(full.changes.some((c) => c.eid == cm), false)
  assertEquals(recon.cache[t], undefined)
  assertEquals(recon.cache[cm], undefined)
  assertEquals(recon.deps.some((x) => x.child == t || x.parent == t), false)
  // and the survivor carries re-derived provenance: created at birth, plus an
  // updated (it was re-touched after birth) — both synthesized from the
  // journal, absent from it.
  assertEquals(typeof recon.cache[other].created?.at, 'string')
  assertEquals(typeof recon.cache[other].updated?.at, 'string')
})

Deno.test('a signature never falls back the way provenance does', () => {
  // A db with exactly ONE person: that person IS the box owner, which is
  // when the fallback in writerActor has something to return.
  let path = Deno.makeTempFileSync({ prefix: 'tasks-signer-', suffix: '.db' })
  let d = open(path)
  let owner = uid()
  apply(d, [
    { eid: owner, name: 'doc', comp: { title: 'the owner' } },
    { eid: owner, name: 'person', comp: {} },
    { eid: owner, name: 'email', comp: { address: 'owner@yak.test' } },
  ])

  // Provenance guesses, and should: an unattributed write is still theirs.
  assertEquals(writerActor(d, null), owner)
  // A signature refuses to. Otherwise any unattributed POST to the local
  // /apply sends mail as the owner — the fleet's highest-trust byline.
  assertEquals(senderActor(d, null), null)
  assertEquals(senderActor(d, 'nobody-by-that-name'), null)
  assertEquals(senderActor(d, owner), owner) // named outright, it stands

  let m = uid()
  apply(d, [
    { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
    { eid: m, name: 'mail', comp: { to: 'x@y.test' } },
  ])
  let signed = d.prepare('select "from" as f from mail where eid = ?')
    .get(m) as { f: string | null }
  assertEquals(signed.f, null) // unsigned, so mail.ts will refuse to send it
  d.close()
  Deno.removeSync(path)
})

// Unwritable and unreadable are different words. A signature the wire
// cannot forge must still be one the wire can SEE — a letter whose sender
// no client can read is a letter nobody can answer (`reply` aims at it).
Deno.test('the sender rides graph-out, unforgeable but readable', () => {
  let who = uid(), m = uid()
  apply(db, [
    { eid: who, name: 'doc', comp: { title: 'a correspondent' } },
    { eid: who, name: 'person', comp: {} },
    { eid: who, name: 'email', comp: { address: 'writer@yak.test' } },
  ])
  // Written AS that actor, and claiming someone else's name on the way.
  apply(
    db,
    [
      { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
      { eid: m, name: 'mail', comp: { to: 'x@y.test', from: 'someone@else' } },
    ],
    undefined,
    who,
  )

  let sent = snapshot(db).changes.find((c) => c.eid == m && c.name == 'mail')
  assertEquals(sent?.comp?.from, 'writer@yak.test') // seen, not theirs to name
})
