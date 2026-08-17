// apply()/snapshot() semantics against an in-memory db — the wire's
// contract: patches, creates, deletes, tombstones, and the claim lease.
Deno.env.set('DB_PATH', ':memory:')
let {
  apply,
  backfillJournalTouch,
  backfillOpened,
  backfillVia,
  componentCounts,
  db,
  delta,
  eager,
  hasCol,
  healInboundDeliver,
  historicalWorked,
  human,
  journalBy,
  journalOf,
  lastBatch,
  liveDb,
  locate,
  mendCalls,
  mendMail,
  migrateBoardsToProjects,
  migrateErrors,
  numbered,
  open,
  readComp,
  refsOf,
  resolveId,
  retireMemoryType,
  search,
  senderActor,
  sha,
  snapshot,
  Stale,
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
let { comps, kindOrder, lazy, partition, sessionOf, shortId, stamped } =
  await import(
    './types.ts'
  )
let { bareDb } = await import('./testdb.ts')
let { slow } = await import('./testing.ts')

// The apply/snapshot suite just needs a working migrated graph, not a DDL
// replay — and not the demo seed either: `fresh()` hands out an UNSEEDED clone
// so snapshot() walks only the rows a test writes (~0.09ms), not the ~180-row
// seed (~1.9ms) that pushed sub-ms reads over the 1ms budget. (freshDb(), the
// seeded clone, stays in testdb.ts for callers that read the seed; no test here
// needs it.) The open()-idempotency and migration tests below still call open()
// directly, since replaying the DDL is the thing they check.
let fresh = () => bareDb()
let uid = () => crypto.randomUUID()

// Build the migrated snapshot once at load rather than lazily inside whichever
// test clones first — that one-time ~40ms serialize is setup, not the per-test
// work the 1ms budget measures, so it belongs off the test lines.
bareDb()

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

slow('snapshot shares a walk until either database handle writes', () => {
  let path = Deno.makeTempFileSync({ suffix: '.db' })
  let one = open(path)
  let eid = uid()
  apply(one, [{ eid, name: 'doc', comp: { title: 'one', body: '' } }])
  let first = snapshot(one)
  assertEquals(snapshot(one) === first, true)

  one.prepare('update doc set title = ? where eid = ?').run('two', eid)
  let local = snapshot(one)
  assertEquals(local === first, false)
  assertEquals(compOf(one, eid, 'doc')?.title, 'two')

  let two = open(path)
  two.prepare('update doc set title = ? where eid = ?').run('three', eid)
  let remote = snapshot(one)
  assertEquals(remote === local, false)
  assertEquals(compOf(one, eid, 'doc')?.title, 'three')

  two.close()
  one.close()
  Deno.removeSync(path)
})

slow(
  'journal_mode: WAL is gated on TASKS_WAL, off by default (T-13905)',
  () => {
    let path = Deno.makeTempFileSync({ suffix: '.db' })
    let mode = (d: ReturnType<typeof open>) =>
      (d.prepare('pragma journal_mode').get() as { journal_mode: string })
        .journal_mode
    Deno.env.delete('TASKS_WAL')
    try {
      let a = open(path)
      assertEquals(mode(a), 'delete') // default: rollback journal, never flipped
      a.close()
      Deno.env.set('TASKS_WAL', '1')
      let b = open(path)
      assertEquals(mode(b), 'wal') // the gated activation flips the file
      b.close()
      // journal_mode is a persistent header property, so a later DEFAULT open
      // still reads WAL — which is why flipping the live db is owner-windowed.
      Deno.env.delete('TASKS_WAL')
      let c = open(path)
      assertEquals(mode(c), 'wal')
      c.close()
    } finally {
      Deno.env.delete('TASKS_WAL')
      Deno.removeSync(path)
      for (let s of ['-wal', '-shm']) {
        try {
          Deno.removeSync(`${path}${s}`)
        } catch { /* absent when the mode never flipped */ }
      }
    }
  },
)

Deno.test('componentCounts: the graph, not the snapshot the cache mirrors', () => {
  let d = fresh()
  // Entry-partition entities: each carries `entry` (so snapshot omits it) and
  // `recalled` (the census section that undercounted). The browser cache is a
  // mirror of the snapshot, so a presence-tally over it can only ever see the
  // few that leaked in — the exact undercount T-17477 fixes.
  let sess = uid()
  apply(d, [{ eid: sess, name: 'session', comp: { id: uid() } }])
  let n = 2
  for (let i = 0; i < n; i++) {
    let e = uid()
    apply(d, [
      { eid: e, name: 'entry', comp: { session: sess } },
      { eid: e, name: 'recalled', comp: { source: e } },
    ])
  }
  // Graph-true: every row in the component table is counted.
  assertEquals(componentCounts(d).recalled, n)
  assertEquals(componentCounts(d).entry, n)
  // The snapshot deliberately excludes the entry partition, so anything
  // scanning the cache would count 0 recalled — n vs 0 is the lie removed.
  let snap = snapshot(d)
  assertEquals(snap.changes.some((c) => c.name == 'recalled'), false)
  assertEquals(snap.changes.some((c) => c.name == 'entry'), false)
  d.close()
})

Deno.test('partition: only entry is lazy, and snapshot honors the declaration', () => {
  // The one-list drives sync partitioning (types.ts `partition`). entry is the
  // one lazy comp today; wake and task ride the snapshot. This is the guard on
  // the behavior-identical migration (T-18093): flipping wake to lazy is a real
  // change gated on the whole-graph-scan audit (T-18094), never a silent side
  // effect of reading the declaration.
  assertEquals(lazy('entry'), true)
  assertEquals(lazy('wake'), false)
  assertEquals(lazy('task'), false)
  assertEquals(partition.entry, 'lazy')

  let d = fresh()
  let sess = uid()
  apply(d, [{ eid: sess, name: 'session', comp: { id: uid() } }])
  let logged = uid()
  apply(d, [{ eid: logged, name: 'entry', comp: { session: sess } }])
  let woken = uid()
  apply(d, [{
    eid: woken,
    name: 'wake',
    comp: { at: new Date().toISOString() },
  }])

  let snap = snapshot(d)
  // The entry-partition entity is omitted wholesale; the wake entity rides.
  assertEquals(snap.changes.some((c) => c.eid == logged), false)
  assertEquals(
    snap.changes.some((c) => c.eid == woken && c.name == 'wake'),
    true,
  )
  d.close()
})

// A narrow single-entity read (readComp hits the eid index) instead of a full
// snapshot() walk of the seeded graph — same projection, ~µs not ~2ms.
let compOf = (d: ReturnType<typeof open>, eid: string, name: string) =>
  readComp(d, eid, name)
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
  entry = false,
) => ({
  name,
  col,
  target,
  rest: typeof rest == 'function' ? rest : () => rest,
  before,
  entry,
})

let contracts = [
  contract('task', 'project', 'project', { status: 'open' }),
  contract('camera', 'client', 'client', (d) => ({
    canvas: tag(d, 'canvas'),
  })),
  contract('fold', 'client', 'client', (d) => ({
    board: tag(d, 'board'),
  })),
  contract('fold', 'board', 'board', (d) => ({
    client: tag(d, 'client'),
  })),
  contract('shelf', 'client', 'client'),
  contract(
    'claim',
    'session',
    'session',
    {},
    (d, eid) => apply(d, [{ eid, name: 'doc', comp: { title: 'claimed' } }]),
  ),
  contract('stop_request', 'target', 'session'),
  contract('session', 'role', 'role', { id: 'role-session' }),
  contract('session', 'parent', 'session', { id: 'child-session' }),
  contract('entry', 'session', 'session'),
  contract(
    'generation',
    'through',
    'entry',
    { provider: 'codex', model: 'gpt-test' },
    undefined,
    true,
  ),
  contract('output', 'source', 'generation', {}, undefined, true),
  contract('result', 'call', 'call', {}, undefined, true),
  contract('checkpoint', 'through', 'entry', {}, undefined, true),
  contract('recalled', 'source', 'entry', {}, undefined, true),
  contract('mail', 'reply_to', 'mail'),
  contract('persona', 'home', 'project'),
  contract('memory', 'scope', 'project'),
  contract('dream', 'scope', 'project'),
  contract('layout', 'root', 'pane'),
  contract('pane', 'layout', 'layout'),
  contract('pane', 'parent', 'pane'),
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
      project: null,
      assignee: null,
      domain: null,
    },
  ) // the live batch carries the same defaults as a snapshot
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'B' } }])
  assertEquals(comp(t, 'doc')?.title, 'B')
  assertEquals(comp(t, 'doc')?.body, 'b') // patch: untouched column survives
})

Deno.test('doc creates body-first: a missing title defaults to empty (T-10397)', () => {
  // A session brief or comment is body-only; doc.title is NOT NULL with no
  // default, so a body-first create used to raise a raw SQLite constraint.
  let t = uid()
  apply(db, [{ eid: t, name: 'doc', comp: { body: 'brief' } }])
  assertEquals(comp(t, 'doc')?.title, '')
  assertEquals(comp(t, 'doc')?.body, 'brief')
  // A later body-only patch must not clobber a title set in between.
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'Named' } }])
  apply(db, [{ eid: t, name: 'doc', comp: { body: 'more' } }])
  assertEquals(comp(t, 'doc')?.title, 'Named')
  assertEquals(comp(t, 'doc')?.body, 'more')
})

Deno.test('entity delete tombstones; nothing resurrects the eid', () => {
  let t = uid()
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'gone' } }])
  apply(db, [{ eid: t, name: 'entity', comp: null }])
  assertEquals(comp(t, 'doc'), undefined)
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'zombie' } }]) // voided
  assertEquals(comp(t, 'doc'), undefined)
})

Deno.test('server-owned facets: the wire cannot mint or erase them (T-15457)', () => {
  let t = uid()
  apply(db, [{ eid: t, name: 'task', comp: { status: 'open' } }])
  // A bare presence create is dropped, not admitted — no false fleet-health
  // error, no forged delivery receipt. The effective batch omits it too.
  for (let name of ['error', 'delivered', 'exception']) {
    let out = apply(db, [{ eid: t, name, comp: {} }])
    assertEquals(comp(t, name), undefined)
    assertEquals(out.some((c) => c.name == name), false)
  }
  // An effect stamps a real error by DIRECT SQL (deliver.ts's path). The wire
  // then tries to erase the diagnosis with a component-delete — refused, so the
  // stamp stands.
  db.prepare(`insert into error (eid, at, message) values (?, 'now', 'boom')`)
    .run(t)
  let out = apply(db, [{ eid: t, name: 'error', comp: null }])
  assertEquals(comp(t, 'error')?.message, 'boom')
  assertEquals(out.some((c) => c.name == 'error'), false)
})

