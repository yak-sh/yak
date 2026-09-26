/// <reference lib="deno.ns" />
// The defining test: the same corpus, the same queries, two evaluators.
//
// One side loads the bundles into a SQLite database through @yaks/sqlite and
// answers each query with the statement @yaks/sql compiles. The other holds the
// same bundles in an array and answers with this package. Every query must
// select the same entities, in the same order — that agreement is the whole
// promise: a filter written once means one thing wherever the data lives.

import { assertEquals, assertThrows } from '@std/assert'
import { open } from '@yaks/sqlite/db'
import type { Bundle } from './read.ts'
import { storage } from '@yaks/sqlite'
import { fields, schema as ftsSchema, search } from '@yaks/fts'
import { type Derived, type Extension, Unsupported } from '@yaks/sql'
import { compute, derived as taskDerived, taskDoc } from '@yaks/task'
import { projectDoc } from '@yaks/project'
import { edgeDoc, edgeKeywords, link, traverse } from '@yaks/edge'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { matcher, rows } from './match.ts'
import { bundles, corpus, DEAD, NOW, QUERIES, shop } from './testing.ts'

// Bundles in a fresh in-memory database, read through the vocabulary they were
// written under and whatever computed properties it declares.
//
// Straight into storage: this test is about reads, so it skips the graph's
// apply() and puts the rows where the two evaluators can be held against each
// other.
let loaded = (
  v: Vocab,
  rows: Bundle[],
  derived: Derived = {},
  extend: Extension[] = [],
) => {
  let db = open(':memory:')
  // Match the in-memory evaluator's doc-only text policy explicitly.
  let text = fields(v).filter((f) => f.comp == 'doc')
  let s = storage(
    db,
    v,
    { now: NOW, number: true, derived, extend: [...extend, search(text)] },
  )
  s.install()
  for (let stmt of ftsSchema(text)) db.query(stmt)
  s.tx((tx) => tx.patch(rows))
  return s
}

// The corpus, with the deleted entity deleted — `remove` tombstones it (it is a
// review nothing points at, so there is no cascade to decide).
let sql = () => {
  let s = loaded(shop, corpus)
  s.tx((tx) => tx.remove([{ eid: DEAD }]))
  return s
}

let eids = (bs: { entity: { eid: string } }[]) => bs.map((b) => b.entity.eid)

// A failure from the database side names the query that caused it — otherwise a
// broken statement arrives as a bare SQLite message with no way back to the line
// that produced it.
let fromSql = (s: ReturnType<typeof sql>, q: string) => {
  try {
    return s.read(q)
  } catch (e) {
    throw new Error(`@yaks/sql on ${q || '(empty)'}: ${(e as Error).message}`)
  }
}

// A query that names no ordering leaves the order to the evaluator: a database
// hands back whatever its plan yields, this package hands back the order it was
// given. Membership is what both promise there; order is compared for the
// queries that ask for one.
let asks = (q: string) => /\.order=|\.limit=|\.after=/.test(q)

Deno.test('every query selects the same entities', () => {
  let s = sql()
  for (let q of QUERIES) {
    let mine = eids(matcher(q, shop, { now: NOW })(bundles))
    let theirs = eids(fromSql(s, q))
    let label = `query: ${q || '(empty)'}`
    if (asks(q)) assertEquals(mine, theirs, label)
    else assertEquals(mine.sort(), theirs.sort(), label)
  }
})

Deno.test('an aggregate answers the same rows on both sides', () => {
  let s = sql()
  for (
    let q of [
      '.count',
      '.review&.count',
      // an aggregate counts the whole selection, whatever window rides along
      '.kind=book&.limit=0&.count',
      '.kind=book&.order=price&.limit=1&.after=6&.tally=status',
      '.distinct=status',
      '.tally=status',
      '.price<20&.tally=status',
      '.tally=author',
      '.distinct=review.book',
    ]
  ) assertEquals(rows(q, shop, { now: NOW })(bundles), s.rows(q), q)
  assertThrows(() => rows('.tally=price', shop), Error, 'cannot compile')
})

Deno.test('a query neither side can answer is declined by both', () => {
  let s = sql()
  for (let q of ['.near=b1', '.edges', '.refs', '.reviews~=deep']) {
    assertThrows(() => s.read(q), Error, 'cannot compile', q)
    assertThrows(() => matcher(q, shop), Error, 'cannot compile', q)
  }
})

