/// <reference lib="deno.ns" />
// The defining test: the same corpus, the same queries, two evaluators.
//
// One side loads the bundles into a SQLite database through @yaks/sqlite and
// answers each query with the statement @yaks/sql compiles. The other holds the
// same bundles in an array and answers with this package. Every query must
// select the same entities, in the same order — that agreement is the whole
// promise: a filter written once means one thing wherever the data lives.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { open } from '@yaks/sqlite/db'
import type { Bundle } from './read.ts'
import { storage } from '@yaks/sqlite'
import { fields, schema as ftsSchema, search } from '@yaks/fts'
import { type Derived, type Extension, Unsupported } from '@yaks/sql'
import { taskDoc } from '@yaks/task'
import { kernelDoc } from '@yaks/kernel'
import { projectDoc } from '@yaks/project'
import { edgeDoc, edgeKeywords, link, traverse } from '@yaks/edge'
import { loadVocab, pick, type Vocab, type VocabDoc } from '@yaks/vocab'
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

test('every query selects the same entities', () => {
  let s = sql()
  for (let q of QUERIES) {
    let mine = eids(matcher(q, shop, { now: NOW })(bundles))
    let theirs = eids(fromSql(s, q))
    let label = `query: ${q || '(empty)'}`
    if (asks(q)) assertEquals(mine, theirs, label)
    else assertEquals(mine.sort(), theirs.sort(), label)
  }
})

test('a window cuts the whole alternation, on both sides', () => {
  let s = sql()
  let sides = [
    (q: string) => eids(matcher(q, shop, { now: NOW })(bundles)),
    (q: string) => eids(fromSql(s, q)),
  ]
  for (let side of sides) {
    let whole = side('.kind=member|.kind=review&.limit=9')
    assertEquals(whole.length, 4)
    for (
      let q of [
        '.kind=member|.kind=review&.limit=2',
        '.kind=member&.limit=2|.kind=review',
      ]
    ) assertEquals(side(q), whole.slice(0, 2), q)
  }
})

