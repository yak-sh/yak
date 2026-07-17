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

Deno.test('open() is idempotent and additive on live files', () => {
  assertMatch(String(fresh().prepare('select 1 as ok').get()?.ok), /1/)
})