Deno.test('review: a comment carries one canonical verdict', () => {
  let t = uid(), c = uid()
  apply(db, [
    { eid: t, name: 'doc', comp: { title: 'work' } },
    { eid: c, name: 'doc', comp: { title: '', body: '' } },
    { eid: c, name: 'comment', comp: { target: t } },
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

// refsOf reads each column's PropType, not its name: a reference wearing no
// A reference with any name (deliver.to, created.by, project) is walked, so
// graph-out backlinks can't skip a whole class of edge.
Deno.test('refsOf walks references by type', () => {
  let d = fresh()
  let target = tag(d, 'doc', { title: 'target' })
  let suffixed = uid()
  let bare = uid()
  apply(d, [
    { eid: suffixed, name: 'card', comp: { target: target, view: 'text' } },
    { eid: bare, name: 'deliver', comp: { to: target } },
  ])
  let vias = refsOf(d, [target]).filter((r) => r.to == target)
  assertEquals(
    vias.find((r) => r.via == 'card.target')?.from,
    suffixed,
  )
  assertEquals(vias.find((r) => r.via == 'deliver.to')?.from, bare)
  d.close()
})

Deno.test('graph-out carries declared columns only', () => {
  let d = fresh()
  let eid = uid()
  d.exec('alter table web add column dormant text')
  apply(d, [{ eid, name: 'web', comp: { url: 'https://example.test/' } }])
  d.prepare(
    'update web set frozen_at = ?, dormant = ? where eid = ?',
  ).run('2026-07-26T00:00:00Z', 'migration input', eid)
  let expected = {
    eid,
    url: 'https://example.test/',
    frozen_at: '2026-07-26T00:00:00Z',
  }
  let snap = snapshot(d).changes.find((c) => c.eid == eid && c.name == 'web')
    ?.comp
  assertEquals(snap, expected)
  assertEquals(eager(d, eid).web, expected)
  d.close()
})

// Tables genuinely outside the component vocabulary: they carry no
// eid+components a client cache walks, so snapshot() never selects them and
// the "every stored column is declared" invariant below does not reach them.
// This list IS the contract — an addition to it is a decision, so each entry
// says why it is not a component.
let outsideVocabulary: Record<string, string> = {
  dependency: 'edges: a triple keyed by (parent, type, child), no eid row',
  tombstone: 'death record: the eid is dead, nothing reads a component back',
  journal: 'the write log: append-only audit, never walked by snapshot()',
  journal_touch: "the journal's seek index (jrow, eid): log data, never synced",
  tool_call: 'telemetry: no eid, no components — read at /telemetry',
  embedding: 'semantic vectors: rebuilt from doc on the sweep, never synced',
}
// FTS5 generates a family of shadow tables per index (_data/_idx/_config/
// _docsize); they refill from the doc sync triggers and hold no vocabulary.
let ftsShadow = (t: string) =>
  t.startsWith('doc_fts') || t.startsWith('doc_gram')

// The universal invariant CLAUDE.md names: every stored column is declared in
// comps (wire-writable) or stamped (server-owned read), because snapshot()'s
// readable union is exactly their sum. A column in NEITHER is invisible to
// every client though its type may promise it — the mail.from misrouting, the
// session.input_at hole (T-14205). Derive the check from the LIVE schema so
// the next undeclared column fails the gate here, not silently in production.
Deno.test('every stored column is declared in comps or stamped', () => {
  let d = fresh()
  let tables = (d.prepare(
    `select name from sqlite_master
       where type = 'table' and name not like 'sqlite_%'`,
  ).all() as { name: string }[]).map((r) => r.name)
  let undeclared: string[] = []
  for (let t of tables) {
    if (outsideVocabulary[t] || ftsShadow(t)) continue
    // eid is the universal join key, present on every component table and
    // never in comps/stamped. A table nobody declared and nobody exempted
    // lands here with allow = {eid} alone, so its columns show as drift too —
    // a new table is a decision, same as a new column.
    let allow = new Set(['eid', ...Object.keys({ ...comps[t], ...stamped[t] })])
    let cols = (d.prepare(
      'select name from pragma_table_info(?)',
    ).all(t) as { name: string }[]).map((c) => c.name)
    for (let c of cols) if (!allow.has(c)) undeclared.push(`${t}.${c}`)
  }
  assertEquals(undeclared, [])
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
        assignee: 'typed-target',
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
      name: 'board',
      comp: { query: '.status=open' },
    },
    {
      eid: 'typed-subject',
      name: 'web',
      comp: { url: 'HTTPS://Example.test/p/?utm_source=n#top' },
    },
  ])
  assertEquals(out.slice(0, 4), [
    {
      eid: subject,
      name: 'task',
      comp: {
        status: 'wip',
        priority: 2,
        assignee: target,
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
      name: 'board',
      comp: { query: '.status=open' },
    },
    {
      eid: subject,
      name: 'web',
      comp: { url: 'https://example.test/p' },
    },
  ])
  assertEquals(comp(subject, 'task')?.priority, 2)
  assertEquals(comp(subject, 'session')?.operator, 1)
  let logged = (db.prepare(
    'select batch from journal order by rowid desc',
  ).get() as { batch: string }).batch
  assertEquals(logged.includes('P02'), false)

  let num = Number(comp(target, 'entity')?.num)
  let [edge] = apply(db, [{
    eid: 'typed-subject',
    name: 'dependency',
    comp: { type: 'ABOUT', child: String(num), gone: 'no' },
  }])
  assertEquals(edge, {
    eid: subject,
    name: 'dependency',
    comp: { type: 'about', child: target, gone: 0 },
  })
})

Deno.test('alias: every slug resolves, one primary, each globally unique', () => {
  let a = uid(), b = uid()
  apply(db, [
    { eid: a, name: 'doc', comp: { title: 'Alpha' } },
    { eid: a, name: 'alias', comp: { slug: 'home', slugs: 'tasks graph' } },
    { eid: b, name: 'doc', comp: { title: 'Beta' } },
  ])
  // Primary and every additional name resolve to the same entity.
  assertEquals(resolveId(db, 'home'), a)
  assertEquals(resolveId(db, 'tasks'), a)
  assertEquals(resolveId(db, 'graph'), a)
  // Whole-token membership: a substring of a member never hits.
  assertEquals(resolveId(db, 'task'), undefined)
  // Display stays the primary — never ambiguous.
  assertEquals(comp(a, 'alias')?.slug, 'home')

  // A second entity cannot claim a taken member, whether it lands as another's
  // primary or additional name — the write-time uniqueness generalization.
  assertThrows(
    () => apply(db, [{ eid: b, name: 'alias', comp: { slug: 'tasks' } }]),
    Error,
    'already names',
  )
  assertThrows(
    () =>
      apply(db, [
        { eid: b, name: 'alias', comp: { slug: 'beta', slugs: 'graph' } },
      ]),
    Error,
    'already names',
  )
  // A set that repeats a member is refused before it can shadow itself.
  assertThrows(
    () =>
      apply(db, [
        { eid: b, name: 'alias', comp: { slug: 'beta', slugs: 'beta' } },
      ]),
    Error,
    'listed twice',
  )
  // Free names land; a patch touching only `slugs` keeps the stored primary
  // and its own members stay valid on a re-apply (self is excluded).
  apply(db, [{ eid: b, name: 'alias', comp: { slug: 'beta' } }])
  apply(db, [{ eid: b, name: 'alias', comp: { slugs: 'second' } }])
  assertEquals(comp(b, 'alias')?.slug, 'beta')
  assertEquals(resolveId(db, 'second'), b)
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
    comp: { url: 'http://x/', frozen_at: 'FAKE' },
  }])
  assertEquals(comp(t, 'web')?.frozen_at, null)
  let expected = { url: 'http://x/' }
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
    {
      eid: p,
      name: 'repo',
      comp: {
        path: '/tmp/x',
        url: 'https://github.com/acme/x',
        base_branch: 'trunk',
        gate: 'deno task gate',
      },
    },
  ])
  assertEquals(comp(p, 'repo')?.path, '/tmp/x')
  assertEquals(comp(p, 'repo')?.url, 'https://github.com/acme/x')
  assertEquals(comp(p, 'repo')?.base_branch, 'trunk')
  assertEquals(comp(p, 'repo')?.gate, 'deno task gate')
  assertEquals(search(db, 'venture')[0]?.kind, 'project') // repo doesn't name it
})

Deno.test('shelf tags a canvas to a client; rides the snapshot', () => {
  let c = uid(), canvas = uid()
  apply(db, [
    { eid: c, name: 'client', comp: { user_agent: 'x' } },
    { eid: canvas, name: 'canvas', comp: {} },
    { eid: canvas, name: 'shelf', comp: { client: c } },
  ])
  assertEquals(comp(canvas, 'shelf')?.client, c)
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
  // input_at is a lifecycle peer of stop_requested_at: the wire cannot set it,
  // but once the server stamps it (a steer yielding a managed turn) it rides
  // graph-out so a client can see the session is yielding (T-14205).
  assertEquals(comp(s, 'session')?.input_at, null) // rides out, wire left it unset
  db.prepare('update session set input_at = ? where eid = ?')
    .run('2026-08-06T00:00:00Z', s)
  assertEquals(comp(s, 'session')?.input_at, '2026-08-06T00:00:00Z')
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

Deno.test('graph-native entries advance session.latest_seq', () => {
  let s = uid()
  apply(db, [{ eid: s, name: 'session', comp: { id: 'seq-native' } }])
  assertEquals(comp(s, 'session')?.latest_seq, 0) // no entries: no lie
  let entry = () =>
    apply(db, [{ eid: uid(), name: 'entry', comp: { session: s } }])
  entry()
  assertEquals(comp(s, 'session')?.latest_seq, 1) // tracks the top entry seq
  entry()
  entry()
  assertEquals(comp(s, 'session')?.latest_seq, 3)
  // A different session's entries never touch this summary.
  let other = uid()
  apply(db, [{ eid: other, name: 'session', comp: { id: 'seq-other' } }])
  apply(db, [{ eid: uid(), name: 'entry', comp: { session: other } }])
  assertEquals(comp(other, 'session')?.latest_seq, 1)
  assertEquals(comp(s, 'session')?.latest_seq, 3)
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
      persona: persona,
    },
  }])
  let spec = {
    provider: 'fake',
    model: 'fake-fast',
    effort: 'low',
    persona: persona,
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
        requested_task: task,
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
  assertEquals(compOf(d, s, 'session')?.requested_task, task)
  assertEquals(
    out.filter((c) => c.eid == s && c.name == 'session').length,
    1,
  )
})

Deno.test('session execution facets dual-materialize in both directions', () => {
  let d = fresh()
  let legacy = uid(), canonical = uid()
  apply(d, [{
    eid: legacy,
    name: 'session',
    comp: {
      id: uid(),
      cwd: '/legacy',
      pid: 17,
      pane: '%17',
      transcript: '/tmp/legacy.jsonl',
    },
  }])
  assertEquals(compOf(d, legacy, 'worktree')?.cwd, '/legacy')
  assertEquals(compOf(d, legacy, 'runtime')?.pid, 17)
  assertEquals(compOf(d, legacy, 'runtime')?.pane, '%17')
  assertEquals(
    compOf(d, legacy, 'runtime')?.transcript,
    '/tmp/legacy.jsonl',
  )

  apply(d, [
    { eid: canonical, name: 'session', comp: { id: uid() } },
    { eid: canonical, name: 'worktree', comp: { cwd: '/canonical' } },
    {
      eid: canonical,
      name: 'runtime',
      comp: { pid: 23, pane: '%23', transcript: '/tmp/canonical.jsonl' },
    },
  ])
  assertEquals(compOf(d, canonical, 'session')?.cwd, '/canonical')
  assertEquals(compOf(d, canonical, 'session')?.pid, 23)
  assertEquals(compOf(d, canonical, 'session')?.pane, '%23')
  assertEquals(
    compOf(d, canonical, 'session')?.transcript,
    '/tmp/canonical.jsonl',
  )
})

Deno.test('canonical null wins either session-facet batch order', () => {
  let d = fresh()
  for (let canonicalFirst of [false, true]) {
    let eid = uid()
    apply(d, [{
      eid,
      name: 'session',
      comp: { id: uid(), cwd: '/old', pid: 7 },
    }])
    let legacy = {
      eid,
      name: 'session',
      comp: { cwd: '/stale', pid: 9 },
    }
    let canonical = [
      { eid, name: 'worktree', comp: { cwd: null } },
      { eid, name: 'runtime', comp: { pid: null } },
    ]
    apply(
      d,
      (canonicalFirst
        ? [...canonical, legacy]
        : [legacy, ...canonical]) as import('./types.ts').Change[],
    )
    let parts = Object.fromEntries(
      ['session', 'spawn', 'worktree', 'runtime'].flatMap((name) => {
        let comp = compOf(d, eid, name)
        return comp ? [[name, comp]] : []
      }),
    )
    assertEquals(compOf(d, eid, 'worktree')?.cwd, null)
    assertEquals(compOf(d, eid, 'runtime')?.pid, null)
    assertEquals(compOf(d, eid, 'session')?.cwd, null)
    assertEquals(compOf(d, eid, 'session')?.pid, null)
    assertEquals(sessionOf(parts)?.cwd, null)
    assertEquals(sessionOf(parts)?.pid, null)
  }
})

Deno.test('work type and execution model remain independent', () => {
  let d = fresh()
  let coding = uid(), chat = uid()
  apply(d, [
    { eid: coding, name: 'session', comp: { id: uid() } },
    { eid: coding, name: 'worktree', comp: { cwd: '/code' } },
    { eid: chat, name: 'session', comp: { id: uid() } },
  ])
  assertEquals(compOf(d, coding, 'worktree')?.cwd, '/code')
  assertEquals(compOf(d, coding, 'runtime'), undefined)
  assertEquals(compOf(d, chat, 'worktree'), undefined)
  assertEquals(compOf(d, chat, 'runtime'), undefined)
})

Deno.test('spawn refuses an undecided proposal and allows an atomic decision', () => {
  let d = fresh()
  let task = uid(), refused = uid(), accepted = uid()
  apply(d, [
    { eid: task, name: 'doc', comp: { title: 'fleet idea' } },
    { eid: task, name: 'task', comp: { status: 'open' } },
    { eid: task, name: 'proposed', comp: {} },
  ])
  let id = human(d, task)
  assertThrows(
    () =>
      apply(d, [{
        eid: refused,
        name: 'session',
        comp: { id: uid(), requested_task: task },
      }]),
    Error,
    `${id} is proposed but not decided — accept it with ` +
      `task set ${id} .decided.at=now .decided.by=U-3709`,
  )
  assertEquals(compOf(d, refused, 'session'), undefined)
  assertEquals(compOf(d, refused, 'spawn'), undefined)

  apply(d, [
    { eid: task, name: 'decided', comp: {} },
    {
      eid: accepted,
      name: 'session',
      comp: { id: uid(), requested_task: task },
    },
  ])
  assertEquals(compOf(d, accepted, 'session')?.requested_task, task)
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
          comp: { status: 'open', project: ghost },
        },
      ]),
    Error,
    'project',
  )
  assertEquals(compOf(d, s, 'spawn')?.model, 'fake-fast')
  assertEquals(compOf(d, s, 'session')?.model, 'fake-fast')
  assertEquals(compOf(d, s, 'session')?.cwd, null)
  assertEquals(compOf(d, s, 'spawn')?.persona, null)
  assertEquals(compOf(d, s, 'session')?.persona, null)
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
  assertEquals(snap.capabilities, ['spawn', 'session-facets'])
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
    { eid: task, name: 'claim', comp: { session: a } },
  ])
  assertThrows(
    () => apply(db, [{ eid: task, name: 'claim', comp: { session: b } }]),
    Error,
    'already claimed by sess-a',
  )
  // the bounce left an audit row naming both sides
  let audit = snapshot(db).changes.filter((c) =>
    c.name == 'conflict' && c.comp?.target == task
  )
  assertEquals(audit.length, 1)
  assertEquals(audit[0].comp?.loser, 'sess-b')
  assertEquals(audit[0].comp?.holder, 'sess-a')
  // same session again: no-op, no throw, no extra audit
  apply(db, [{ eid: task, name: 'claim', comp: { session: a } }])
  // release, then the other side may take it
  apply(db, [{ eid: task, name: 'claim', comp: null }])
  apply(db, [{ eid: task, name: 'claim', comp: { session: b } }])
  assertEquals(comp(task, 'claim')?.session, b)
})