// ---- the walk over edges, both evaluators ----------------------------------
//
// A relation is an edge bundle (`edge{from,to}` beside the tag), and a walk over
// one is @yaks/edge's to compile for SQL and this package's to answer in memory.
// The same chain, both directions, the cap, and a cycle.

let blog: Vocab = loadVocab([edgeDoc, {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    post: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    cites: {
      component: true,
      type: 'object',
      edge: true,
    },
    links: {
      component: true,
      type: 'object',
      edge: 'linked',
    },
  },
}], [edgeKeywords])

let posts: Bundle[] = [
  ...['p1', 'p2', 'p3', 'p4', 'p9'].map((eid, i) => ({
    entity: { eid, num: i + 1 },
    post: { title: eid },
  })),
  link('p2', 'cites', 'p1'),
  link('p3', 'cites', 'p2'),
  link('p4', 'cites', 'p3'),
  link('p1', 'cites', 'p4'), // the ring closes
  link('p9', 'links', 'p1'),
]

let WALKS = [
  '.cites->p1',
  '.cites[<=1]->p1',
  '.cites[<=2]->p1',
  '.cites[<=1]<-p1',
  '.cites<-p1',
  '.cites->P-1',
  '.linked->p1',
  '.linked<-p1',
  '.cites->p9',
  '.cites->p1 .post.title=p3',
]

Deno.test('a walk over edges selects the same entities', () => {
  let s = loaded(blog, posts, {}, [traverse(blog)])
  for (let q of WALKS) {
    let mine = eids(matcher(q, blog, { now: NOW })(posts)).sort()
    assertEquals(mine, eids(fromSql(s, q)).sort(), `query: ${q}`)
  }
  // and the agreement is not vacuous
  assertEquals(eids(matcher('.cites[<=2]->p1', blog)(posts)).sort(), [
    'p2',
    'p3',
  ])
  assertEquals(eids(matcher('.cites<-p1', blog)(posts)).sort(), [
    'p2',
    'p3',
    'p4',
  ])
})

Deno.test('a walk over nothing declares is declined by both', () => {
  let s = loaded(blog, posts, {}, [traverse(blog)])
  for (let q of ['.admires->p1', '.post.title->p1']) {
    assertThrows(() => s.read(q), Error, 'cannot compile', q)
    assertThrows(() => matcher(q, blog), Error, 'cannot compile', q)
  }
})

// ---- the walk over a chain of reference properties, both evaluators
// ------------
//
// `.fork.from.session->S-1` is one step over a composed relation: a session's
// `fork` names the entry it forked from, and that entry names the session it
// was written in — so the pair is (session, the session it forked out of), and
// the walk over it is the fork lineage. Three levels of it, both directions,
// the cap, and a hop that is no reference.

let forked: Vocab = loadVocab([{
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    session: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    fork: {
      component: true,
      type: 'object',
      properties: {
        from: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
    entry: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        session: { type: 'string', ref: 'entity', death: 'cascade' },
        text: { type: 'string' },
      },
    },
  },
}])

// s1 → e1 forked into s2 → e2 forked into s3 → e3 forked into s4.
let lineage: Bundle[] = [1, 2, 3, 4].flatMap((n) => [
  {
    entity: { eid: `s${n}`, num: n },
    session: { title: `s${n}` },
    ...(n > 1 ? { fork: { from: `e${n - 1}` } } : {}),
  },
  {
    entity: { eid: `e${n}`, num: n + 4 },
    entry: { session: `s${n}`, text: `entry ${n}` },
  },
])

let CHAINS = [
  '.fork.from.session->S-1',
  '.fork.from.session[<=1]->S-1',
  '.fork.from.session[<=2]->S-1',
  '.fork.from.session->s1',
  '.fork.from.session<-s4',
  '.fork.from.session[<=1]<-s4',
  '.fork.from.session->s4',
  // beside an ordinary filter, the way a board reads
  '.fork.from.session->s1&.session.title=s3',
]

Deno.test('a walk over a chain of references selects the same entities', () => {
  let s = loaded(forked, lineage)
  for (let q of CHAINS) {
    let mine = eids(matcher(q, forked, { now: NOW })(lineage)).sort()
    assertEquals(mine, eids(fromSql(s, q)).sort(), `query: ${q}`)
  }
  // and the agreement is not vacuous: the lineage above s1, capped and whole
  let sel = (q: string) =>
    eids(matcher(q, forked, { now: NOW })(lineage)).sort()
  assertEquals(sel('.fork.from.session->S-1'), ['s2', 's3', 's4'])
  assertEquals(sel('.fork.from.session[<=2]->S-1'), ['s2', 's3'])
  assertEquals(sel('.fork.from.session<-s4'), ['s1', 's2', 's3'])
})

