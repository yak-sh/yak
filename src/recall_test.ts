// recall.ts's pure seam: which MEMORIES float up for a query vector — the memory
// filter (never a plain doc), the noise floor, dedup against what a session has
// already seen, and the top-N cap. Precomputed vectors only; the embedder never
// loads (a test that downloads a model isn't one), mirroring embed_test. The
// shared :memory: db holds other tests' vectors, so every assertion screens to
// the eids this test made.
Deno.env.set('DB_PATH', ':memory:')
let { apply, db } = await import('./db.ts')
let { hash } = await import('./embed.ts')
let { recallEntry, recallFrom } = await import('./recall.ts')
let { assertEquals } = await import('@std/assert')

let uid = (): string => crypto.randomUUID()
let ent = (eid: string) =>
  db.prepare('insert into entity (eid, num) values (?, ?)').run(
    eid,
    Math.floor(Math.random() * 1e9),
  )
let vec = (...xs: number[]) => {
  let n = Math.hypot(...xs)
  return Float32Array.from(xs.map((x) => x / n))
}
let put = (eid: string, text: string, v: Float32Array) =>
  db.prepare(
    'insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)',
  ).run(eid, 'Xenova/bge-small-en-v1.5', hash(text), new Uint8Array(v.buffer))
// A memory: a titled doc entity carrying the memory component + a vector.
let mem = (title: string, v: Float32Array) => {
  let eid = uid()
  ent(eid)
  db.prepare('insert into doc (eid, title, body) values (?, ?, ?)').run(
    eid,
    title,
    '',
  )
  db.prepare('insert into memory (eid) values (?)').run(eid)
  put(eid, title, v)
  return eid
}
// A plain doc (task-like): titled + embedded but NOT a memory.
let plain = (title: string, v: Float32Array) => {
  let eid = uid()
  ent(eid)
  db.prepare('insert into doc (eid, title, body) values (?, ?, ?)').run(
    eid,
    title,
    '',
  )
  put(eid, title, v)
  return eid
}

Deno.test('recallFrom: only memories float up, never plain docs', () => {
  let m = mem('a memory due east', vec(1, 0))
  let p = plain('a task due east', vec(1, 0)) // same direction, but not a memory
  let ids = recallFrom(db, vec(1, 0), 8, 0.5).map((f) => f.eid)
  assertEquals(ids.includes(m), true)
  assertEquals(ids.includes(p), false)
})

Deno.test('recallFrom: below the floor never floats', () => {
  let orth = mem('orthogonal to the query', vec(0, 1)) // dot 0 with (1,0)
  let ids = recallFrom(db, vec(1, 0), 8, 0.5).map((f) => f.eid)
  assertEquals(ids.includes(orth), false)
})

Deno.test('recallFrom: a seen memory does not float again', () => {
  let m = mem('already surfaced this session', vec(0.6, 0.8))
  let ids = recallFrom(db, vec(0.6, 0.8), 8, 0.5, new Set([m])).map((f) =>
    f.eid
  )
  assertEquals(ids.includes(m), false)
})

Deno.test('recallFrom: capped at limit', () => {
  // A distinctive direction no other test uses (5,12), so only these three
  // score near 1.0 — top-2 by score are ours, proving the cap without the
  // shared db intruding.
  let a = mem('cap a', vec(5, 12))
  let b = mem('cap b', vec(5, 12))
  let c = mem('cap c', vec(5, 12))
  let got = recallFrom(db, vec(5, 12), 2, 0.9)
  assertEquals(got.length, 2)
  assertEquals(got.every((f) => [a, b, c].includes(f.eid)), true)
})

Deno.test('recallFrom: a floater names its M-id and title', () => {
  let m = mem('the graph is your mind', vec(0.8, 0.6))
  let f = recallFrom(db, vec(0.8, 0.6), 8, 0.5).find((f) => f.eid == m)!
  assertEquals(f.title, 'the graph is your mind')
  assertEquals(f.id.startsWith('M-'), true)
})

