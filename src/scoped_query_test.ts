// The equivalence spine (T-21151): evalGraph now answers a declining or hot
// query by SCOPED SQL — whereSome() narrows to a candidate row set through the
// index and the JS matcher refines it — instead of materializing the whole
// graph with snapshot() and filtering it (M-21143, the banned snapshot). This
// file is the proof that the swap is ROW-IDENTICAL: for every grammar feature in
// query.ts and a set of real board queries, the scoped answer must equal the old
// materialized-filter answer. `viaSnapshot` below IS that old path, kept here as
// the reference definition; a compiler that "looks right" and one that IS right
// are indistinguishable from the inside, so nothing here hand-writes an expected
// set — both readers answer the SAME line and the two answers are held together.
//
// This is the review the owner asked for as structure rather than a sign-off: it
// runs in the gate forever, so a future edit that makes whereSome() or the
// refinement disagree with the whole-graph matcher fails here, loudly.
import { assertEquals } from '@std/assert'
import { uuid } from './types.ts'
import { evalFast, evalGraph, rowed } from './graph_query.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, snapshot, entriesOf, entriesScan, textMatches } = await import(
  './db.ts'
)
let { open } = await import('./store/sqlite.ts')
let { append } = await import('./entries.ts')
let { freshDb } = await import('./testdb.ts')
let { rows, find } = await import('./client.ts')
let {
  parseQuery,
  resolveRefs,
  namesLazy,
  scopedSessions,
  matchQuery,
  selected,
  kidsOf,
  orderOf,
} = await import('./query.ts')

// The OLD evalQuery, verbatim: snapshot the whole graph, add the lazy entry
// universe when the query names the partition, and screen every row through the
// JS matcher over an in-memory reverse index — `selected` being the listing
// screens (quarantine, and the store's content-addressed blob rows). This is
// the definition evalGraph's scoped path must reproduce exactly.
type DB = ReturnType<typeof open>
let viaSnapshot = (db: DB, q: string, after = 0, limit = 500) => {
  let snap = snapshot(db)
  let all = rows(snap, true)
  let preds = resolveRefs(parseQuery(q), (id: string) => find(all, id)?.eid)
  if (namesLazy(preds)) {
    let sessions = scopedSessions(preds)
    let got = sessions.length
      ? sessions.flatMap((s) => entriesOf(db, s, after, limit))
      : entriesScan(db, after, limit)
    all = [...all, ...got.map((e) => rowed({ eid: e.eid, comps: e.comps }))]
  }
  let byEid = new Map(all.map((r) => [r.eid, r.comps]))
  let kids = kidsOf(byEid)
  return all.filter((r) =>
    selected(r.comps, preds) &&
    matchQuery(
      r.comps,
      preds,
      (e) => byEid.get(e),
      undefined,
      kids,
      undefined,
      (eid, p) => textMatches(db, eid, p),
    )
  ).map((r) => r.eid)
}

let sorted = (xs: string[]) => [...xs].sort()

// The scoped door and the reference agree on the SET of matched rows (order is
// asserted separately where it is deterministic). A time query rides the wall
// clock, so both sides read the same graph within the same millisecond band —
// they call snapshot()/matching() against one frozen db, no write between.
let same = (db: DB, q: string, after = 0, limit = 500) => {
  let got = evalGraph(db, q, { after, limit }).hits.map((h) => h.eid)
  let want = viaSnapshot(db, q, after, limit)
  assertEquals(sorted(got), sorted(want), `set mismatch for: ${q || '(empty)'}`)
  // evalGraph defines ORDER only on the index branch (a fully-compilable,
  // non-hot, non-entry query → num-ascending); the declining fallback returns
  // component-table order and the old snapshot path never guaranteed more.
  // Assert num order exactly where evalGraph promises it — the same branch
  // evalGraph itself takes — and set-equality carries the rest.
  let fast = evalFast(db, q)
  if (fast && orderOf(fast.preds) != 'hot' && !fast.entries) {
    let ordered = evalGraph(db, q, { after, limit }).hits.map((h) => h.num)
    assertEquals(ordered, [...ordered].sort((a, b) => a - b), `num order: ${q}`)
  }
}

