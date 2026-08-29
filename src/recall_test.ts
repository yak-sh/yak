// recall.ts's pure seam (v2, T-17470): which in-scope thoughts float for a query
// vector — per-kind budgets + floors, the scope split (memories fleet-wide,
// tasks scoped to the actor's project), dedup against what a session has seen.
// Precomputed vectors only; the embedder never loads (a test that downloads a
// model isn't one), mirroring embed_test. The selection tests rank through the
// real vector extension, so they run on an isolated vectorDb() (no other test's
// vectors crowd a per-kind budget) and are slow() — the extension's quantize is
// heavy. The effect tests use the module db with an injected recall fn, so no
// embedder and no KNN, and stay in the fast tier.
Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let { hash, MODEL } = await import('./embed.ts')
let { recallEntry, recallFrom } = await import('./recall.ts')
let { vectorDb } = await import('./testdb.ts')
let { axes } = await import('./testvec.ts')
let { slow } = await import('./testing.ts')
let { assertEquals } = await import('@std/assert')
import type { DatabaseSync } from './sqlite.ts'

let uid = (): string => crypto.randomUUID()
// Component/edge tables are keyed by the integer `entity` spine id now; eids stay
// the wire identity, so raw SQL translates at the boundary.
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`
// A unit vector — cosine against another unit vector is their dot product, so a
// test places a candidate at a KNOWN score: same direction scores 1.0, and
// vec(c, √(1−c²)) scores exactly c against vec(1, 0). The coordinates ride a
// dense basis (testvec.ts) at full dimensionality, so the vector extension's
// ANN index ranks them like real embeddings (cosines preserved to ~0.005).
let vec = (...xs: number[]) => axes(...xs)
let put = (d: DatabaseSync, eid: string, text: string, v: Float32Array) =>
  d.prepare('insert into embedding (eid, model, hash, vec) values (?, ?, ?, ?)')
    .run(eid, MODEL, hash(text), new Uint8Array(v.buffer))

// Graph parts through apply() (the real writer mints the spine); the vector
// beside it through put() (embeddings come from the sweep, never a patch).
let mem = (d: DatabaseSync, title: string, v: Float32Array, scope?: string) => {
  let e = uid()
  apply(d, [
    { eid: e, name: 'doc', comp: { title, body: '' } },
    { eid: e, name: 'memory', comp: scope ? { scope } : {} },
  ])
  put(d, e, title, v)
  return e
}
let proj = (d: DatabaseSync) => {
  let e = uid()
  apply(d, [{ eid: e, name: 'project', comp: {} }])
  return e
}
let taskIn = (
  d: DatabaseSync,
  title: string,
  v: Float32Array,
  project: string,
) => {
  let e = uid()
  apply(d, [
    { eid: e, name: 'doc', comp: { title, body: '' } },
    { eid: e, name: 'task', comp: { project } },
  ])
  put(d, e, title, v)
  return e
}
// A plain doc (a design/persona/prior-session stands in the same catch-all
// `doc` bucket): titled + embedded but neither task nor memory.
let plain = (d: DatabaseSync, title: string, v: Float32Array) => {
  let e = uid()
  apply(d, [{ eid: e, name: 'doc', comp: { title, body: '' } }])
  put(d, e, title, v)
  return e
}

slow('recallFrom: a memory, an in-scope task, and a doc each float', () => {
  let d = vectorDb()
  let p = proj(d)
  let m = mem(d, 'a memory due east', vec(1, 0))
  let t = taskIn(d, 'a task due east', vec(1, 0), p)
  let doc = plain(d, 'a doc due east', vec(1, 0))
  let ids = recallFrom(d, vec(1, 0), p).map((f) => f.eid)
  assertEquals(ids.includes(m), true)
  assertEquals(ids.includes(t), true)
  assertEquals(ids.includes(doc), true)
})

slow('recallFrom: an out-of-scope task never floats', () => {
  let d = vectorDb()
  let mine = proj(d)
  let other = proj(d)
  let m = mem(d, 'my fleet memory', vec(1, 0))
  let t = taskIn(d, 'a task in another venture', vec(1, 0), other)
  let ids = recallFrom(d, vec(1, 0), mine).map((f) => f.eid)
  assertEquals(ids.includes(m), true) // recall still works
  assertEquals(ids.includes(t), false) // but the foreign ticket stays down
})

slow('recallFrom: each kind screens at its own floor', () => {
  let d = vectorDb()
  let p = proj(d)
  // Both sit at cosine 0.65 to the query — above the memory floor (0.55),
  // below the task floor (0.70). Same score, different verdict.
  let at65 = vec(0.65, Math.sqrt(1 - 0.65 ** 2))
  let m = mem(d, 'a memory at 0.65', at65)
  let t = taskIn(d, 'a task at 0.65', at65, p)
  let ids = recallFrom(d, vec(1, 0), p).map((f) => f.eid)
  assertEquals(ids.includes(m), true) // clears the memory floor
  assertEquals(ids.includes(t), false) // below the task floor — token noise
})

slow('recallFrom: a per-kind budget caps that kind', () => {
  let d = vectorDb()
  // Three near memories, one direction; the memory budget is 2, so one is left.
  let ms = [
    mem(d, 'budget a', vec(1, 0)),
    mem(d, 'budget b', vec(1, 0)),
    mem(d, 'budget c', vec(1, 0)),
  ]
  let got = recallFrom(d, vec(1, 0))
  assertEquals(got.length, 2)
  assertEquals(got.every((f) => ms.includes(f.eid)), true)
})

slow('recallFrom: a seen thought does not float again', () => {
  let d = vectorDb()
  let m = mem(d, 'already surfaced this session', vec(1, 0))
  let ids = recallFrom(d, vec(1, 0), undefined, new Set([m])).map((f) => f.eid)
  assertEquals(ids.includes(m), false)
})

slow('recallFrom: an unplaced session floats globals only', () => {
  let d = vectorDb()
  let p = proj(d)
  let m = mem(d, 'a fleet-wide principle', vec(1, 0)) // unscoped memory
  let t = taskIn(d, 'an in-project ticket', vec(1, 0), p)
  let ids = recallFrom(d, vec(1, 0), undefined).map((f) => f.eid)
  assertEquals(ids.includes(m), true) // a principle rides anywhere
  assertEquals(ids.includes(t), false) // no project → no scoped ticket
})

slow('recallFrom: a scoped memory floats only in its own project', () => {
  let d = vectorDb()
  let mine = proj(d)
  let other = proj(d)
  let m = mem(d, 'a lesson learned elsewhere', vec(1, 0), other)
  assertEquals(
    recallFrom(d, vec(1, 0), mine).map((f) => f.eid).includes(m),
    false,
  )
  assertEquals(
    recallFrom(d, vec(1, 0), other).map((f) => f.eid).includes(m),
    true,
  )
})

slow('recallFrom: a floater names its id and title', () => {
  let d = vectorDb()
  let m = mem(d, 'the graph is your mind', vec(1, 0))
  let f = recallFrom(d, vec(1, 0)).find((f) => f.eid == m)!
  assertEquals(f.title, 'the graph is your mind')
  assertEquals(f.id.startsWith('M-'), true)
})

// The effect's orchestration — driven with an injected recall fn so no embedder
// loads; the selection itself is proven by the recallFrom tests above. These use
// the module db, because recallEntry closes over it.
let sess = () => {
  let eid = uid()
  db.prepare('insert into entity (eid, num) values (?, ?)').run(
    eid,
    Math.floor(Math.random() * 1e9),
  )
  db.prepare(`insert into session (entity, id) values (${idOf}, ?)`).run(
    eid,
    uid(),
  )
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
  let m = mem(db, 'escalation is a bug report', vec(0.9, 0.1))
  let msg = msgEntry(s, 'should I escalate this to the owner?')
  await recallEntry(noop, saysM(m, 'M-42', 'escalation is a bug report'))(msg)

  let rec = db.prepare(
    `select o.eid as eid, c.body as body, ${refEid('e.session')} as session
       from recalled r
       join entity o on o.id = r.entity
       join content c on c.entity = r.entity
       join entry e on e.entity = r.entity
      where r.source = ${idOf}`,
  ).get(msg) as { eid: string; body: string; session: string } | undefined
  assertEquals(rec?.session, s) // in the message's session partition
  assertEquals(rec!.body.includes('M-42'), true)
  assertEquals(rec!.body.includes('escalation is a bug report'), true)
  // a `recalled` edge to the surfaced memory — the dedup ledger
  let edge = db.prepare(
    `select 1 from dependency where parent = ${idOf} and type = 'recalled' and child = ${idOf}`,
  ).get(rec!.eid, m)
  assertEquals(!!edge, true)
})

Deno.test('recallEntry: recall cannot recall itself — a recall entry carries no message facet', async () => {
  let s = sess()
  let m = mem(db, 'a floating thought', vec(0.5, 0.5))
  let msg = msgEntry(s, 'a thought that floats')
  await recallEntry(noop, saysM(m, 'M-7', 'a floating thought'))(msg)
  let rec = db.prepare(
    `select o.eid as eid from recalled r join entity o on o.id = r.entity
      where r.source = ${idOf}`,
  ).get(msg) as
    | { eid: string }
    | undefined
  // no `message` row on the recall entry → on('message') never fires on it
  assertEquals(
    !!db.prepare(`select 1 from message where ${OWNED}`).get(rec!.eid),
    false,
  )
})

Deno.test('recallEntry: idempotent — a message already recalled is not doubled', async () => {
  let s = sess()
  let m = mem(db, 'do not double me', vec(0.3, 0.7))
  let msg = msgEntry(s, 'a message that fires twice')
  let fn = saysM(m, 'M-9', 'do not double me')
  await recallEntry(noop, fn)(msg)
  await recallEntry(noop, fn)(msg) // second fire (a sweep, a re-dispatch)
  let n = db.prepare(
    `select count(*) as n from recalled where source = ${idOf}`,
  )
    .get(msg) as { n: number }
  assertEquals(n.n, 1)
})

Deno.test('recallEntry: per-session dedup — a floated thought is passed as seen next time', async () => {
  let s = sess()
  let m = mem(db, 'surfaced once already', vec(0.2, 0.9))
  let first = msgEntry(s, 'first message')
  await recallEntry(noop, saysM(m, 'M-5', 'surfaced once already'))(first)
  // the second message's recall must see the thought floated by the first —
  // the seen set is the 4th arg now (db, text, scope, seen)
  let seenPassed: Set<string> | null = null
  let spy = (
    _db: unknown,
    _t: string,
    _scope: string | undefined,
    seen: Set<string>,
  ) => {
    seenPassed = seen
    return Promise.resolve([])
  }
  let second = msgEntry(s, 'second message')
  await recallEntry(noop, spy as never)(second)
  assertEquals(seenPassed !== null && (seenPassed as Set<string>).has(m), true)
})