Deno.test('a claim implies wip: open→wip, done stays, wip unchanged', () => {
  let s = uid()
  let todo = uid(), done = uid(), busy = uid()
  apply(db, [
    { eid: s, name: 'session', comp: { id: 'sess-c' } },
    { eid: todo, name: 'task', comp: { status: 'open' } },
    { eid: done, name: 'task', comp: { status: 'done' } },
    { eid: busy, name: 'task', comp: { status: 'wip' } },
  ])
  // claiming an open task drags it to wip in the same batch, and the wire
  // hears the status move as a synthesized task change
  let out = apply(db, [{ eid: todo, name: 'claim', comp: { session: s } }])
  assertEquals(comp(todo, 'task')?.status, 'wip')
  assertEquals(
    out.some((c) =>
      c.eid == todo && c.name == 'task' && c.comp?.status == 'wip'
    ),
    true,
  )
  // a stray claim never reopens a closed task
  apply(db, [{ eid: done, name: 'claim', comp: { session: s } }])
  assertEquals(comp(done, 'task')?.status, 'done')
  // an already-wip task is untouched (no spurious status write)
  let busyOut = apply(db, [{ eid: busy, name: 'claim', comp: { session: s } }])
  assertEquals(comp(busy, 'task')?.status, 'wip')
  assertEquals(
    busyOut.some((c) => c.eid == busy && c.name == 'task'),
    false,
  )
})

Deno.test('claim release pushes the actor stack; reclaim and settle pop it', () => {
  let actor = uid(), session = uid(), a = uid(), b = uid(), c = uid()
  apply(db, [
    { eid: actor, name: 'person', comp: {} },
    {
      eid: session,
      name: 'session',
      comp: { id: `resume-${session}`, actor },
    },
    ...[a, b, c].map((eid) => ({
      eid,
      name: 'task',
      comp: { status: 'wip' },
    })),
  ])
  for (let eid of [a, b, c]) {
    apply(db, [{ eid, name: 'claim', comp: { session } }])
  }
  let out = apply(
    db,
    [a, b, c].map((eid) => ({
      eid,
      name: 'claim',
      comp: null,
    })),
  )
  let pushed = out.filter((x) => x.name == 'resume')
  assertEquals(pushed.map((x) => x.eid), [a, b, c])
  assertEquals(pushed.every((x) => x.comp?.actor == actor), true)
  assertEquals(
    pushed.map((x) => Number(x.comp?.rank)).toSorted((x, y) => x - y),
    pushed.map((x) => Number(x.comp?.rank)),
  )

  let take = apply(db, [{ eid: c, name: 'claim', comp: { session } }])
  assertEquals(
    take.some((x) => x.eid == c && x.name == 'resume' && x.comp == null),
    true,
  )
  apply(db, [{ eid: b, name: 'task', comp: { status: 'done' } }])
  assertEquals(comp(b, 'resume'), undefined)
  assertEquals(comp(a, 'resume')?.actor, actor)

  // The stack is a server outcome, never a client assertion.
  apply(db, [{ eid: a, name: 'resume', comp: { actor, rank: 999 } }])
  assertNotEquals(comp(a, 'resume')?.rank, 999)
})

Deno.test('a failing claim voids its whole batch', () => {
  let task = uid(), a = uid(), c = uid()
  apply(db, [
    { eid: task, name: 'doc', comp: { title: 'atomic' } },
    { eid: a, name: 'session', comp: { id: 'sess-atomic' } },
    { eid: task, name: 'claim', comp: { session: a } },
  ])
  assertThrows(() =>
    apply(db, [
      { eid: c, name: 'doc', comp: { title: 'rides along' } },
      { eid: task, name: 'claim', comp: { session: uid() } },
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
        { eid: s, name: 'session', comp: { id: 'sess-fk', actor: ghost } },
      ]),
    Error,
    'actor',
  )
  assertMatch(err.message, /no such entity/)
  assertEquals(comp(s, 'session'), undefined) // the row never landed
  assertEquals(comp(s, 'entity'), undefined) // no zombie spine either
  assertEquals(comp(rider, 'doc'), undefined) // the whole batch rolled back
})

Deno.test('task project requires a project and fails atomically', () => {
  let bare = uid(), task = uid(), rider = uid()
  apply(db, [{ eid: bare, name: 'doc', comp: { title: 'not a project' } }])
  let err = assertThrows(
    () =>
      apply(db, [
        { eid: rider, name: 'doc', comp: { title: 'rides along' } },
        {
          eid: task,
          name: 'task',
          comp: { status: 'open', project: bare },
        },
      ]),
    Error,
    'refused',
  )
  // Outputs speak human (T-10277): the refusal names ids the caller can
  // paste, never the uuids it never typed. The task's own id is only a
  // shape here — its spine died with the rollback that built the message.
  assertMatch(err.message, /^task T-\d+ refused: /)
  assertMatch(
    err.message,
    new RegExp(`project → D-${comp(bare, 'entity')?.num} \\(no such`),
  )
  assertEquals(comp(task, 'entity'), undefined)
  assertEquals(comp(rider, 'doc'), undefined)

  let project = uid(), existing = uid(), patchRider = uid()
  apply(db, [
    { eid: project, name: 'project', comp: {} },
    {
      eid: existing,
      name: 'task',
      comp: { status: 'open', project: project },
    },
  ])
  assertThrows(() =>
    apply(db, [
      { eid: patchRider, name: 'doc', comp: { title: 'also rides' } },
      { eid: existing, name: 'task', comp: { project: bare } },
    ])
  )
  assertEquals(comp(existing, 'task')?.project, project)
  assertEquals(comp(patchRider, 'doc'), undefined)

  let ghost = uid()
  assertThrows(
    () =>
      apply(db, [{
        eid: uid(),
        name: 'task',
        comp: { status: 'open', project: ghost },
      }]),
    Error,
    'project',
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

Deno.test('task project accepts projects created anywhere in its batch', () => {
  let before = uid(), after = uid(), a = uid(), b = uid()
  apply(db, [
    { eid: before, name: 'project', comp: {} },
    {
      eid: a,
      name: 'task',
      comp: { status: 'open', project: before },
    },
  ])
  apply(db, [
    {
      eid: b,
      name: 'task',
      comp: { status: 'open', project: after },
    },
    { eid: after, name: 'project', comp: {} },
  ])
  assertEquals(comp(a, 'task')?.project, before)
  assertEquals(comp(b, 'task')?.project, after)
})

Deno.test('typed eid contracts are the complete vocabulary set', () => {
  // Kind-constrained refs only — an any-entity ref (target 'entity') is not
  // an apply-time contract, so it stays out, exactly as the empty sentinel did.
  let declared = Object.entries(comps).flatMap(([name, props]) =>
    Object.entries(props).flatMap(([col, type]) =>
      typeof type == 'object' && 'eid' in type && type.eid != 'entity'
        ? [`${name}.${col}:${type.eid}`]
        : []
    )
  ).sort()
  assertEquals(
    declared,
    contracts.map((c) => `${c.name}.${c.col}:${c.target}`).sort(),
  )
})

slow('every typed eid rejects a target missing its component', () => {
  for (let c of contracts) {
    let local = fresh()
    let wrong = tag(local, 'doc', { title: 'wrong kind' })
    let source = uid()
    c.before?.(local, source)
    let changes = [{
      eid: source,
      name: c.name,
      comp: { ...c.rest(local), [c.col]: wrong },
    }]
    if (c.entry) {
      let sid = tag(local, 'session', { id: uid() })
      changes.unshift({ eid: source, name: 'entry', comp: { session: sid } })
    }
    let err = assertThrows(
      () => apply(local, changes),
      Error,
      c.name == 'stop_request' ? 'gone' : c.col,
    )
    if (c.name != 'stop_request') {
      assertMatch(err.message, new RegExp(`no such ${c.target}`))
    }
    assertEquals(readComp(local, source, c.name), undefined)
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
      comp: { scope: project },
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
    comp: { status: 'open', project: project },
  }])
  assertThrows(
    () =>
      apply(local, [
        { eid: rider, name: 'doc', comp: { title: 'rides along' } },
        { eid: project, name: 'project', comp: null },
      ]),
    Error,
    'project',
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
        { eid: c, name: 'comment', comp: { target: uid() } },
      ]),
    Error,
    'target',
  )
  assertEquals(comp(c, 'doc'), undefined)
})

Deno.test('one batch creates referent then referrer: both land', () => {
  let who = uid(), s = uid()
  apply(db, [
    { eid: who, name: 'doc', comp: { title: 'an actor' } },
    { eid: s, name: 'session', comp: { id: 'sess-pair', actor: who } },
  ])
  assertEquals(comp(s, 'session')?.actor, who)
})

Deno.test('a tombstoned referent refuses and says so', () => {
  let t = uid(), s = uid()
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'brief' } }])
  apply(db, [{ eid: t, name: 'entity', comp: null }])
  assertThrows(
    () =>
      apply(db, [
        { eid: s, name: 'session', comp: { id: 'sess-grave', actor: t } },
      ]),
    Error,
    'tombstoned',
  )
})

