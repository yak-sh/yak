// apply()/snapshot() semantics against an in-memory db — the wire's
// contract: patches, creates, deletes, tombstones, and the claim lease.
Deno.env.set('DB_PATH', ':memory:')
let { apply, db, open, search, snapshot } = await import('./db.ts')
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
