// apply()/snapshot() semantics against an in-memory db — the wire's
// contract: patches, creates, deletes, tombstones, and the claim lease.
Deno.env.set('DB_PATH', ':memory:')
let {
  apply,
  db,
  journalOf,
  mendMail,
  open,
  search,
  snapshot,
  touch,
  vocabularyDoc,
} = await import(
  './db.ts'
)
let { assertEquals, assertMatch, assertThrows } = await import(
  '@std/assert'
)

let fresh = () => open() // each test file shares one :memory: handle; use eids per test
let uid = () => crypto.randomUUID()

let comp = (eid: string, name: string) =>
  snapshot(db).changes.find((c) => c.eid == eid && c.name == name)?.comp

Deno.test('create + patch + column clear', () => {
  let t = uid()
  apply(db, [
    { eid: t, name: 'doc', comp: { title: 'A', body: 'b' } },
    { eid: t, name: 'task', comp: { status: 'open' } },
  ])
  assertEquals(comp(t, 'doc')?.title, 'A')
  assertEquals(comp(t, 'task')?.priority, 0) // schema default
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

Deno.test('unknown component names are ignored, batch survives', () => {
  let t = uid()
  apply(db, [
    { eid: t, name: 'hovercraft', comp: { eels: 9 } },
    { eid: t, name: 'doc', comp: { title: 'ok' } },
  ])
  assertEquals(comp(t, 'doc')?.title, 'ok')
})

Deno.test('server-owned columns never ride the wire', () => {
  let t = uid()
  apply(db, [{
    eid: t,
    name: 'web',
    comp: { url: 'http://x', frozen_at: 'FAKE' },
  }])
  assertEquals(comp(t, 'web')?.frozen_at, null)
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

Deno.test('modified_at: server-stamped on every touch, never wire-set', () => {
  let t = uid()
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'aging' } }])
  let born = comp(t, 'entity')?.modified_at
  assertEquals(typeof born, 'string')
  apply(db, [{
    eid: t,
    name: 'entity',
    comp: { modified_at: 'FAKE' }, // spine has no writable columns
  }])
  assertEquals(comp(t, 'entity')?.modified_at == 'FAKE', false)
  apply(db, [{ eid: t, name: 'doc', comp: { title: 'aged' } }])
  assertEquals(String(comp(t, 'entity')?.modified_at) >= String(born), true)
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

Deno.test('keep: a dead author leaves the byline standing', () => {
  let who = uid(), target = uid(), c = uid()
  apply(db, [
    { eid: target, name: 'doc', comp: { title: 'subject' } },
    { eid: who, name: 'session', comp: { id: `bye-${who}` } },
    { eid: c, name: 'doc', comp: { title: '', body: 'said once' } },
    { eid: c, name: 'comment', comp: { target_eid: target, author_eid: who } },
  ])
  apply(db, [{ eid: who, name: 'entity', comp: null }])
  // history, not a dangle: the words stay attributed to the dead session
  assertEquals(comp(c, 'comment')?.author_eid, who)
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

Deno.test('edges: bad type and missing endpoint drop alone, loudly', () => {
  let p = uid(), c = uid()
  apply(db, [
    { eid: p, name: 'doc', comp: { title: 'solid' } },
    { eid: c, name: 'doc', comp: { title: 'other' } },
    { eid: p, name: 'dependency', comp: { type: 'blocks', child_eid: c } },
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
  assertEquals(eids('quokka .status=open .modified_at=today'), [b])
  assertEquals(eids('quokka .modified_at=yesterday'), [])
  // filters alone are a listing, newest touched first
  assertEquals(eids('.status=done .modified_at>=today').includes(a), true)
  assertEquals(eids('.status=done .modified_at>=today').includes(b), false)
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

Deno.test('memory: writable face rides in, confirmation never does', () => {
  let m = uid(), s = uid(), p = uid()
  apply(db, [
    { eid: s, name: 'session', comp: { id: `sess-${s}` } },
    { eid: p, name: 'doc', comp: { title: 'a venture' } },
    { eid: p, name: 'project', comp: {} },
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
  ])
  let row = comp(m, 'memory')
  assertEquals(row?.type, 'feedback')
  assertEquals(row?.source_eid, s)
  assertEquals(row?.scope_eid, p)
  assertEquals(row?.last_confirmed_at, null) // server-owned
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

Deno.test('journal: one row per batch, attributed; a rollback leaves none', () => {
  let t = uid(), before = journalCount()
  apply(
    db,
    [{ eid: t, name: 'doc', comp: { title: 'recorded' } }],
    undefined,
    'tester',
  )
  assertEquals(journalCount(), before + 1)
  let row = db.prepare('select actor, batch from journal order by rowid desc')
    .get() as { actor: string; batch: string }
  assertEquals(row.actor, 'tester')
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
  apply(db, [
    { eid: t, name: 'task', comp: { status: 'done' } },
    { eid: c, name: 'doc', comp: { title: '', body: 'proof landed' } },
    { eid: c, name: 'comment', comp: { target_eid: t, author_eid: s } },
  ])
  assertEquals(comp(t, 'task')?.status, 'done')
  assertEquals(comp(c, 'doc')?.body, 'proof landed')
  assertEquals(comp(c, 'comment')?.author_eid, s)
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