Deno.test('an FK refusal on the patch path bounces too', () => {
  let s = uid()
  apply(db, [{ eid: s, name: 'session', comp: { id: 'sess-patch' } }])
  assertThrows(
    () => apply(db, [{ eid: s, name: 'session', comp: { actor: uid() } }]),
    Error,
    'actor',
  )
  assertEquals(comp(s, 'session')?.actor, null) // untouched
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

Deno.test('provenance: created.by is the writer actor; the wire overrides', () => {
  // A fresh :memory: graph so the lone person IS the box owner — the only
  // condition under which a fallback would have had anything to return.
  let d = fresh()
  let at = (eid: string, name: string) => readComp(d, eid, name)
  let jeff = uid(), amy = uid()
  apply(d, [
    { eid: jeff, name: 'person', comp: {} },
    { eid: amy, name: 'doc', comp: { title: 'Amy' } },
  ])
  // no writer named → nobody authored it. Not the box owner: this is the
  // shape every server-minted entity has, and borrowing his name for it put
  // 608 machine writes in his hand (T-9934).
  let t = uid()
  apply(d, [{ eid: t, name: 'doc', comp: { title: 'filed' } }])
  assertEquals(at(t, 'created')?.by, null)
  // named writer → that actor authors
  let w = uid()
  apply(
    d,
    [{ eid: w, name: 'doc', comp: { title: 'filed by hand' } }],
    undefined,
    jeff,
  )
  assertEquals(at(w, 'created')?.by, jeff)
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
      comp: { id: sid, actor: actor },
    },
  ])
  let stamp = (eid: string) => readComp(d, eid, 'created')
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
  let stamp = (eid: string, name: string) => readComp(d, eid, name)
  let jeff = uid(), client = uid()
  apply(d, [
    { eid: jeff, name: 'person', comp: {} },
    { eid: client, name: 'client', comp: { actor: jeff } },
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

  let q = uid()
  apply(d, [{ eid: q, name: 'doc', comp: { title: 'unsafe' } }])
  apply(d, [{ eid: q, name: 'quarantined', comp: {} }], undefined, client)
  assertMatch(String(stamp(q, 'quarantined')?.at), /^\d{4}-/)
  assertEquals(stamp(q, 'quarantined')?.by, jeff)
  assertEquals(stamp(q, 'quarantined')?.via, client)

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

slow(
  'lifecycle stamps: one-list — snapshot, showMd, and GRAMMAR pick them up with no extra edits',
  async () => {
    let { rows, showMd } = await import('./client.ts')
    let { GRAMMAR } = await import('./grammar.ts')
    let d = fresh()
    let jeff = uid()
    apply(d, [{ eid: jeff, name: 'person', comp: {} }])
    let t = uid()
    // Named writer: a stamp's `by` is whoever DID it, and nothing fills that
    // in for an anonymous write any more (T-9934).
    apply(
      d,
      [{ eid: t, name: 'doc', comp: { title: 'a letter' } }],
      undefined,
      jeff,
    )
    apply(d, [{ eid: t, name: 'opened', comp: {} }], undefined, jeff)
    let snap = snapshot(d)
    // cache shape: snapshot carries the tag comp with its stamped at
    let carried = snap.changes.find((c) => c.eid == t && c.name == 'opened')
    assertEquals(typeof carried?.comp?.at, 'string')
    // showMd: the stamped outcome renders, derived from comps + stamped
    let all = rows(snap)
    let row = all.find((r) => r.eid == t)!
    assertMatch(showMd(snap, all, row), /opened\.by: /)
    // MCP/CLI grammar teaches each as a tag comp
    for (let n of ['notified', 'opened', 'archived', 'quarantined']) {
      assertMatch(GRAMMAR, new RegExp(`${n}: \\(tag\\)`))
    }
    // The stampedPresence derive is {at,by}-shaped ONLY: `conflict` is also an
    // empty wire comp with a stamped `at`, but it has no `by` column and is a
    // server-minted audit — a bare wire write of it must drop quietly, NOT
    // reach the by-fill loop and throw "no such column: by" on the live entity.
    apply(d, [{ eid: t, name: 'conflict', comp: {} }]) // dropped, no throw
    assertEquals(
      snapshot(d).changes.find((c) => c.name == 'conflict'),
      undefined,
    )
  },
)

// `decided` is the stamp family's odd member: `at` and `by` ride the WIRE
// (a decision is written up after it was taken), `via` stays server-only.
// Everything else — the by-default, the insert-only stamp, the echo on the
// return — is the same loop the notification stamps ride.
Deno.test('decided: the wire dates and signs it, the server names the instrument', () => {
  let d = fresh()
  let stamp = (eid: string) => readComp(d, eid, 'decided')
  let jeff = uid(), amy = uid(), client = uid()
  apply(d, [
    { eid: jeff, name: 'person', comp: {} },
    { eid: amy, name: 'person', comp: {} },
    { eid: client, name: 'client', comp: { actor: jeff } },
  ])
  // A TASK wears it: the stamp is a facet, not a memory column.
  let t = uid()
  apply(d, [
    { eid: t, name: 'doc', comp: { title: 'ship the thing' } },
    { eid: t, name: 'task', comp: { status: 'done' } },
  ])
  let out = apply(
    d,
    [{ eid: t, name: 'decided', comp: { at: '2026-04-02T00:00:00.000Z' } }],
    undefined,
    client,
  )
  // The BACKDATE survives: stored as sent, not rewritten to now — which is
  // the entire reason `at` is wire-writable.
  assertEquals(stamp(t)?.at, '2026-04-02T00:00:00.000Z')
  assertEquals(stamp(t)?.by, jeff) // the gap, filled with the writing actor
  assertEquals(stamp(t)?.via, client) // its instrument, server-stamped
  let rode = out.findLast((c) => c.eid == t && c.name == 'decided')
  assertEquals(rode?.comp?.at, '2026-04-02T00:00:00.000Z')
  assertEquals(rode?.comp?.by, jeff)

  // A wire-named decider is KEPT (created.by's rule), and `via` is refused
  // whatever the wire says — that is what keeps the instrument unspoofable
  // even when the date is asserted.
  let m = uid()
  apply(d, [
    { eid: m, name: 'doc', comp: { title: 'we bill quarterly' } },
    { eid: m, name: 'memory', comp: {} },
  ])
  apply(
    d,
    [{
      eid: m,
      name: 'decided',
      comp: { at: '2026-01-09T12:00:00.000Z', by: amy, via: 'FORGED' },
    }],
    undefined,
    client,
  )
  assertEquals(stamp(m)?.by, amy)
  assertEquals(stamp(m)?.via, client)

  // Bare {}: the column default dates it now, so the cheap spelling works.
  let u = uid()
  apply(d, [{ eid: u, name: 'doc', comp: { title: 'settled today' } }])
  apply(d, [{ eid: u, name: 'decided', comp: {} }], undefined, client)
  assertMatch(String(stamp(u)?.at), /^\d{4}-/)
  assertEquals(stamp(u)?.by, jeff)

  // A time PHRASE is resolved once at the door (normalizeChanges), so no row
  // ever holds one — and correcting the date later moves `at` alone: who
  // wrote the decision down does not change because its date did.
  apply(d, [{ eid: t, name: 'decided', comp: { at: '2026-03-01' } }])
  assertMatch(String(stamp(t)?.at), /^2026-03-01T/)
  assertEquals(stamp(t)?.by, jeff)
  assertEquals(stamp(t)?.via, client)
})

Deno.test('proposed: any entity wears the authored, server-signed stamp', () => {
  let d = fresh()
  let proposer = uid(), client = uid(), subject = uid()
  apply(d, [
    { eid: proposer, name: 'person', comp: {} },
    { eid: client, name: 'client', comp: { actor: proposer } },
    { eid: subject, name: 'doc', comp: { title: 'an idea' } },
  ])
  let out = apply(
    d,
    [{
      eid: subject,
      name: 'proposed',
      comp: { at: '2026-08-01T12:00:00.000Z', via: 'FORGED' },
    }],
    undefined,
    client,
  )
  let stamp = compOf(d, subject, 'proposed')
  assertEquals(stamp?.at, '2026-08-01T12:00:00.000Z')
  assertEquals(stamp?.by, proposer)
  assertEquals(stamp?.via, client)
  assertEquals(
    out.findLast((c) => c.eid == subject && c.name == 'proposed')?.comp,
    stamp,
  )
})

// memory.type → the `feedback` tag (T-12585). Only `feedback` becomes a row:
// `project` said what scope says, `reference` was the absence of anything
// else, and `user` was worn by nothing. The source is NOT inferred —
// created.by names the recorder, and 81 of the live graph's 87 feedback rows
// were recorded by a venture rather than a person.
slow('retireMemoryType: feedback becomes a tag, the column goes', () => {
  let d = fresh()
  let mk = (title: string) => {
    let eid = uid()
    apply(d, [
      { eid, name: 'doc', comp: { title } },
      { eid, name: 'memory', comp: {} },
    ])
    return eid
  }
  let says = mk('a correction'), holds = mk('a fact'), points = mk('a pointer')
  // The pre-migration shape: the enum column, still carrying all of it.
  d.exec(`alter table memory add column type text not null default 'project'`)
  let typed = d.prepare('update memory set type = ? where eid = ?')
  typed.run('feedback', says)
  typed.run('project', holds)
  typed.run('reference', points)
  let tagged = () =>
    (d.prepare('select eid from feedback').all() as { eid: string }[])
      .map((r) => r.eid)

  retireMemoryType(d)
  assertEquals(tagged(), [says]) // one value carried a fact; three did not
  assertEquals(
    d.prepare('select "by" from feedback where eid = ?').get(says),
    { by: null }, // never inferred from created.by
  )
  assertEquals(hasCol(d, 'memory', 'type'), false) // the drop makes it true
  // Every row still exists — the retirement moves a fact, it never sheds one.
  assertEquals(d.prepare('select count(*) as n from memory').get(), { n: 3 })
  // Idempotent: a second boot has no column left to read and does nothing.
  retireMemoryType(d)
  assertEquals(tagged(), [says])
})

// The read→opened migration (T-7006): the backfill seeds `opened` from
// every already-read letter, so no mail flickers unread when the readers
// flip to NOT opened. Insert-or-ignore on the pk makes it a no-op on
// re-boot. A fresh graph has no read_at at all, so the pre-migration
// column is planted here — that IS the only shape the backfill is for.
slow('backfill: mail.read_at seeds opened, idempotently', () => {
  let d = fresh()
  let m = uid()
  apply(d, [
    { eid: m, name: 'doc', comp: { title: 'old letter' } },
    { eid: m, name: 'mail', comp: {} },
    { eid: m, name: 'deliver', comp: { to: 'jeff@x.test' } },
  ])
  d.exec('alter table mail add column read_at text')
  d.prepare('update mail set read_at = ? where eid = ?')
    .run('2026-07-01T00:00:00Z', m)
  let openedAt = () =>
    (d.prepare('select at from opened where eid = ?').get(m) as
      | { at: string }
      | undefined)?.at
  assertEquals(openedAt(), undefined) // the legacy column alone stamps nothing
  backfillOpened(d)
  assertEquals(openedAt(), '2026-07-01T00:00:00Z')
  // idempotent: a re-run never moves an existing stamp
  d.prepare('update opened set at = ? where eid = ?').run('MOVED', m)
  backfillOpened(d)
  assertEquals(openedAt(), 'MOVED')
  // and once the column is dropped the pass is a quiet no-op, not a crash
  d.exec('alter table mail drop column read_at')
  backfillOpened(d)
  assertEquals(openedAt(), 'MOVED')
})

slow('migrateErrors: carries every diagnosis, verifies, then contracts', () => {
  let d = fresh()
  let role = uid(), session = uid()
  apply(d, [
    { eid: role, name: 'role', comp: { state: 'held' } },
    { eid: session, name: 'session', comp: { id: uid() } },
  ])
  d.exec('alter table role add column error text')
  d.exec('alter table session add column error text')
  let finished = '2026-08-07T12:00:00Z'
  d.prepare('update role set error = ? where eid = ?').run('bad role', role)
  d.prepare(
    `update session set status = 'failed', finished_at = ?, error = ?
     where eid = ?`,
  ).run(finished, 'bad session', session)

  migrateErrors(d)
  assertEquals(
    d.prepare('select at, message from error where eid = ?').get(role),
    { at: null, message: 'bad role' },
  )
  assertEquals(
    d.prepare('select at, message from error where eid = ?').get(session),
    { at: finished, message: 'bad session' },
  )
  assertEquals(hasCol(d, 'role', 'error'), false)
  assertEquals(hasCol(d, 'session', 'error'), false)
  migrateErrors(d) // a contracted graph is already done
})

slow('open backfills every pre-spawn session, once', () => {
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
  d.prepare(
    "update spawn set provider = null, model = 'canonical' where eid = ?",
  ).run(legacy)
  d.close()

  d = open(path)
  assertEquals(compOf(d, legacy, 'spawn')?.model, 'canonical')
  assertEquals(compOf(d, legacy, 'session')?.provider, null)
  assertEquals(compOf(d, legacy, 'session')?.model, 'canonical')
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

slow('open backfills optional session facets without reviving nulls', () => {
  let path = Deno.makeTempFileSync({
    prefix: 'tasks-session-facets-',
    suffix: '.db',
  })
  let legacy = uid(), canonical = uid()
  let d = open(path)
  apply(d, [
    { eid: legacy, name: 'session', comp: { id: uid() } },
    { eid: canonical, name: 'session', comp: { id: uid() } },
  ])
  d.exec('drop table worktree')
  d.exec('drop table runtime')
  d.prepare(`
    update session set cwd = '/old', branch = 'session/old',
      base_revision = 'abc', pid = 17, pane = '%17',
      transcript = '/tmp/old.jsonl', provider_session_id = 'thread-old',
      serving_model = 'model-old' where eid = ?
  `).run(legacy)
  d.close()

  d = open(path)
  assertEquals(d.prepare('select * from worktree where eid = ?').get(legacy), {
    eid: legacy,
    cwd: '/old',
    branch: 'session/old',
    base_revision: 'abc',
  })
  assertEquals(d.prepare('select * from runtime where eid = ?').get(legacy), {
    eid: legacy,
    pid: 17,
    pane: '%17',
    transcript: '/tmp/old.jsonl',
    provider_session_id: 'thread-old',
    serving_model: 'model-old',
  })
  d.prepare(
    `insert into worktree (eid, cwd, branch, base_revision)
     values (?, null, null, null)`,
  ).run(canonical)
  d.prepare("update session set cwd = '/stale' where eid = ?").run(canonical)
  d.close()

  d = open(path)
  assertEquals(compOf(d, canonical, 'worktree')?.cwd, null)
  assertEquals(compOf(d, canonical, 'session')?.cwd, null)
  d.close()
  Deno.removeSync(path)
})

slow('open drops a retired acked_at, and keeps the session', () => {
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

slow('backfill: comment instruments move into created.via', () => {
  let d = fresh()
  let target = uid(), author = uid(), comment = uid()
  apply(d, [
    { eid: target, name: 'doc', comp: { title: 'target' } },
    { eid: author, name: 'session', comp: { id: uid() } },
    { eid: comment, name: 'doc', comp: { title: '', body: 'old words' } },
    { eid: comment, name: 'comment', comp: { target: target } },
  ])
  // a pre-migration graph: the retired column, still naming the author
  d.exec('alter table comment add column author_eid text')
  d.prepare('update comment set author_eid = ? where eid = ?')
    .run(author, comment)
  assertEquals(
    snapshot(d).changes.find((c) => c.eid == comment && c.name == 'comment')
      ?.comp,
    { eid: comment, target: target },
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

slow('backfill: memory instruments move into created.via', () => {
  let d = fresh()
  let source = uid(), memory = uid()
  apply(d, [
    { eid: source, name: 'session', comp: { id: uid() } },
    { eid: memory, name: 'doc', comp: { title: 'old fact' } },
    { eid: memory, name: 'memory', comp: {} },
  ])
  // a pre-migration graph: the retired column, still naming the source
  d.exec('alter table memory add column source_eid text')
  d.prepare('update memory set source_eid = ? where eid = ?')
    .run(source, memory)
  d.prepare('update created set via = null where eid = ?').run(memory)
  assertEquals(
    snapshot(d).changes.find((c) => c.eid == memory && c.name == 'memory')
      ?.comp,
    { eid: memory, scope: null, last_confirmed_at: null },
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
  assertEquals(
    search(db, 'xylophone')[0]?.title_hit,
    '\x01Xylophone\x02 repair',
  )
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
    { eid: c, name: 'comment', comp: { target: t } },
  ])
  assertEquals(search(db, 'quincunx')[0]?.open, t)
  // …and wears the target's title — the aside has none of its own
  assertEquals(search(db, 'quincunx')[0]?.title, 'Glockenspiel repair')
  apply(db, [{ eid: t, name: 'entity', comp: null }])
  assertEquals(search(db, 'glockenspiel').length, 0) // tombstoned = unfindable
  assertEquals(search(db, 'quincunx').length, 0) // the comment died with it
  assertEquals(search(db, '"broken (syntax'), []) // user words, not operators
})

Deno.test('search leads with an entity named by its human id', () => {
  let memory = uid(), mention = uid()
  apply(db, [
    { eid: memory, name: 'doc', comp: { title: 'Quiet principle', body: '' } },
    { eid: memory, name: 'memory', comp: {} },
  ])
  let id = human(db, memory)
  apply(db, [
    { eid: memory, name: 'doc', comp: { body: `Self reference ${id}` } },
    { eid: mention, name: 'doc', comp: { title: `Notes about ${id}` } },
  ])
  let hits = search(db, id)
  assertEquals(hits[0]?.eid, memory)
  assertEquals(hits.filter((h) => h.eid == memory).length, 1)
  assertEquals(hits.some((h) => h.eid == mention), true)
})

Deno.test('search facet bangs find the component, not its namesake prop', () => {
  let persona = uid(), session = uid()
  apply(db, [
    { eid: persona, name: 'doc', comp: { title: 'Quiet persona' } },
    { eid: persona, name: 'persona', comp: {} },
    { eid: session, name: 'doc', comp: { title: 'Wears quiet persona' } },
    { eid: session, name: 'session', comp: { id: uid(), persona } },
  ])
  let hits = search(db, '.persona!', 100)
  assertEquals(hits.some((h) => h.eid == persona), true)
  assertEquals(hits.some((h) => h.eid == session), false)
})

Deno.test('entity delete cascades to aimed entities, detaches soft refs', () => {
  let p = uid(), t = uid(), t2 = uid(), card = uid(), note = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'proj' } },
    { eid: p, name: 'project', comp: {} },
    { eid: t, name: 'doc', comp: { title: 'doomed' } },
    { eid: t, name: 'task', comp: { status: 'open', project: p } },
    { eid: t2, name: 'doc', comp: { title: 'survivor' } },
    { eid: t2, name: 'task', comp: { status: 'open', project: p } },
    { eid: card, name: 'card', comp: { target: t, view: 'Task' } },
    { eid: note, name: 'doc', comp: { title: '', body: 'aimed at doomed' } },
    { eid: note, name: 'comment', comp: { target: t } },
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
  assertEquals(comp(t2, 'task')?.project, null)
  assertEquals(comp(t2, 'doc')?.title, 'survivor')
})

// mail.target is death-'keep' (a sent mail is history — its subject's
// death doesn't unsend it), so deleting the subject must succeed and the
// mail row must keep pointing at the grave.
Deno.test('mail survives its subject: death keeps the reference', () => {
  let t = uid(), m = uid()
  apply(db, [
    { eid: t, name: 'doc', comp: { title: 'subject' } },
    { eid: m, name: 'doc', comp: { title: 'sent word' } },
    { eid: m, name: 'mail', comp: { target: t } },
    { eid: m, name: 'deliver', comp: { to: 'jeff@x.test' } },
  ])
  apply(db, [{ eid: t, name: 'entity', comp: null }])
  assertEquals(comp(t, 'doc'), undefined) // the subject is gone
  assertEquals(comp(m, 'mail')?.target, t) // history stands
})

// The FK-era mail table vetoed that delete (T-4593); open() heals a live
// db through mendMail — rebuild once, then never again.
slow('mendMail: rebuilds the FK-era table, no-ops when healed', () => {
  let d = fresh()
  // regress mail to the shape live dbs shipped with (FK on target)
  d.exec('drop table mail')
  // The FK-era shape, already trimmed of acted_at/error/to the way open()'s
  // migrateDelivery + migrateDeliver leave it before mendMail runs (D-14945);
  // the FK on target is the bug this rebuild heals.
  d.exec(`create table mail (
    eid        text primary key references entity(eid),
    "from"     text,
    target text references entity(eid),
    to_addr    text,
    message_id text, received_at text, verified integer)`)
  // open() appends the post-FK-era columns (addCol) BEFORE mendMail runs,
  // so the stale table always matches the rebuild ddl's shipping order.
  d.exec('alter table mail add column reply_to text')
  d.exec('alter table mail add column sent_id text')
  d.exec('alter table mail add column in_reply_to text')
  let t = uid(), m = uid()
  apply(d, [
    { eid: t, name: 'doc', comp: { title: 'subject' } },
    { eid: m, name: 'mail', comp: { target: t } },
    { eid: m, name: 'deliver', comp: { to: 'jeff@x.test' } },
  ])
  assertThrows(() => apply(d, [{ eid: t, name: 'entity', comp: null }])) // the bug
  mendMail(d)
  apply(d, [{ eid: t, name: 'entity', comp: null }]) // healed
  let row = () => d.prepare('select target from mail where eid = ?').get(m)
  assertEquals(row(), { target: t }) // rows copied whole, ref kept
  let ddl = () =>
    d.prepare(`select sql from sqlite_master where name = 'mail'`).get()
  let healed = ddl()
  mendMail(d) // already-fixed db: a no-op
  assertEquals(ddl(), healed)
  assertEquals(row(), { target: t })
})

// The same frozen-check disease on tool_call: a live db's source list
// predates the server's own background reports, and a dropped row is the
// one report nobody else was going to make.
slow('mendCalls: widens the frozen source list, keeps the rows', () => {
  let d = fresh()
  d.exec('drop table tool_call')
  d.exec(`create table tool_call (
    ts text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    source text not null check (source in ('mcp','http','web')),
    name text not null, session_id text, ok integer not null,
    ms integer, error text, detail text)`)
  d.exec(`insert into tool_call (source, name, ok) values ('mcp', 'kept', 1)`)
  let put = () =>
    d.exec(`insert into tool_call (source, name, ok) values ('srv', 'x', 0)`)
  assertThrows(put)
  mendCalls(d)
  put()
  let names = () => d.prepare('select name from tool_call order by rowid').all()
  assertEquals(names(), [{ name: 'kept' }, { name: 'x' }])
  let ddl = () =>
    d.prepare(`select sql from sqlite_master where name = 'tool_call'`).get()
  let healed = ddl()
  mendCalls(d) // already-widened: a no-op
  assertEquals(ddl(), healed)
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
    { eid: t, name: 'claim', comp: { session: s } },
    { eid: p, name: 'doc', comp: { title: 'home' } },
    { eid: p, name: 'project', comp: {} },
    { eid: t2, name: 'doc', comp: { title: 'homed' } },
    { eid: t2, name: 'task', comp: { status: 'open', project: p } },
    { eid: who, name: 'doc', comp: { title: 'holder' } },
    { eid: who, name: 'person', comp: {} },
    { eid: t3, name: 'doc', comp: { title: 'plated' } },
    { eid: t3, name: 'task', comp: { status: 'open', assignee: who } },
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
      c.eid == t2 && c.name == 'task' && c.comp?.project === null
    ),
    true,
  )
  // dead assignee: same
  out = apply(db, [{ eid: who, name: 'entity', comp: null }])
  assertEquals(
    out.some((c) =>
      c.eid == t3 && c.name == 'task' && c.comp?.assignee === null
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
    { eid: t, name: 'task', comp: { status: 'open', assignee: who } },
  ])
  assertEquals(comp(t, 'task')?.assignee, who)
  // the person dies; the task stays, unassigned — soft ref, never cascade
  apply(db, [{ eid: who, name: 'entity', comp: null }])
  assertEquals(comp(t, 'task')?.assignee, null)
  assertEquals(comp(t, 'doc')?.title, 'chore')
})

Deno.test('actor: instruments say who they act for; a dead actor detaches both', () => {
  let jeff = uid(), c = uid(), s = uid()
  apply(db, [
    { eid: jeff, name: 'doc', comp: { title: 'Jeff' } },
    { eid: jeff, name: 'person', comp: {} },
    { eid: c, name: 'client', comp: { user_agent: 'probe', actor: jeff } },
    { eid: s, name: 'session', comp: { id: 'sess-for', actor: jeff } },
  ])
  assertEquals(comp(c, 'client')?.actor, jeff)
  assertEquals(comp(s, 'session')?.actor, jeff)
  // the actor dies; instruments survive unattributed, and the wire hears it
  let out = apply(db, [{ eid: jeff, name: 'entity', comp: null }])
  assertEquals(
    out.some((x) => x.eid == c && x.name == 'client' && x.comp?.actor === null),
    true,
  )
  assertEquals(
    out.some((x) =>
      x.eid == s && x.name == 'session' && x.comp?.actor === null
    ),
    true,
  )
  assertEquals(comp(c, 'client')?.actor, null)
  assertEquals(comp(s, 'session')?.actor, null)
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
      comp: { id: `dw-${s}`, requested_task: task, persona: muse },
    },
  ])
  let out = apply(db, [{ eid: task, name: 'entity', comp: null }])
  assertEquals(comp(s, 'session')?.requested_task, null)
  // and the wire hears the release — no ghost provenance in any cache
  assertEquals(
    out.some((x) =>
      x.eid == s && x.name == 'session' && x.comp?.requested_task === null
    ),
    true,
  )
  apply(db, [{ eid: muse, name: 'entity', comp: null }])
  assertEquals(comp(s, 'session')?.persona, null)
  assertEquals(comp(s, 'spawn')?.persona, null)
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
      comp: { id: `role-history-${s}`, role: role },
    },
  ])
  apply(db, [{ eid: role, name: 'entity', comp: null }])
  assertEquals(comp(s, 'session')?.role, role)
})