Deno.test('a chain with a hop that is no reference is declined by both', () => {
  let s = loaded(forked, lineage)
  for (let q of ['.fork.from.text->s1', '.entry.session.title->s1']) {
    assertThrows(() => s.read(q), Error, 'cannot compile', q)
    assertThrows(() => matcher(q, forked), Error, 'cannot compile', q)
  }
})

// ---- a computed property, one rule, both evaluators
// ---------------------------
//
// `task.status` (@yaks/task) is declared `computed: true`: no row holds it, and
// its value is read off the marks a task wears. The package states that rule
// once and hands each side its own reader — `derived()` the SQL expression,
// `compute()` the function over a bundle — so this is the agreement that makes
// a status board portable: the same filter, the same tasks, database or page.

let spine: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}
let todo: Vocab = loadVocab([taskDoc, projectDoc, spine])

let ROWS: Bundle[] = [
  { entity: { eid: 't1' }, task: {}, filed: { priority: 1 } },
  {
    entity: { eid: 't2' },
    task: {},
    filed: { priority: 2 },
    completed: { at: '2024-06-14T08:00:00.000Z' },
  },
  {
    entity: { eid: 't3' },
    task: {},
    filed: { priority: 3 },
    cancelled: { at: '2024-06-13T08:00:00.000Z', reason: 'moved on' },
  },
  // both marks: cancelled outranks done, in the ladder's order
  {
    entity: { eid: 't4' },
    task: {},
    filed: { priority: 4 },
    completed: { at: '2024-06-12T08:00:00.000Z' },
    cancelled: { at: '2024-06-15T08:00:00.000Z' },
  },
  // not a task at all: no status, the way a database reads NULL for it
  { entity: { eid: 'p1' }, project: {} },
]
let todos: Bundle[] = ROWS.map((b, i) => ({
  ...b,
  entity: { ...b.entity, num: i + 1 },
}))

let STATUS = [
  '.status=open',
  '.status=done',
  '.status=cancelled',
  '.status=open,done',
  '.status!=done',
  '.status~=cancel',
  // absence and presence: a non-task has no status to read
  '!status',
  '.status',
  // beside an ordinary property, the way a board actually reads
  '.status=open&.priority=1',
  '.status!=cancelled&.priority>=2',
  '.kind=task&.status=done',
  // and ordered by the computed property itself, windowed as a page would ask
  '.status&.order=status',
  '.status&.order=-status',
  '.status&.order=status&.limit=2',
  '.status&.order=status&.after=2',
]

Deno.test('a computed property agrees when both sides are given the rule', () => {
  let s = loaded(todo, ROWS, taskDerived())
  let select = (q: string) =>
    matcher(q, todo, { now: NOW, computed: compute() })
  for (let q of STATUS) {
    let mine = eids(select(q)(todos))
    let theirs = eids(fromSql(s, q))
    let label = `query: ${q}`
    if (asks(q)) assertEquals(mine, theirs, label)
    else assertEquals(mine.sort(), theirs.sort(), label)
  }
  // and the agreement is not vacuous
  assertEquals(eids(select('.status=open')(todos)), ['t1'])
  assertEquals(eids(select('.status=cancelled')(todos)).sort(), ['t3', 't4'])
})

Deno.test('a computed property nobody registered still declines', () => {
  let e = assertThrows(
    () => matcher('.status=open', todo),
    Unsupported,
  ) as Unsupported
  assertEquals(e.by, '@yaks/match')
  // ordering by one declines the same way
  assertThrows(() => matcher('.task&.order=status', todo), Unsupported)
})

// An order names a property. A whole component in its place is refused by
// both compilers alike, and the refusal names what the caller could order by.
Deno.test('an order naming a whole component declines, naming its properties', () => {
  let mine = assertThrows(() => matcher('.order=doc', shop), Unsupported)
  let theirs = assertThrows(() => sql().read('.order=doc'), Unsupported)
  assertEquals(
    mine.message,
    '@yaks/match cannot compile a component where a property belongs: ' +
      'doc — try doc.title, doc.body',
  )
  assertEquals(theirs.message, mine.message.replace('match', 'sql'))
})