// A broad, adversarial graph: tasks across every status/priority, an assignee
// and a project to deref through, comments to walk in reverse, a board, a
// memory, plus a live session log for the lazy partition. Seeded through apply()
// so values normalize exactly as the wire stores them. Built ONCE and shared —
// every case here is read-only (both paths only read), so one seed serves the
// whole battery and the fast tier pays freshDb+apply a single time.
let world = () => {
  let db = freshDb()
  let jeff = uuid(), pri = uuid(), P = uuid()
  let t1 = uuid(), t2 = uuid(), t3 = uuid(), t4 = uuid(), t5 = uuid()
  let c1 = uuid(), c2 = uuid(), bd = uuid(), mem = uuid(), sw = uuid()
  apply(db, [
    { eid: jeff, name: 'doc', comp: { title: 'Jeff Peterson', body: '' } },
    { eid: jeff, name: 'client', comp: { user_agent: 'cli' } },
    { eid: pri, name: 'doc', comp: { title: 'Priya', body: '' } },
    { eid: pri, name: 'client', comp: { user_agent: 'cli' } },
    { eid: P, name: 'doc', comp: { title: 'Platform', body: 'the core' } },
    { eid: P, name: 'project', comp: { color: 'green' } },
    // t1: open/P0, assigned jeff, in project P, two comments
    {
      eid: t1,
      name: 'doc',
      comp: { title: 'widget crash', body: 'boom on boot' },
    },
    {
      eid: t1,
      name: 'task',
      comp: {
        priority: 0,
        project: P,
        assignee: jeff,
        domain: 'Eng',
      },
    },
    // t2: wip/P1, assigned priya, project P — status is DERIVED (D-24102):
    // wip = a live claim, so seed a session and claim it.
    { eid: sw, name: 'session', comp: { id: uuid() } },
    {
      eid: t2,
      name: 'doc',
      comp: { title: 'ledger sync', body: 'reconcile widgets' },
    },
    {
      eid: t2,
      name: 'task',
      comp: {
        priority: 1,
        project: P,
        assignee: pri,
        domain: 'Eng',
      },
    },
    { eid: t2, name: 'claim', comp: { session: sw } },
    // t3: done/P2, no project, no assignee — done = a completed mark
    { eid: t3, name: 'doc', comp: { title: 'archive old', body: '' } },
    {
      eid: t3,
      name: 'task',
      comp: { priority: 2, domain: 'Ops' },
    },
    { eid: t3, name: 'completed', comp: {} },
    // t4: open/P3, assigned jeff, no project
    {
      eid: t4,
      name: 'doc',
      comp: { title: 'widget polish', body: 'round the corners' },
    },
    {
      eid: t4,
      name: 'task',
      comp: { priority: 3, assignee: jeff, domain: '' },
    },
    // t5: cancelled/P1, project P — cancelled = a cancelled mark
    { eid: t5, name: 'doc', comp: { title: 'dead end', body: '' } },
    {
      eid: t5,
      name: 'task',
      comp: { priority: 1, project: P, domain: 'Ops' },
    },
    { eid: t5, name: 'cancelled', comp: {} },
    // comments on t1, authored by the two clients
    { eid: c1, name: 'doc', comp: { title: '', body: 'seen it too' } },
    { eid: c1, name: 'comment', comp: { target: t1 } },
    { eid: c2, name: 'doc', comp: { title: '', body: 'fixed in prod' } },
    { eid: c2, name: 'comment', comp: { target: t1 } },
    // a board and a memory — other kinds in the mix
    { eid: bd, name: 'doc', comp: { title: 'Open Eng', body: '' } },
    { eid: bd, name: 'board', comp: { query: '.status=open&.domain=Eng' } },
    { eid: mem, name: 'doc', comp: { title: 'a lesson', body: 'widgets rot' } },
    { eid: mem, name: 'memory', comp: { scope: P } },
  ])
  // A live session log — the lazy entry partition.
  let s = uuid()
  apply(db, [{ eid: s, name: 'session', comp: { id: uuid() } }])
  let { eids: [e1] } = append(db, s, [
    { message: { role: 'user' }, content: { body: 'kick it off' } },
  ])
  append(db, s, [{
    generation: { provider: 'codex', model: 'gpt-5', through: e1 },
  }])
  append(db, s, [{ call: { key: 'c1' }, bash: { command: 'ls widgets' } }])
  append(db, s, [{ response: { status: 500 }, content: { body: 'boom' } }])
  return { db, jeff, pri, P, t1, t2, t3, t4, t5, c1, c2, bd, mem, s }
}