Deno.test('release: a dead client sheds its shelf, the canvas survives', () => {
  let c = uid(), canvas = uid()
  apply(db, [
    { eid: c, name: 'client', comp: { user_agent: 'probe' } },
    { eid: canvas, name: 'canvas', comp: {} },
    { eid: canvas, name: 'shelf', comp: { client: c } },
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
      { eid: c, name: 'comment', comp: { target: target } },
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
    { eid: p, name: 'dependency', comp: { type: 'contains', child: c } },
    { eid: p, name: 'dependency', comp: { type: 'contains', child: c } },
  ])
  let edges = () =>
    snapshot(db).deps.filter((d) => d.parent == p && d.child == c)
  assertEquals(edges(), [{ parent: p, type: 'contains', child: c }]) // once
  apply(db, [{
    eid: p,
    name: 'dependency',
    comp: { type: 'contains', child: c, gone: true },
  }])
  assertEquals(edges(), [])
})

Deno.test('edges: ord round-trips, patches on re-link, untouched when absent (T-12939)', () => {
  let p = uid(), c = uid()
  let dep = () => snapshot(db).deps.find((d) => d.parent == p && d.child == c)
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'persona' } },
    { eid: c, name: 'doc', comp: { title: 'memory' } },
    {
      eid: p,
      name: 'dependency',
      comp: { type: 'contains', child: c, ord: 3 },
    },
  ])
  assertEquals(dep(), { parent: p, type: 'contains', child: c, ord: 3 })
  // re-linking the same sentence with a new ord PATCHes it (not a second edge)
  apply(db, [{
    eid: p,
    name: 'dependency',
    comp: { type: 'contains', child: c, ord: 1 },
  }])
  assertEquals(dep(), { parent: p, type: 'contains', child: c, ord: 1 })
  // re-linking WITHOUT ord leaves the stored order untouched (PATCH semantics)
  apply(db, [
    { eid: p, name: 'dependency', comp: { type: 'contains', child: c } },
  ])
  assertEquals(dep(), { parent: p, type: 'contains', child: c, ord: 1 })
  // an edge that never declared an ord carries none — Dep stays bare
  let c2 = uid()
  apply(db, [
    { eid: c2, name: 'doc', comp: { title: 'other' } },
    { eid: p, name: 'dependency', comp: { type: 'contains', child: c2 } },
  ])
  assertEquals(
    snapshot(db).deps.find((d) => d.parent == p && d.child == c2),
    { parent: p, type: 'contains', child: c2 },
  )
})

// Every verb in the vocabulary must clear the table's baked check — the
// 'about' verb once shipped in types.ts alone and every about edge
// bounced off the constraint silently.
slow('edges: every vocabulary verb round-trips', async () => {
  let { edges } = await import('./types.ts')
  for (let type of edges) {
    let p = uid(), c = uid()
    apply(db, [
      { eid: p, name: 'doc', comp: { title: `parent ${type}` } },
      { eid: c, name: 'doc', comp: { title: `child ${type}` } },
      { eid: p, name: 'dependency', comp: { type, child: c } },
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
        { eid: p, name: 'dependency', comp: { type: 'blocks', child: c } },
        { eid: p, name: 'doc', comp: { body: 'rolled back' } },
      ]),
    Error,
    'dependency.type is one of',
  )
  assertEquals(comp(p, 'doc')?.body, '')
  apply(db, [
    { eid: p, name: 'dependency', comp: { type: 'reads', child: uid() } },
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
    { eid: p, name: 'dependency', comp: { type: 'requires', child: c } },
  ])
  apply(db, [{ eid: c, name: 'entity', comp: null }])
  assertEquals(snapshot(db).deps.some((d) => d.parent == p), false) // pruned
  apply(db, [
    { eid: p, name: 'dependency', comp: { type: 'requires', child: c } },
  ])
  assertEquals(snapshot(db).deps.some((d) => d.parent == p), false) // voided
})

// Supersession is a plain edge, but the invariant is its own: the replaced
// entity stays VISIBLE and MARKED (never hidden or aged out), and either end
// answers "what is current?" — the successor via its refs, the superseded via
// its backrefs. gone unlinks; deleting the successor leaves the survivor
// coherent (the edge prunes, the old entity remains).
Deno.test('edges: supersedes marks the old, never hides it; both ends answer', () => {
  let old = uid(), cur = uid()
  apply(db, [
    { eid: old, name: 'doc', comp: { title: '8.5×8.5 square' } },
    { eid: cur, name: 'doc', comp: { title: '8×10 portrait' } },
    { eid: cur, name: 'dependency', comp: { type: 'supersedes', child: old } },
  ])
  let deps = () => snapshot(db).deps
  // The current end answers "what did I replace?" (its outgoing ref); the
  // superseded end answers "what replaced me?" (its incoming backref).
  assertEquals(
    deps().filter((d) => d.parent == cur),
    [{ parent: cur, type: 'supersedes', child: old }],
  )
  assertEquals(
    deps().filter((d) => d.child == old),
    [{ parent: cur, type: 'supersedes', child: old }],
  )
  // Marked, not hidden: the superseded entity is still fully present.
  assertEquals(comp(old, 'doc')?.title, '8.5×8.5 square')

  // gone unlinks the same sentence.
  apply(db, [{
    eid: cur,
    name: 'dependency',
    comp: { type: 'supersedes', child: old, gone: true },
  }])
  assertEquals(deps().some((d) => d.child == old), false)

  // Deleting the successor prunes the edge; the survivor stays coherent
  // rather than erroring or resurrecting — the chain degrades to "gone".
  apply(db, [{
    eid: cur,
    name: 'dependency',
    comp: { type: 'supersedes', child: old },
  }])
  apply(db, [{ eid: cur, name: 'entity', comp: null }])
  assertEquals(deps().some((d) => d.child == old), false) // pruned
  assertEquals(comp(old, 'doc')?.title, '8.5×8.5 square') // survivor intact
})