test('an aggregate answers the same rows on both sides', () => {
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

// A projection carries each value it names beside the eid, one hop or through
// references, a boolean as true/false and an entity nothing reaches as null.
test('a projection answers the same rows on both sides', () => {
  let s = sql()
  let answers = [
    '.review&.fields=review.stars,review.book.doc.title&.order=review.stars',
    '.kind=book&.fields=book.available,book.author.doc.title&.order=price',
    '.kind=review&.fields=review.book.book.author.doc.title,review.book.num' +
    '&.order=review.stars',
    '.kind=review&.fields=review.book.book.available&.order=-review.stars',
    // a window projects only its own page
    '.kind=review&.fields=review.book.doc.title&.order=review.book.book.price' +
    '&.limit=2&.after=r2',
    '.kind=book&.fields=book.author.doc.title&.limit=2',
    '.distinct=review.book.doc.title',
    '.tally=review.book.book.status',
  ].map((q) => {
    let mine = rows(q, shop, { now: NOW })(bundles)
    assertEquals(mine, s.rows(q), q)
    return mine
  })
  // and the agreement is not vacuous
  assertEquals(answers[0][0], {
    eid: 'r2',
    'review.stars': 3,
    'review.book.doc.title': 'The Left Hand of Spring',
  })
  assertEquals(answers[2].map((r) => r['review.book.book.author.doc.title']), [
    'Ursula Vale',
    'Milo Frank',
    'Ursula Vale',
  ])
  assertEquals(answers[3][0]['review.book.book.available'], true)
  assertEquals(answers[4], [{
    eid: 'r1',
    'review.book.doc.title': 'The Left Hand of Spring',
  }, { eid: 'r3', 'review.book.doc.title': 'Cooking on a Barge' }])
})

test('a query neither side can answer is declined by both', () => {
  let s = sql()
  for (
    let q of [
      '.near=b1',
      '.edges',
      '.refs',
      '.reviews~=deep',
      // a path through a hop that is no reference, or to a whole component
      '.review&.fields=review.stars.doc.title',
      '.order=book.author.member',
      '.tally=review.book.book.price',
    ]
  ) {
    assertThrows(() => s.rows(q), Error, 'cannot compile', q)
    assertThrows(() => rows(q, shop)(bundles), Error, 'cannot compile', q)
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

test('a walk over edges selects the same entities', () => {
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

test('a walk over nothing declares is declined by both', () => {
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

test('a walk over a chain of references selects the same entities', () => {
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

test('a chain with a hop that is no reference is declined by both', () => {
  let s = loaded(forked, lineage)
  for (let q of ['.fork.from.text->s1', '.entry.session.title->s1']) {
    assertThrows(() => s.read(q), Error, 'cannot compile', q)
    assertThrows(() => matcher(q, forked), Error, 'cannot compile', q)
  }
})

// ---- a task's status, one ladder, both evaluators
// ---------------------------
//
// `task.status` (@yaks/task) is computed: no row holds it, and its value is
// read off the marks a task wears. The package declares that ladder once, in
// its vocabulary, and each side reads it from there, so this is the agreement
// that makes a status board portable: the same filter, the same tasks,
// database or page.

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
let todo: Vocab = loadVocab([
  taskDoc,
  pick(kernelDoc, ['completed']),
  projectDoc,
  spine,
])

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

test("a task's status agrees on both sides, read from its ladder", () => {
  let s = loaded(todo, ROWS)
  let select = (q: string) => matcher(q, todo, { now: NOW })
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

test('a computed property nobody registered still declines', () => {
  let lamps = loadVocab([spine, {
    $defs: {
      lamp: {
        component: true,
        type: 'object',
        properties: { glow: { type: 'string', computed: true } },
      },
    },
  }])
  let e = assertThrows(
    () => matcher('.glow=on', lamps),
    Unsupported,
  ) as Unsupported
  assertEquals(e.by, '@yaks/match')
  // ordering by one declines the same way
  assertThrows(() => matcher('.lamp&.order=glow', lamps), Unsupported)
})

// ---- a status ladder, declared once in the vocabulary
// ---------------------------
//
// A component's `status` keyword (@yaks/vocab) is the rule itself: neither
// side is handed an expression, and each builds its reading from the
// declaration. Another document's rung (`held`, appended after the declaring
// document's) reaches both at once.

let laddered: Vocab = loadVocab([
  spine,
  {
    $defs: {
      job: {
        component: true,
        type: 'object',
        status: { failed: 'failed', finished: 'done', default: 'pending' },
        properties: { rank: { type: 'number' } },
      },
      failed: { component: true, type: 'object' },
      finished: { component: true, type: 'object' },
      held: { component: true, type: 'object' },
    },
  },
  {
    $defs: {
      job: { component: true, extends: true, status: { held: 'running' } },
    },
  },
])
let JOBS: Bundle[] = [
  { entity: { eid: 'j1', num: 1 }, job: { rank: 1 } },
  { entity: { eid: 'j2', num: 2 }, job: { rank: 2 }, finished: {} },
  { entity: { eid: 'j3', num: 3 }, job: { rank: 3 }, failed: {} },
  // both: the first rung wins
  { entity: { eid: 'j4', num: 4 }, job: { rank: 4 }, failed: {}, finished: {} },
  { entity: { eid: 'j5', num: 5 }, job: { rank: 5 }, held: {} },
  { entity: { eid: 'j6', num: 6 }, job: { rank: 6 }, held: {}, finished: {} },
  // a rung without the component: no status at all
  { entity: { eid: 'x1', num: 7 }, finished: {} },
]
let LADDER = [
  '.job.status=pending',
  '.job.status=done',
  '.job.status=failed',
  '.job.status=running',
  '.status=pending,running',
  '.job.status=failed,done&.rank>=3',
  '.job.status!=done',
  '.job.status~=ail',
  '!job.status',
  '.job.status',
  '.job .order=status',
  '.job .order=-status&.limit=3',
  '.job .order=status&.after=4',
]

test('a status ladder reads the same from both sides, from the vocabulary alone', () => {
  let s = loaded(laddered, JOBS)
  for (let q of LADDER) {
    let mine = eids(matcher(q, laddered, { now: NOW })(JOBS))
    let theirs = eids(fromSql(s, q))
    if (asks(q)) assertEquals(mine, theirs, q)
    else assertEquals(mine.sort(), theirs.sort(), q)
  }
  // and the agreement is not vacuous
  let sel = (q: string) => eids(matcher(q, laddered)(JOBS)).sort()
  assertEquals(sel('.job.status=failed'), ['j3', 'j4'])
  assertEquals(sel('.job.status=done'), ['j2', 'j6'])
  assertEquals(sel('.job.status=running'), ['j5'])
  assertEquals(sel('.job.status=pending'), ['j1'])
  // a gather carries the status it read, the way a page is handed it
  assertEquals(
    s.get(['j4', 'j5', 'x1']).map((b) =>
      (b.job as { status?: string })?.status
    ),
    ['failed', 'running', undefined],
  )
})

// An order names a property. A whole component in its place is refused by
// both compilers alike, and the refusal names what the caller could order by.
test('an order naming a whole component declines, naming its properties', () => {
  let mine = assertThrows(() => matcher('.order=doc', shop), Unsupported)
  let theirs = assertThrows(() => sql().read('.order=doc'), Unsupported)
  assertEquals(
    mine.message,
    '@yaks/match cannot compile a component where a property belongs: ' +
      'doc — try doc.title, doc.body',
  )
  assertEquals(theirs.message, mine.message.replace('match', 'sql'))
})