// The effect's orchestration — driven with an injected recall fn so no embedder
// loads; the selection itself is proven by the recallFrom tests above.
let sess = () => {
  let eid = uid()
  ent(eid)
  db.prepare('insert into session (eid, id) values (?, ?)').run(eid, uid())
  return eid
}
let msgEntry = (session: string, text: string, role = 'user') => {
  let eid = uid()
  apply(db, [
    { eid, name: 'entry', comp: { session } },
    { eid, name: 'message', comp: { role } },
    { eid, name: 'content', comp: { body: text } },
  ])
  return eid
}
let noop = () => {}
let saysM = (eid: string, id: string, title: string) => () =>
  Promise.resolve([{ id, eid, title, score: 0.9 }])

Deno.test('recallEntry: a message writes a recall entry into its session, linked both ways', async () => {
  let s = sess()
  let m = mem('escalation is a bug report', vec(0.9, 0.1))
  let msg = msgEntry(s, 'should I escalate this to the owner?')
  await recallEntry(noop, saysM(m, 'M-42', 'escalation is a bug report'))(msg)

  let rec = db.prepare(
    `select r.eid, r.source, c.body, e.session from recalled r
       join content c on c.eid = r.eid
       join entry e on e.eid = r.eid
      where r.source = ?`,
  ).get(msg) as { eid: string; body: string; session: string } | undefined
  assertEquals(rec?.session, s) // in the message's session partition
  assertEquals(rec!.body.includes('M-42'), true)
  assertEquals(rec!.body.includes('escalation is a bug report'), true)
  // a `recalled` edge to the surfaced memory — the dedup ledger
  let edge = db.prepare(
    "select 1 from dependency where parent = ? and type = 'recalled' and child = ?",
  ).get(rec!.eid, m)
  assertEquals(!!edge, true)
})

Deno.test('recallEntry: recall cannot recall itself — a recall entry carries no message facet', async () => {
  let s = sess()
  let m = mem('a floating thought', vec(0.5, 0.5))
  let msg = msgEntry(s, 'a thought that floats')
  await recallEntry(noop, saysM(m, 'M-7', 'a floating thought'))(msg)
  let rec = db.prepare('select eid from recalled where source = ?').get(msg) as
    | { eid: string }
    | undefined
  // no `message` row on the recall entry → on('message') never fires on it
  assertEquals(
    !!db.prepare('select 1 from message where eid = ?').get(rec!.eid),
    false,
  )
})

Deno.test('recallEntry: idempotent — a message already recalled is not doubled', async () => {
  let s = sess()
  let m = mem('do not double me', vec(0.3, 0.7))
  let msg = msgEntry(s, 'a message that fires twice')
  let fn = saysM(m, 'M-9', 'do not double me')
  await recallEntry(noop, fn)(msg)
  await recallEntry(noop, fn)(msg) // second fire (a sweep, a re-dispatch)
  let n = db.prepare('select count(*) as n from recalled where source = ?')
    .get(msg) as { n: number }
  assertEquals(n.n, 1)
})

Deno.test('recallEntry: per-session dedup — a floated memory is passed as seen next time', async () => {
  let s = sess()
  let m = mem('surfaced once already', vec(0.2, 0.9))
  let first = msgEntry(s, 'first message')
  await recallEntry(noop, saysM(m, 'M-5', 'surfaced once already'))(first)
  // the second message's recall must see the memory floated by the first
  let seenPassed: Set<string> | null = null
  let spy = (
    _db: unknown,
    _t: string,
    _l: number,
    _f: number,
    seen: Set<string>,
  ) => {
    seenPassed = seen
    return Promise.resolve([])
  }
  let second = msgEntry(s, 'second message')
  await recallEntry(noop, spy as never)(second)
  assertEquals(seenPassed !== null && (seenPassed as Set<string>).has(m), true)
})