Deno.test('open() is idempotent and additive on live files', () => {
  assertMatch(String(fresh().prepare('select 1 as ok').get()?.ok), /1/)
})

slow('open renames every reference key, its filters, and its history', () => {
  let root = Deno.makeTempDirSync({ prefix: 'tasks-refs-' })
  let path = `${root}/tasks.db`
  let legacy = open(path)
  let project = uid(), task = uid(), first = uid(), reply = uid()
  let sub = uid(), board = uid(), memory = uid(), persona = uid()
  apply(legacy, [
    { eid: project, name: 'doc', comp: { title: 'project' } },
    { eid: project, name: 'project', comp: {} },
    { eid: task, name: 'task', comp: { status: 'open', project } },
    { eid: first, name: 'mail', comp: { target: task } },
    { eid: reply, name: 'mail', comp: { target: task, reply_to: first } },
    {
      eid: sub,
      name: 'subscription',
      comp: { actor: project, target: task, mode: 'watch' },
    },
    { eid: board, name: 'board', comp: { query: '.status=open' } },
    {
      eid: memory,
      name: 'doc',
      comp: {
        title: 'memory.scope_eid guide',
        body: 'Use session.parent_eid and envelope.to_eid.',
      },
    },
    { eid: memory, name: 'memory', comp: {} },
    {
      eid: persona,
      name: 'doc',
      comp: {
        title: 'persona',
        body: '`eid`/`*_eid` values; the `_eid` sugar in `route()`; ' +
          'a `<name>_eid` column elsewhere',
      },
    },
    { eid: persona, name: 'persona', comp: {} },
    {
      eid: project,
      name: 'dependency',
      comp: { type: 'about', child: task },
    },
  ])
  legacy.prepare('update board set query = ? where eid = ?').run(
    `.project_eid=${project}&.task.assignee_eid=` +
      `&.title~="literal .project_eid=value"`,
    board,
  )
  legacy.prepare('insert into journal (actor, batch) values (?, ?)').run(
    project,
    JSON.stringify([{
      eid: reply,
      name: 'mail',
      comp: { target_eid: task, reply_to_eid: first },
    }]),
  )
  let renames = [
    ['task', 'project', 'project_eid'],
    ['task', 'assignee', 'assignee_eid'],
    ['role', 'scope', 'scope_eid'],
    ['layout', 'root', 'root_eid'],
    ['pane', 'layout', 'layout_eid'],
    ['pane', 'parent', 'parent_eid'],
    ['pane', 'content', 'content_eid'],
    ['card', 'target', 'target_eid'],
    ['pin', 'canvas', 'canvas_eid'],
    ['client', 'actor', 'actor_eid'],
    ['camera', 'client', 'client_eid'],
    ['camera', 'canvas', 'canvas_eid'],
    ['fold', 'client', 'client_eid'],
    ['fold', 'board', 'board_eid'],
    ['shelf', 'client', 'client_eid'],
    ['session', 'requested_task', 'requested_task_eid'],
    ['session', 'role', 'role_eid'],
    ['session', 'persona', 'persona_eid'],
    ['session', 'actor', 'actor_eid'],
    ['session', 'parent', 'parent_eid'],
    ['spawn', 'persona', 'persona_eid'],
    ['claim', 'session', 'session_eid'],
    ['subscription', 'actor', 'actor_eid'],
    ['subscription', 'target', 'target_eid'],
    ['stop_request', 'target', 'target_eid'],
    ['knock', 'target', 'target_eid'],
    ['wake', 'target', 'target_eid'],
    ['mail', 'target', 'target_eid'],
    ['mail', 'reply_to', 'reply_to_eid'],
    ['conflict', 'target', 'target_eid'],
    ['comment', 'target', 'target_eid'],
    ['persona', 'home', 'home_eid'],
    ['memory', 'scope', 'scope_eid'],
    ['dependency', 'parent', 'parent_eid'],
    ['dependency', 'child', 'child_eid'],
  ]
  for (let [table, col, old] of renames) {
    legacy.exec(`alter table ${table} rename column ${col} to ${old}`)
  }
  legacy.close()

  let healed = open(path)
  for (let [table, col, old] of renames) {
    assertEquals(hasCol(healed, table, col), true, `${table}.${col}`)
    assertEquals(hasCol(healed, table, old), false, `${table}.${old}`)
  }
  assertEquals(
    healed.prepare('select project from task where eid = ?').get(task),
    { project },
  )
  assertEquals(
    healed.prepare('select target, reply_to from mail where eid = ?').get(
      reply,
    ),
    { target: task, reply_to: first },
  )
  assertEquals(
    healed.prepare('select query from board where eid = ?').get(board),
    {
      query: `.project=${project}&.task.assignee=` +
        `&.title~="literal .project_eid=value"`,
    },
  )
  assertEquals(
    healed.prepare('select title, body from doc where eid = ?').get(memory),
    {
      title: 'memory.scope guide',
      body: 'Use session.parent and envelope.to.',
    },
  )
  assertEquals(
    healed.prepare('select title, body from doc where eid = ?').get(persona),
    {
      title: 'persona',
      body:
        '`eid` and reference values; the reference property in `route()`; ' +
        'a same-named reference column elsewhere',
    },
  )
  assertEquals(
    snapshot(healed).deps.some((d) =>
      d.parent == project && d.child == task && d.type == 'about'
    ),
    true,
  )
  assertEquals(healed.prepare('pragma foreign_key_check').all(), [])
  assertMatch(
    String(
      (healed.prepare(
        `select sql from sqlite_master where name = 'subscription_actor_target'`,
      ).get() as { sql: string }).sql,
    ),
    /"subscription" \("actor", "target"\)/,
  )
  assertEquals(
    journalOf(healed, reply)[0].changes[0].comp,
    { target: task, reply_to: first },
  )
  assertThrows(() =>
    apply(healed, [{
      eid: uid(),
      name: 'subscription',
      comp: { actor: project, target: task, mode: 'watch' },
    }])
  )
  healed.close()

  let reopened = open(path)
  assertEquals(
    reopened.prepare('select project from task where eid = ?').get(task),
    { project },
  )
  reopened.close()
  Deno.removeSync(root, { recursive: true })
})

Deno.test('open refuses the live graph under a test, before touching disk', () => {
  // The footgun T-14260 disarmed: under `deno test` (main module ends
  // _test.ts) open() must reject the HOME-derived live path and create
  // NOTHING — a module-scope import that forgot DB_PATH fails at the door
  // instead of migrating and locking the owner's board. Aim liveDb() at a
  // scratch HOME so the proof needs no real db.
  let home = Deno.env.get('HOME')!
  let scratch = Deno.makeTempDirSync({ prefix: 'tasks-liveguard-' })
  try {
    Deno.env.set('HOME', scratch)
    assertThrows(() => open(liveDb()), Error, 'refusing to open the live graph')
    assertEquals([...Deno.readDirSync(scratch)].length, 0)
  } finally {
    Deno.env.set('HOME', home)
    Deno.removeSync(scratch, { recursive: true })
  }
})

slow('open adds the repo landing gate in place', () => {
  let root = Deno.makeTempDirSync({ prefix: 'tasks-repo-gate-' })
  let path = `${root}/tasks.db`
  let legacy = open(path)
  legacy.exec('alter table repo drop column gate')
  legacy.close()
  let healed = open(path)
  assertEquals(hasCol(healed, 'repo', 'gate'), true)
  healed.close()
  Deno.removeSync(root, { recursive: true })
})

slow('open adds the repo url in place', () => {
  let root = Deno.makeTempDirSync({ prefix: 'tasks-repo-url-' })
  let path = `${root}/tasks.db`
  let legacy = open(path)
  legacy.exec('alter table repo drop column url')
  legacy.close()
  let healed = open(path)
  assertEquals(hasCol(healed, 'repo', 'url'), true)
  healed.close()
  Deno.removeSync(root, { recursive: true })
})

slow('open retires proposal into a stamp and rewrites stale boards', () => {
  let root = Deno.makeTempDirSync({ prefix: 'tasks-proposal-' })
  let path = `${root}/tasks.db`
  let legacy = open(path)
  let idea = uid(), declined = uid(), plain = uid(), board = uid()
  apply(legacy, [
    { eid: idea, name: 'task', comp: { status: 'open' } },
    { eid: declined, name: 'task', comp: { status: 'open' } },
    { eid: plain, name: 'task', comp: { status: 'open' } },
    { eid: board, name: 'board', comp: { query: '.status=open' } },
  ])
  let filed = compOf(legacy, idea, 'created')!
  legacy.exec('alter table task add column proposal integer')
  legacy.prepare('update task set proposal = ? where eid = ?').run(1, idea)
  legacy.prepare('update task set proposal = ? where eid = ?')
    .run(0, declined)
  legacy.prepare('update board set query = ? where eid = ?').run(
    '.status=open&.proposal=true&.domain=Eng',
    board,
  )
  legacy.close()

  let healed = open(path)
  assertEquals(hasCol(healed, 'task', 'proposal'), false)
  assertEquals(compOf(healed, idea, 'proposed'), {
    eid: idea,
    at: filed.at,
    by: filed.by,
    via: filed.via,
  })
  assertEquals(compOf(healed, declined, 'proposed'), undefined)
  assertEquals(compOf(healed, plain, 'proposed'), undefined)
  assertEquals(
    compOf(healed, board, 'board')?.query,
    '.status=open&.proposed~=&.domain=Eng',
  )
  // A partially migrated database may have lost the column before its saved
  // query changed. The rewrite is independently idempotent.
  healed.prepare('update board set query = ? where eid = ?')
    .run('.proposal=true', board)
  healed.close()
  let again = open(path)
  assertEquals(compOf(again, board, 'board')?.query, '.proposed~=')
  assertEquals(compOf(again, idea, 'proposed')?.at, filed.at)
  again.close()
  Deno.removeSync(root, { recursive: true })
})

slow('open retires project timestamps into the archived stamp', () => {
  let root = Deno.makeTempDirSync({
    prefix: 'tasks-retired-project-',
    suffix: '.db',
  })
  let path = `${root}/tasks.db`
  let legacy = open(path)
  let retired = uid(), both = uid(), board = uid()
  apply(legacy, [
    { eid: retired, name: 'project', comp: {} },
    { eid: both, name: 'project', comp: {} },
    { eid: both, name: 'archived', comp: {} },
    { eid: board, name: 'board', comp: { query: '' } },
  ])
  legacy.exec('alter table project add column retired_at text')
  legacy.prepare('update project set retired_at = ? where eid = ?')
    .run('2026-07-01T00:00:00.000Z', retired)
  legacy.prepare('update project set retired_at = ? where eid = ?')
    .run('2026-06-01T00:00:00.000Z', both)
  legacy.prepare('update archived set at = ? where eid = ?')
    .run('2026-06-15T00:00:00.000Z', both)
  legacy.prepare('update board set query = ? where eid = ?').run(
    '.project.retired_at=&.retired_at>=2026-01-01 ' +
      '"literal .retired_at=value"',
    board,
  )
  legacy.close()

  let healed = open(path)
  assertEquals(hasCol(healed, 'project', 'retired_at'), false)
  assertEquals(
    compOf(healed, retired, 'archived')?.at,
    '2026-07-01T00:00:00.000Z',
  )
  assertEquals(
    compOf(healed, both, 'archived')?.at,
    '2026-06-15T00:00:00.000Z',
  )
  assertEquals(
    compOf(healed, board, 'board')?.query,
    '.archived.at=&.archived.at>=2026-01-01 "literal .retired_at=value"',
  )
  healed.prepare('update board set query = ? where eid = ?')
    .run('.retired_at=', board)
  healed.close()

  let again = open(path)
  assertEquals(compOf(again, board, 'board')?.query, '.archived.at=')
  again.close()
  Deno.removeSync(root, { recursive: true })
})