// Seeded ONCE for the whole battery — every case is read-only.
let W = world()
let db = W.db

// The grammar, split by theme so no single test dwarfs the fast tier's db-test
// band while the whole battery still rides the pre-land gate (it IS the review).
let battery = (name: string, lines: string[]) =>
  Deno.test(`scoped SQL == materialized filter: ${name}`, () => {
    for (let q of lines) same(db, q)
  })

battery('equality, lists, ranges, comparisons', [
  '', // empty — every entity
  '.status=open',
  '.status=open,wip',
  '.status=open,wip,cancelled',
  '.priority=0..2',
  '.priority=0...2',
  '.priority=1',
  '.status!=done',
  '.status!=open,wip',
  '.title~=widget',
  '.priority<=1',
  '.priority<1',
  '.priority>=2',
  '.priority>1',
])

battery('presence, absence, explicit component spelling', [
  '.assignee=',
  '.assignee!',
  '.project=',
  '.task!',
  '.task=',
  '.project!',
  '.task.status=open',
  '.doc.title~=widget',
  '.task.domain=Eng',
])

battery('derived kind (present comp AND every earlier absent)', [
  '.kind=task',
  '.kind=comment',
  '.kind=board',
  '.kind=project',
  '.kind=memory',
  '.kind=session',
])

battery('bare-word text', [
  'widget',
  'widgets',
  'wi', // sub-trigram — declines the index, matcher answers
  '"boom on boot"',
])

battery('path predicates (deref joins, refined in JS)', [
  '.assignee.title~=jeff',
  '.assignee.title=Jeff Peterson',
  '.task.project.doc.title~=platform',
  '.project.color=green',
  '.comment.target.doc.title~=widget', // deep: comment → target task → title
])

battery('reverse hops and the backlink union', [
  '.comments!',
  '.comments=',
  '.comments>=1',
  '.comments>=2',
  '.comments>=3',
  '.comments.doc.body~=fixed',
  '.comments!.doc.body~=nope',
  `.refs=${W.P}`,
  `.refs=${W.t1}`,
  '.refs!',
  '.refs=',
])

battery('aggregate / projection selectors and mixed conjunctions', [
  '.distinct=status',
  '.tally=domain',
  '.fields=task.status',
  '.fields=task.status,task.priority',
  '.status=open .assignee.title~=jeff',
  '.kind=task .task.project.doc.title~=platform',
  '.status=open,wip .comments>=1',
  '.title~=widget .priority<=1',
])

battery('the lazy entry partition', [
  `.entry.session=${W.s}`,
  '.generation.provider=codex',
  '.response.status>=400',
  `.entry.session=${W.s} .content.body~=boom`,
  `.entry.session=${W.s} .bash.command~=widgets`,
])

battery('hot ranking (membership; order rides the wall clock)', [
  '.order=hot',
  '.order=hot .status=open',
  '.kind=task .order=hot',
])

// Real board queries drawn from the fleet's saved-board shapes — not just the
// synthetic grammar cases.
battery('real board queries', [
  '.status=open,wip',
  '.status=open&.domain=Eng',
  '.kind=task&.status=open,wip&.priority<=1',
  '.status=open,wip&.assignee!',
  '.kind=task&.updated.at>=today',
  '.status!=done,cancelled',
  '.project!&.status=open',
  '.order=hot&.status=open,wip',
  '.kind=memory',
  '.kind=board',
])

// Time phrases are a declining class (a span is a moving window) — the scoped
// fallback must answer them identically to the whole-graph matcher.
battery('time phrases', [
  '.updated.at>=today',
  '.updated.at=today',
  '.created.at=today',
  '.created.at>=today',
  '.updated.at<yesterday',
  '.created.at>"1 hour ago"',
  '.updated.at<=now',
  '.status=open .updated.at>=today',
])

// Paging the lazy partition must page identically through both doors.
Deno.test('scoped SQL == materialized filter: paging entries', () => {
  for (let [after, limit] of [[0, 2], [2, 2], [0, 10], [1, 1], [3, 5]]) {
    same(db, `.entry.session=${W.s}`, after, limit)
  }
})