slow('open heals canonical stored values once and preserves failures', () => {
  let root = Deno.makeTempDirSync({ prefix: 'tasks-heal-' })
  let path = `${root}/tasks.db`
  let legacy = open(path)
  let project = uid(), task = uid(), bad = uid(), session = uid()
  apply(legacy, [
    { eid: project, name: 'project', comp: {} },
    {
      eid: task,
      name: 'task',
      comp: { status: 'open', priority: 2, project: project },
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
  legacy.exec('alter table project add column retired_at text')
  legacy.prepare(`update project set retired_at = 'never' where eid = ?`)
    .run(project)
  let stable = legacy.prepare(
    `select quote(status) as status, typeof(status) as status_type,
            quote(priority) as priority, typeof(priority) as priority_type,
            quote(project) as project,
            typeof(project) as project_type
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
                quote(project) as project,
                typeof(project) as project_type
         from task where eid = ?`,
      ).get(task),
      stable,
    )
    assertEquals(
      first.prepare('select status from task where eid = ?').get(bad),
      { status: 'gone' },
    )
    assertEquals(
      first.prepare('select at from archived where eid = ?')
        .get(project),
      { at: 'never' },
    )
    first.close()

    let before = Deno.readFileSync(path)
    let second = open(path)
    assertEquals(
      second.prepare(
        `select status, priority, project from task where eid = ?`,
      ).get(task),
      { status: 'open', priority: 2, project: project },
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
    warnings.filter((w) => w.includes(`${project} archived.at is a time`))
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

Deno.test('search: component filters select before limiting', () => {
  let settled = uid()
  apply(db, [
    { eid: settled, name: 'doc', comp: { title: 'A settled choice' } },
    { eid: settled, name: 'decided', comp: { at: '2026-01-01' } },
  ])
  db.prepare('update created set at = ? where eid = ?')
    .run('2026-01-01T00:00:00.000Z', settled)
  for (let i = 0; i < 11; i++) {
    let eid = uid()
    apply(db, [{ eid, name: 'doc', comp: { title: `Newer choice ${i}` } }])
    db.prepare('update created set at = ? where eid = ?')
      .run(`2026-02-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, eid)
  }
  assertEquals(search(db, '.decided!', 1).map((h) => h.eid), [settled])
})

Deno.test('search: references and paths screen the hits', () => {
  let u = uid(), other = uid(), t = uid(), t2 = uid(), instrument = uid()
  apply(db, [
    { eid: u, name: 'doc', comp: { title: 'Jeff Peterson' } },
    { eid: u, name: 'person', comp: {} },
    { eid: u, name: 'alias', comp: { slug: 'jeffp' } },
    { eid: other, name: 'doc', comp: { title: 'Alice Jones' } },
    { eid: other, name: 'person', comp: {} },
    { eid: other, name: 'alias', comp: { slug: 'alicej' } },
    { eid: t, name: 'doc', comp: { title: 'Wurlitzer tuning' } },
    { eid: t, name: 'task', comp: { status: 'open', assignee: u } },
    { eid: t2, name: 'doc', comp: { title: 'Wurlitzer restringing' } },
    { eid: t2, name: 'task', comp: { status: 'open' } },
    { eid: instrument, name: 'doc', comp: { title: 'Wurlitzer console' } },
    {
      eid: instrument,
      name: 'client',
      comp: { user_agent: 'test', actor: u },
    },
    {
      eid: instrument,
      name: 'session',
      comp: { id: `search-${instrument}`, actor: other },
    },
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
  // filters alone still list; a shared reference checks every owner
  assertEquals(eids('.assignee=jeffp'), [t])
  assertEquals(eids('wurlitzer .actor=jeffp'), [instrument])
  assertEquals(eids('wurlitzer .actor=alicej'), [instrument])
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
        comp: { scope: p, last_confirmed_at: 'FAKE' },
      },
    ],
    undefined,
    `sess-${s}`,
  )
  let row = comp(m, 'memory')
  assertEquals(row?.scope, p)
  assertEquals(row?.last_confirmed_at, null) // server-owned
  // Retired to created.via (T-7113) and dropped: naming it is now a loud
  // refusal, not a silent drop — the vocabulary is the whole truth.
  assertThrows(
    () => apply(db, [{ eid: m, name: 'memory', comp: { source_eid: s } }]),
    Error,
    'unknown column: memory.source_eid',
  )
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
    { eid: m, name: 'memory', comp: {} },
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
    { eid: s, name: 'session', comp: { id: `jw-${s}`, actor: who } },
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
    { eid: t, name: 'claim', comp: { session: s1 } },
  ])
  let held = journalCount()
  assertThrows(() =>
    apply(db, [{ eid: t, name: 'claim', comp: { session: s2 } }])
  )
  assertEquals(journalCount(), held)
})

Deno.test('journalBy: cuts the ledger by session, not its resolved actor', () => {
  let actor = uid(), one = uid(), two = uid(), first = uid(), second = uid()
  apply(db, [
    { eid: actor, name: 'person', comp: {} },
    { eid: one, name: 'session', comp: { id: `one-${one}`, actor: actor } },
    { eid: two, name: 'session', comp: { id: `two-${two}`, actor: actor } },
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

Deno.test('claim leaves one durable worked edge after its lease is released', () => {
  let session = uid(), one = uid(), two = uid()
  apply(db, [
    { eid: session, name: 'session', comp: { id: session } },
    { eid: one, name: 'doc', comp: { title: 'one' } },
    { eid: one, name: 'task', comp: { status: 'open', priority: 1 } },
    { eid: two, name: 'doc', comp: { title: 'two' } },
    { eid: two, name: 'task', comp: { status: 'open', priority: 1 } },
  ])
  let first = apply(db, [{ eid: one, name: 'claim', comp: { session } }])
  assertEquals(
    first.some((c) =>
      c.eid == session && c.name == 'dependency' &&
      c.comp?.type == 'worked' && c.comp.child == one
    ),
    true,
  )
  apply(db, [{ eid: one, name: 'claim', comp: null }])
  apply(db, [{ eid: two, name: 'claim', comp: { session } }])
  apply(db, [{ eid: two, name: 'claim', comp: null }])
  let again = apply(db, [{ eid: one, name: 'claim', comp: { session } }])
  assertEquals(again.some((c) => c.name == 'dependency'), false)

  assertEquals(
    snapshot(db).deps.filter((d) => d.parent == session && d.type == 'worked')
      .map((d) => d.child).sort(),
    [one, two].sort(),
  )
})

Deno.test('historical worked edges materialize explicitly and idempotently', () => {
  let session = uid(), task = uid()
  apply(db, [
    { eid: session, name: 'session', comp: { id: session } },
    { eid: task, name: 'doc', comp: { title: 'historical task' } },
    { eid: task, name: 'task', comp: { status: 'open', priority: 1 } },
  ])
  apply(db, [{ eid: task, name: 'claim', comp: { session } }])
  apply(db, [{ eid: task, name: 'claim', comp: null }])
  db.prepare(`
    delete from dependency
    where parent = ? and type = 'worked' and child = ?
  `).run(session, task)

  let missing = historicalWorked(db)
  assertEquals(missing, [{
    eid: session,
    name: 'dependency',
    comp: { type: 'worked', child: task },
  }])
  apply(db, missing)
  assertEquals(historicalWorked(db), [])
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
  assertEquals(comp(s, 'session')?.actor, proj) // stamped from cwd → repo
  assertEquals(
    out.some((x) => x.eid == s && x.name == 'session' && x.comp?.actor == proj),
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
    comp: { id: `v2-${s2}`, cwd: '/srv/venture-abc/wt/b', actor: who },
  }])
  assertEquals(comp(s2, 'session')?.actor, who) // named actor untouched
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
    assertEquals(comp(s, 'session')?.actor, proj)
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
    { eid: c, name: 'comment', comp: { target: a } },
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
      { eid: c, name: 'comment', comp: { target: t } },
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

// journal_touch (T-13915) indexes every eid a batch touched, so a batch about
// two entities is seekable from either — the same eids json_extract('$.eid')
// found, so journalOf stays behavior-identical while becoming a seek.
Deno.test('journal_touch: a multi-entity batch is seekable from each eid', () => {
  let a = uid(), b = uid()
  apply(db, [
    { eid: a, name: 'doc', comp: { title: 'a' } },
    { eid: b, name: 'doc', comp: { title: 'b' } },
  ])
  let batch = lastBatch(db, a)
  assertEquals(lastBatch(db, b), batch) // one batch, both entities see it
  assertEquals(journalOf(db, a)[0].id, batch)
  assertEquals(journalOf(db, b)[0].id, batch)
  // one row per (batch, eid) — no duplicate even though the batch had two
  // changes; each eid appears once.
  let rows = db.prepare(
    'select count(*) as n from journal_touch where jrow = ?',
  ).get(batch) as { n: number }
  assertEquals(rows.n, 2)
})

// The one-time migration path: a live db has 26k journal rows and an empty
// journal_touch. backfillJournalTouch fills it once from the existing rows, so a
// per-entity read on an entity written before the index still seeks correctly —
// and it is difference-guarded, a no-op once populated.
Deno.test('backfillJournalTouch: rebuilds the index from the existing journal', () => {
  let d = fresh()
  let x = uid(), y = uid()
  apply(d, [{ eid: x, name: 'doc', comp: { title: 'x1' } }])
  apply(d, [
    { eid: x, name: 'doc', comp: { title: 'x2' } },
    { eid: y, name: 'doc', comp: { title: 'y1' } },
  ])
  let before = journalOf(d, x)
  // Simulate a pre-index live db: the journal rows exist, the index does not.
  d.exec('delete from journal_touch')
  assertEquals(journalOf(d, x).length, 0) // proves the read depends on the index
  backfillJournalTouch(d)
  assertEquals(journalOf(d, x), before) // rebuilt identically from the log
  assertEquals(journalOf(d, y).length, 1)
  // Difference-guarded: a second run over the populated table changes nothing.
  let n = (db2: typeof d) =>
    (db2.prepare('select count(*) as n from journal_touch').get() as {
      n: number
    }).n
  let filled = n(d)
  backfillJournalTouch(d)
  assertEquals(n(d), filled)
  d.close()
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
    { eid: p, name: 'project', comp: {} },
    { eid: p, name: 'archived', comp: {} },
    { eid: sunk, name: 'doc', comp: { title: 'Quagga sunk chore' } },
    { eid: sunk, name: 'task', comp: { status: 'open', project: p } },
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
  apply(db, [{ eid: p, name: 'archived', comp: null }])
  assertEquals(search(db, 'quagga').every((h) => !h.retired), true)
})

Deno.test('search hides quarantined content until the query names the facet', () => {
  let hidden = uid(), visible = uid(), comment = uid()
  apply(db, [
    {
      eid: hidden,
      name: 'doc',
      comp: { title: 'Xqzquarantine hidden', body: '' },
    },
    { eid: hidden, name: 'quarantined', comp: {} },
    {
      eid: visible,
      name: 'doc',
      comp: { title: 'Xqzquarantine visible', body: '' },
    },
    {
      eid: comment,
      name: 'doc',
      comp: { title: '', body: 'Xqzquarantine reply' },
    },
    { eid: comment, name: 'comment', comp: { target: hidden } },
  ])
  assertEquals(search(db, 'xqzquarantine').map((h) => h.eid), [visible])
  assertEquals(
    search(db, 'xqzquarantine .quarantined!').map((h) => h.eid),
    [hidden],
  )
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
        child: String(comp.child),
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
      { eid: cm, name: 'comment', comp: { target: t } },
    ],
    [{ eid: t, name: 'claim', comp: { session: s } }],
    [
      { eid: other, name: 'doc', comp: { title: 'blocker' } },
      { eid: other, name: 'task', comp: { status: 'open' } },
      {
        eid: other,
        name: 'dependency',
        comp: { type: 'requires', child: t },
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

slow('nobody writes in the owner name but the owner keyboard', () => {
  // A db with exactly ONE person: that person IS the box owner, which is
  // the only condition under which ownerActor has anything to return.
  let path = Deno.makeTempFileSync({ prefix: 'tasks-signer-', suffix: '.db' })
  let d = open(path)
  let owner = uid()
  apply(d, [
    { eid: owner, name: 'doc', comp: { title: 'the owner' } },
    { eid: owner, name: 'person', comp: {} },
    { eid: owner, name: 'email', comp: { address: 'owner@yak.test' } },
  ])

  // The server's own machinery — a sweep, a wake, an anonymous POST — names
  // no writer. It is not the owner, and provenance no longer says it is: the
  // fallback made 608 rows read as authored by him, one of them a letter he
  // was then asked about (T-9934).
  assertEquals(writerActor(d, null), null)
  assertEquals(writerActor(d, 'nobody-by-that-name'), null)
  // An agent session with no actor and no venture is likewise not its owner.
  let s = uid()
  apply(d, [{ eid: s, name: 'session', comp: { id: 'sess-1' } }])
  assertEquals(writerActor(d, 'sess-1'), null)
  // A browser tab that never named an actor IS someone at a keyboard, and on
  // a one-person box that someone is them — the one inference left standing.
  let tab = uid()
  apply(d, [{ eid: tab, name: 'client', comp: {} }])
  assertEquals(writerActor(d, tab), owner)
  // A signature refuses even that. Otherwise any unattributed POST to the
  // local /apply sends mail as the owner — the fleet's highest-trust byline.
  assertEquals(senderActor(d, tab), null)
  assertEquals(senderActor(d, null), null)
  assertEquals(senderActor(d, 'nobody-by-that-name'), null)
  assertEquals(senderActor(d, owner), owner) // named outright, it stands

  let m = uid()
  apply(d, [
    { eid: m, name: 'doc', comp: { title: 's', body: 'b' } },
    { eid: m, name: 'mail', comp: {} },
    { eid: m, name: 'deliver', comp: { to: 'x@y.test' } },
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
      { eid: m, name: 'mail', comp: {} },
      { eid: m, name: 'deliver', comp: { to: 'x@y.test' } },
    ],
    undefined,
    who,
  )

  let sent = snapshot(db).changes.find((c) => c.eid == m && c.name == 'mail')
  assertEquals(sent?.comp?.from, 'writer@yak.test') // seen, not theirs to name
})

// A precondition is the graph's --ff-only. The hazard is a guard that never
// fires: it passes every test that doesn't try to make it reject, and it
// passes before the feature exists — so each of these carries its control.

Deno.test('precondition: a moved value refuses, and the value survives', () => {
  let m = uid()
  apply(db, [{ eid: m, name: 'doc', comp: { title: 'memory', body: 'ONE' } }])
  let read = sha('ONE') // what the first writer read
  // A second writer lands between that read and the write.
  apply(db, [{ eid: m, name: 'doc', comp: { body: 'TWO' } }])
  assertThrows(
    () =>
      apply(db, [
        { eid: m, name: 'doc', comp: { body: 'THREE' }, was: { body: read } },
      ]),
    Error,
    'doc.body',
  )
  assertEquals(comp(m, 'doc')?.body, 'TWO') // the clobber did NOT land
  // The control: the same write, guarding what is there, applies.
  apply(db, [
    { eid: m, name: 'doc', comp: { body: 'THREE' }, was: { body: sha('TWO') } },
  ])
  assertEquals(comp(m, 'doc')?.body, 'THREE')
})

Deno.test('precondition: the refusal hands back the current value', () => {
  let m = uid()
  apply(db, [{ eid: m, name: 'doc', comp: { title: 'm', body: 'CURRENT' } }])
  let e = assertThrows(
    () =>
      apply(db, [
        { eid: m, name: 'doc', comp: { body: 'x' }, was: { body: sha('OLD') } },
      ]),
    Stale,
  )
  assertEquals(e.value, 'CURRENT') // merge into THIS, not into a re-read
  assertEquals(e.col, 'body')
  assertEquals(e.eid, m)
  assertMatch(e.message, /CURRENT/)
  // The three-step loop terminates: merge into what you were handed, resend.
  apply(db, [{
    eid: m,
    name: 'doc',
    comp: { body: e.value + '+mine' },
    was: { body: sha(e.value) },
  }])
  assertEquals(comp(m, 'doc')?.body, 'CURRENT+mine')
})

// `doc.body` is `not null default ''`, so a body is never NULL — an unwritten
// body reads as the empty string, and that is what a caller guarding a fresh
// memory hashes. The null sentinel is for columns that really are nullable.
Deno.test('precondition: an unwritten body is empty, not null', () => {
  let m = uid()
  apply(db, [{ eid: m, name: 'doc', comp: { title: 'no body yet' } }])
  apply(db, [
    { eid: m, name: 'doc', comp: { body: 'first' }, was: { body: sha('') } },
  ])
  assertEquals(comp(m, 'doc')?.body, 'first')
  // The control: that same guard now refuses, because a body stands there.
  assertThrows(
    () =>
      apply(db, [
        {
          eid: m,
          name: 'doc',
          comp: { body: 'second' },
          was: { body: sha('') },
        },
      ]),
    Stale,
    'has moved since you read it',
  )
  assertEquals(comp(m, 'doc')?.body, 'first')
})

Deno.test('precondition: null is a value — expected-absent compares', () => {
  let m = uid(), p = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'a scope' } },
    { eid: p, name: 'project', comp: {} },
    { eid: m, name: 'doc', comp: { title: 'a memory' } },
    { eid: m, name: 'memory', comp: {} }, // scope null
  ])
  // Guarding a genuinely absent column, expecting absent, applies.
  apply(db, [
    {
      eid: m,
      name: 'memory',
      comp: { scope: p },
      was: { scope: null },
    },
  ])
  assertEquals(comp(m, 'memory')?.scope, p)
  // Expecting absent where a value now stands refuses — the write that
  // would otherwise clobber a scope set since the caller read.
  assertThrows(
    () =>
      apply(db, [
        {
          eid: m,
          name: 'memory',
          comp: { scope: null },
          was: { scope: null },
        },
      ]),
    Stale,
  )
  assertEquals(comp(m, 'memory')?.scope, p)
})

Deno.test('precondition: per column — an unrelated edit does not refuse', () => {
  let m = uid()
  apply(db, [{ eid: m, name: 'doc', comp: { title: 'T', body: 'B' } }])
  apply(db, [{ eid: m, name: 'doc', comp: { title: 'T2' } }]) // title moves
  // The body guard still passes: a title edit is not a body conflict.
  apply(db, [
    { eid: m, name: 'doc', comp: { body: 'B2' }, was: { body: sha('B') } },
  ])
  assertEquals(comp(m, 'doc')?.body, 'B2')
})

Deno.test('precondition: a batch losing one guard keeps NEITHER change', () => {
  let a = uid(), b = uid()
  apply(db, [
    { eid: a, name: 'doc', comp: { title: 'a', body: 'A' } },
    { eid: b, name: 'doc', comp: { title: 'b', body: 'B' } },
  ])
  assertThrows(() =>
    apply(db, [
      { eid: b, name: 'doc', comp: { body: 'B-new' } }, // unguarded, valid
      {
        eid: a,
        name: 'doc',
        comp: { body: 'A-new' },
        was: { body: sha('stale') },
      },
    ])
  )
  assertEquals(comp(a, 'doc')?.body, 'A')
  assertEquals(comp(b, 'doc')?.body, 'B') // partial would have left B-new
})

Deno.test('precondition: absent `was` is unguarded, exactly as before', () => {
  let m = uid()
  apply(db, [{ eid: m, name: 'doc', comp: { title: 'm', body: 'ONE' } }])
  apply(db, [{ eid: m, name: 'doc', comp: { body: 'TWO' } }])
  assertEquals(comp(m, 'doc')?.body, 'TWO')
})

Deno.test('precondition: a guard on an unknown column is refused', () => {
  let m = uid()
  apply(db, [{ eid: m, name: 'doc', comp: { title: 'm', body: 'ONE' } }])
  // Guarding a column that isn't there would protect nothing — failing
  // OPEN silently, which is the bug wearing a safety label.
  assertThrows(
    () =>
      apply(db, [
        { eid: m, name: 'doc', comp: { body: 'x' }, was: { bodyy: null } },
      ]),
    Error,
    'unknown column: doc.bodyy',
  )
  assertEquals(comp(m, 'doc')?.body, 'ONE')
})

slow(
  'healInboundDeliver: a stranded inbound letter mends; outbound is left alone',
  () => {
    open()
    // A venue that wears its fleet address, and the two mails that name it.
    let venue = uid()
    apply(db, [
      { eid: venue, name: 'doc', comp: { title: 'CafeCar' } },
      { eid: venue, name: 'email', comp: { address: 'cafecar@bot.test' } },
    ])
    // An INBOUND letter migrated wrongly: recipient stranded in deliver{to},
    // to_addr empty. received_at set + sent_id null is what marks it inbound.
    let inb = uid()
    apply(db, [
      { eid: inb, name: 'doc', comp: { title: 'a letter' } },
      { eid: inb, name: 'mail', comp: {} },
      { eid: inb, name: 'deliver', comp: { to: venue } },
    ])
    db.prepare('update mail set received_at = ?, message_id = ? where eid = ?')
      .run('2026-01-01T00:00:00Z', 'm-in', inb)
    // An OUTBOUND letter legitimately carries deliver{to}: sent_id set excludes
    // it from the heal even though it too came home (received_at set).
    let out = uid()
    apply(db, [
      { eid: out, name: 'doc', comp: { title: 'a reply' } },
      { eid: out, name: 'mail', comp: {} },
      { eid: out, name: 'deliver', comp: { to: venue } },
    ])
    db.prepare('update mail set sent_id = ?, received_at = ? where eid = ?')
      .run('sent-out', '2026-01-02T00:00:00Z', out)

    healInboundDeliver(db)

    // The inbound letter now names its venue by address, and sheds the deliver.
    assertEquals(
      (db.prepare('select to_addr from mail where eid = ?').get(inb) as {
        to_addr: string
      }).to_addr,
      'cafecar@bot.test',
    )
    assertEquals(
      db.prepare('select count(*) c from deliver where eid = ?').get(inb),
      { c: 0 },
    )
    // The outbound letter is untouched.
    assertEquals(
      db.prepare('select count(*) c from deliver where eid = ?').get(out),
      { c: 1 },
    )
    // Idempotent: a second pass finds nothing to mend.
    healInboundDeliver(db)
    assertEquals(
      (db.prepare('select to_addr from mail where eid = ?').get(inb) as {
        to_addr: string
      }).to_addr,
      'cafecar@bot.test',
    )
    assertEquals(
      db.prepare('select count(*) c from deliver where eid = ?').get(out),
      { c: 1 },
    )
  },
)

// ── T-3684: num is a nullable, kind-driven label ───────────────────────────

Deno.test('num moved off first-touch: a new task still mints the next number', () => {
  let a = uid(), b = uid()
  apply(db, [{ eid: a, name: 'doc', comp: { title: 'first' } }])
  apply(db, [{ eid: b, name: 'doc', comp: { title: 'second' } }])
  let na = Number(comp(a, 'entity')?.num)
  let nb = Number(comp(b, 'entity')?.num)
  assertEquals(na > 0 && nb == na + 1, true) // consecutive, minted after comps landed
})

Deno.test('entry and wake are the num-less kinds', () => {
  let numless = new Set(['entry', 'wake'])
  for (let k of kindOrder) assertEquals(numbered(k), !numless.has(k))
})

Deno.test('the wire cannot set num — it stays server-owned', () => {
  let e = uid()
  apply(db, [
    { eid: e, name: 'doc', comp: { title: 'x' } },
    { eid: e, name: 'entity', comp: { num: 999999 } }, // dropped by admitted()
  ])
  assertNotEquals(Number(comp(e, 'entity')?.num), 999999)
})

Deno.test('a deleted number is never reused — remint is strictly higher', () => {
  let a = uid()
  apply(db, [{ eid: a, name: 'doc', comp: { title: 'high' } }])
  let n1 = Number(comp(a, 'entity')?.num)
  apply(db, [{ eid: a, name: 'entity', comp: null }]) // delete the highest
  let b = uid()
  apply(db, [{ eid: b, name: 'doc', comp: { title: 'next' } }])
  assertEquals(Number(comp(b, 'entity')?.num) > n1, true) // tombstone.num holds the high-water
})

// A num-less entity stands in for a future cheap kind (T-3683): spine() with no
// num, no mint pass. It must be addressable by uuid, render a short-eid handle
// (not T-0), and resolve back through every read door.
Deno.test('a num-less entity: short-eid handle renders and resolves', () => {
  let e = 'dead1234-0000-4000-8000-00000000cafe'
  db.prepare('insert into entity (eid) values (?)').run(e)
  db.prepare('insert into doc (eid, title) values (?, ?)').run(e, 'cheap')
  assertEquals(human(db, e), 'dead1234') // the 8-hex handle, never T-0
  assertEquals(human(db, e), shortId(e))
  // the handle round-trips through the shared resolver and its doors
  assertEquals(resolveId(db, 'dead1234'), e)
  assertEquals(locate(db, 'dead1234'), e)
  // a full uuid still exact-matches
  assertEquals(resolveId(db, e), e)
})

Deno.test('an ambiguous short-eid prefix is refused, naming the collision', () => {
  let a = 'abcabc11-0000-4000-8000-000000000001'
  let b = 'abcabc22-0000-4000-8000-000000000002'
  db.prepare('insert into entity (eid) values (?)').run(a)
  db.prepare('insert into entity (eid) values (?)').run(b)
  assertThrows(() => resolveId(db, 'abcabc'), Error, 'ambiguous')
  assertEquals(resolveId(db, 'abcabc11'), a) // a longer, unique prefix resolves
})

Deno.test('num order is preserved: T-3 and a bare num still resolve', () => {
  let t = uid()
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'addressed' } }])
  let n = Number(comp(t, 'entity')?.num)
  assertEquals(resolveId(db, `T-${n}`), t) // prefixed num
  assertEquals(resolveId(db, String(n)), t) // bare num, never shadowed by hex
})

// T-17322: a project SHOULD BE its own board. migrateBoardsToProjects folds a
// legacy separate `.project=<uuid>` board into its project, repoints any
// card/fold that viewed it, and tombstones the board — leaving real filtered
// views alone, and a re-run a no-op.
slow(
  'migrateBoardsToProjects: a whole-project board collapses into its project',
  () => {
    let d = fresh()
    let project = uid()
    apply(d, [
      { eid: project, name: 'doc', comp: { title: 'Widgets', body: '' } },
      { eid: project, name: 'project', comp: {} },
    ])
    let board = uid()
    apply(d, [
      { eid: board, name: 'doc', comp: { title: 'widgets', body: '' } },
      { eid: board, name: 'board', comp: { query: `.project=${project}` } },
    ])
    let card = uid()
    apply(d, [
      { eid: card, name: 'card', comp: { target: board, view: 'Board' } },
    ])

    migrateBoardsToProjects(d)

    // the project now IS the board, carrying the same query
    assertEquals(compOf(d, project, 'board')?.query, `.project=${project}`)
    // the card was repointed onto the project — view preserved (patch, not rebuild)
    assertEquals(compOf(d, card, 'card')?.target, project)
    assertEquals(compOf(d, card, 'card')?.view, 'Board')
    // the redundant board entity is tombstoned
    assertEquals(compOf(d, board, 'board'), undefined)
    assertEquals(
      !!d.prepare('select 1 from tombstone where eid = ?').get(board),
      true,
    )

    // idempotent: a second run finds no mirror and changes nothing
    let before = snapshot(d).changes.length
    migrateBoardsToProjects(d)
    assertEquals(snapshot(d).changes.length, before)
  },
)

slow('migrateBoardsToProjects: a filtered board is left alone', () => {
  let d = fresh()
  let project = uid()
  apply(d, [
    { eid: project, name: 'doc', comp: { title: 'Widgets', body: '' } },
    { eid: project, name: 'project', comp: {} },
  ])
  // a real filtered view: project AND a status — not a whole-project mirror
  let filtered = uid()
  apply(d, [
    { eid: filtered, name: 'doc', comp: { title: 'open widgets', body: '' } },
    {
      eid: filtered,
      name: 'board',
      comp: { query: `.project=${project}&.status=open` },
    },
  ])
  // a whole-project board whose target isn't a live project: also left alone
  let orphan = uid()
  apply(d, [
    { eid: orphan, name: 'doc', comp: { title: 'ghost', body: '' } },
    { eid: orphan, name: 'board', comp: { query: `.project=${uid()}` } },
  ])

  migrateBoardsToProjects(d)

  assertEquals(compOf(d, project, 'board'), undefined) // project untouched
  assertEquals(!!compOf(d, filtered, 'board'), true) // filtered survives
  assertEquals(!!compOf(d, orphan, 'board'), true) // orphan survives
})
