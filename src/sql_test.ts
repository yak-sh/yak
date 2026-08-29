// The JS matcher is the definition; sql.ts is an optimisation that must agree
// with it exactly or decline. So nothing here asserts a hand-written expected
// set — every case runs the SAME filter line through both paths and holds the
// two answers against each other. A compiler that "looks right" and a compiler
// that IS right are indistinguishable from the inside, and this is the seam
// where they come apart.
//
// The graph below is small but adversarial on purpose: it carries the cases
// where SQL's type affinity and JS's `String(v) ==` disagree if you let them —
// a numeric column matched as text, a text column holding digits, an empty
// string beside an absent column, a needle containing LIKE's wildcards.

import { assertEquals } from '@std/assert'
import {
  aggOf,
  distinctValues,
  kidsOf,
  kindPreds,
  matchQuery,
  parseQuery,
  PROJECT,
  tally,
  type Walk,
} from './query.ts'
import { aggregateSql, select, where } from './sql.ts'
import { open, textBlob, textMatches } from './db.ts'
import { kindOf, kindOrder } from './types.ts'
import { isRef } from './props.ts'

let db = open(':memory:')

// The schema seeds a starter graph, so these rows are numbered above it. Its
// entities stay in the world both paths read — which is the point: agreement
// has to hold over rows this file never wrote.
let base = Number(
  (db.prepare('select max(num) as n from entity').get() as { n: number }).n ??
    0,
)

// One entity per row: its components, written straight in. `apply()` would
// normalize values, and normalizing is precisely what must NOT hide a
// disagreement — the point is to compare the two readers of what is STORED.
let n = 0
type Cell = string | number | null
let put = (eid: string, rows: Record<string, Record<string, Cell>>) => {
  db.prepare('insert into entity (eid, num) values (?, ?)')
    .run(eid, base + ++n)
  for (let [comp, cols] of Object.entries(rows)) {
    if (comp == 'doc') {
      cols = { ...cols, body: textBlob(db, String(cols.body ?? '')) }
    }
    // Component tables are id-keyed now (owner `entity` int → entity(id)), and a
    // reference column stores the referent's int id. Resolve the owner eid and
    // each ref value eid→id in SQL; plain scalars bind straight (a null ref value
    // still resolves to null — the subquery over a null eid yields null).
    let names = Object.keys(cols)
    let colSql = ['entity', ...names.map((k) => `"${k}"`)].join(',')
    let valSql = [
      '(select id from entity where eid = ?)',
      ...names.map((k) =>
        isRef(comp, k) ? '(select id from entity where eid = ?)' : '?'
      ),
    ].join(',')
    db.prepare(`insert into "${comp}" (${colSql}) values (${valSql})`)
      .run(eid, ...names.map((k) => cols[k]))
  }
}

// A time phrase names a range around a MOMENT, so both readers are handed the
// same one. Without that, `1-hour-ago` is compiled at one microsecond and
// matched at another, and a row on the boundary decides the test. Every stamp
// below is placed relative to it, so which rows fall inside `today` is fixed
// whatever zone the machine keeps — and the two readers still have to agree
// about it, which is the only thing being asserted.
let NOW = Date.parse('2026-08-20T15:00:00.000Z')
let ago = (ms: number) => new Date(NOW - ms).toISOString()
let HOUR = 3_600_000
let DAY = 24 * HOUR

// project is a real reference, so its target has to exist.
put('p1', { doc: { title: 'a project' }, project: {} })

// The window-board population: a row touched minutes ago, one a few hours back,
// one days back, one that has NEVER been touched since it was made (so
// `.updated.at` reads its created.at — the 1,656-entity class a compiled
// `updated.at` would drop on the floor), and one with neither stamp.
put('w1', {
  doc: { title: 'touched just now' },
  created: { at: ago(9 * DAY), by: null, via: null },
  updated: { at: ago(5 * 60_000), by: null, via: null },
})
put('w2', {
  doc: { title: 'touched hours ago' },
  created: { at: ago(9 * DAY), by: null, via: null },
  updated: { at: ago(4 * HOUR), by: null, via: null },
})
put('w3', {
  doc: { title: 'touched days ago' },
  created: { at: ago(9 * DAY), by: null, via: null },
  updated: { at: ago(3 * DAY), by: null, via: null },
})
put('w4', {
  doc: { title: 'made today, never touched' },
  created: { at: ago(2 * HOUR), by: null, via: null },
})
put('w5', { doc: { title: 'no stamps at all' } })

// A session to hold e2's claim — wip derives from an active claim (D-24102),
// and a claim's session ref must resolve, so the session is seeded first.
put('sc', { session: { id: 'sc' } })
put('e1', {
  doc: { title: 'alpha widget', body: 'the first one' },
  task: { priority: 1, domain: 'Eng', project: 'p1' },
  proposed: { at: '2026-08-01T00:00:00.000Z', by: null, via: null },
})
put('e2', {
  doc: { title: 'beta WIDGET', body: '100% sure' },
  task: { priority: 2, domain: 'Ops', project: 'p1' },
  // wip is derived from an active claim (D-24102), not a stored column.
  claim: { session: 'sc' },
})
put('e3', {
  doc: { title: 'gamma', body: 'under_score' },
  task: { priority: 0, domain: '', project: null },
  // done is derived from a completed mark (D-24102), not a stored column.
  completed: { at: '2026-08-02T00:00:00.000Z', by: null },
})
put('e4', { doc: { title: 'delta', body: '' } }) // no task component at all
put('e5', {
  doc: { title: '10', body: 'digits in a text column' },
  task: { priority: 10, domain: '9' },
})
// The trigram index narrows with the needle's wildcards left in, so these two
// are the rows a missing re-test would hand back: each holds what `100%` and
// `under_score` become once `%` and `_` are wildcards, and neither is a match.
put('e6', { doc: { title: 'wider', body: '100 percent, underXscore' } })
// Non-ASCII, which the two case foldings do not agree about (see has()): the
// stored text is lowercase so an ASCII needle reaching PAST it still agrees,
// while a needle carrying the accent itself declines.
put('e7', { doc: { title: 'café', body: 'a café in zürich' } })
put('e8', { proposed: { at: '', by: null, via: null } })
// Two kindOrder components on one entity: kindOf takes the EARLIER one, so this
// is a task, not a project. It is the case presence (`.project!`) cannot tell
// from a bare project and kind= must — the row kind=task keeps and kind=project
// drops.
put('pt', { task: { priority: 1, domain: '' }, project: {} })

// The lazy entry partition lives in the entity table like everything else, so
// the index and the matcher must agree over its facets too — the exactness the
// rest of this file proves for eager rows, held for entries. A session, then its
// ordered log rows carrying the columns a `.entry.session=`/`.generation.*`/
// `.response.*` query screens on.
put('s1', { doc: { title: 'a session' }, session: { id: 'sql-sess' } })
put('en1', {
  entry: { session: 's1', seq: 1 },
  message: { role: 'user' },
  content: { body: 'kick it off' },
})
put('en2', {
  entry: { session: 's1', seq: 2 },
  generation: { provider: 'codex', model: 'gpt-5', through: 'en1' },
})
put('en3', {
  entry: { session: 's1', seq: 3 },
  response: { status: 500 },
  content: { body: 'boom' },
})

// Reverse hops: comments whose comment.target points BACK at a parent. e1 has
// two (one by p1, one by e5), e2 one (by p1), e3 none — so ANY, NONE, ALL and a
// cardinality count each have a row that proves and a row that disproves them.
// created.by is an {eid} ref the sub-filter screens on, stored literal (the test
// compares stored bytes, so no resolveRefs runs).
put('c1', {
  doc: { title: 'first note' },
  comment: { target: 'e1' },
  created: { by: 'p1', at: '2026-08-02T00:00:00.000Z', via: null },
})
put('c2', {
  doc: { title: 'second note' },
  comment: { target: 'e1' },
  created: { by: 'e5', at: '2026-08-03T00:00:00.000Z', via: null },
})
put('c3', {
  doc: { title: 'other note' },
  comment: { target: 'e2' },
  created: { by: 'p1', at: '2026-08-04T00:00:00.000Z', via: null },
})

// Dependency edges — the one non-component table. `.reaches[type,<=N]=id` walks
// these, so the compiler's recursive CTE and an ordinary JS breadth-first walk
// have to name the same set. The chain is a CYCLE on purpose (e1→e2→e3→e1): an
// unbounded closure over it would never terminate, so the depth cap is what
// makes the traversal an answer at all, and both readers must cap identically.
// The `contains` edge beside it proves the walk stays inside ONE edge type.
let link = (parent: string, type: string, child: string) => {
  db.prepare(
    `insert into dependency (parent, type, child) values (
       (select id from entity where eid = ?), ?,
       (select id from entity where eid = ?))`,
  ).run(parent, type, child)
  EDGES.push({ parent, type, child })
}
let EDGES: { parent: string; type: string; child: string }[] = []
link('e1', 'requires', 'e2')
link('e2', 'requires', 'e3')
link('e3', 'requires', 'e1')
link('e4', 'contains', 'e3')

// The traversal as a plain breadth-first walk: from the target, back along
// child→parent, `depth` hops, the target itself excluded. This is the
// DEFINITION the CTE has to match — written independently of it, or the test
// would only prove SQL agrees with itself.
let reachers = (type: string, target: string, depth: number) => {
  let seen = new Set<string>()
  let frontier = [target]
  for (let d = 0; d < depth; d++) {
    let next: string[] = []
    for (let node of frontier) {
      for (let e of EDGES) {
        if (e.type != type || e.child != node) continue
        next.push(e.parent)
        seen.add(e.parent)
      }
    }
    frontier = next
  }
  return seen
}

// The JS side reads the same shape live.ts and client.ts hand matchQuery:
// eid → { comp → { col → value } }, absent components simply missing.
let graph = () => {
  let out: Record<string, Record<string, Record<string, unknown>>> = {}
  for (
    let r of db.prepare('select eid, num from entity').all() as {
      eid: string
      num: number
    }[]
  ) {
    out[r.eid] = { entity: { eid: r.eid, num: r.num } }
  }
  // Every kindOrder comp plus proposed and the lazy entry facets: kindOf reads
  // which components an entity carries, so the JS world must mirror the DB or it
  // names a seeded board a doc — and a query naming the entry partition must see
  // the same rows on both sides. The SQL side reads the DB directly.
  let facets = [
    'entry',
    'content',
    'message',
    'generation',
    'response',
    'created',
    'updated',
    // the derived-status marks (D-24102): statusOf reads these off the comp
    // bag, so the JS world must carry them or every task reads back as 'open'
    // while the SQL side (which derives from the tables) says otherwise.
    'completed',
    'cancelled',
    'claim',
  ]
  // Component tables are id-keyed now: read each row the way the SQL matcher's
  // select() projects it — the owner's eid as `eid`, every reference column back
  // to the referent's eid — so the JS world mirrors stored truth in eid terms and
  // the two matchers still compare like for like.
  let colsOf = (t: string) =>
    (db.prepare('select name from pragma_table_info(?)').all(t) as {
      name: string
    }[]).map((r) => r.name).filter((c) => c != 'entity')
  for (let comp of [...new Set([...kindOrder, 'proposed', ...facets])]) {
    let proj = colsOf(comp).map((c) =>
      isRef(comp, c)
        ? `(select __r.eid from entity __r where __r.id = "${comp}"."${c}") as "${c}"`
        : `"${comp}"."${c}" as "${c}"`
    )
    for (
      let r of db.prepare(
        `select o.eid as eid${proj.length ? ', ' + proj.join(', ') : ''}
         from "${comp == 'doc' ? 'doc_value' : comp}" as "${comp}"
         join entity o on o.id = "${comp}".entity`,
      ).all() as Record<string, unknown>[]
    ) {
      out[String(r.eid)][comp] = r
    }
  }
  return out
}

let world = graph()

let kids = kidsOf(new Map(Object.entries(world)))
let walk: Walk = (r, target) => reachers(r.type, target, r.depth)
let byJs = (q: string) => {
  let preds = parseQuery(q)
  return Object.entries(world)
    .filter(([, comps]) =>
      matchQuery(
        comps,
        preds,
        (e) => world[e],
        NOW,
        kids,
        walk,
        (eid, p) => textMatches(db, eid, p),
      )
    )
    .map(([eid]) => eid).sort()
}

let bySql = (q: string) => {
  let built = where(parseQuery(q), NOW)
  if (!built) return null
  return (db.prepare(built.sql).all(...built.params) as { eid: string }[])
    .map((r) => r.eid).sort()
}

// Every line either compiles and agrees, or declines. `declined` names the
// lines expected to fall back, so a predicate that silently STOPS compiling
// shows up as a failure here rather than as a slow server nobody notices.
let agrees = (q: string) => {
  let js = byJs(q)
  let sql = bySql(q)
  if (sql == null) return 'declined'
  assertEquals(sql, js, `disagreed on: ${q}`)
  return 'agreed'
}

let COMPILES = [
  // equality, the plain case and the one where affinity would betray it
  '.task.status=open',
  '.task.priority=1',
  '.task.priority=10',
  '.doc.title=10',
  '.task.domain=Eng',
  // any-of
  '.task.status=open,wip',
  '.task.priority=0,10',
  '.task.status=open,wip,done',
  // absent-or-empty, over a null column, an empty string, and a missing comp
  '.task.project=',
  '.task.domain=',
  '.task.status=',
  // facet presence is the component row itself, not one nullable column
  '.proposed=',
  '.proposed~=',
  '.proposed!',
  '.proposed.at!',
  // negation
  '.task.status!=done',
  '.task.priority!=1',
  '.task.project!=',
  // contains, including the characters LIKE would have read as wildcards
  '.doc.title~=widget',
  '.doc.title~=WIDGET',
  '.doc.title~=',
  // a numeric operand that no JS number stringifies to: JS matches nothing
  '.task.priority=1.0',
  '.task.priority=01',
  // comparisons on a numeric column
  '.task.priority<=1',
  // a text column against a non-numeric operand is a string compare for every
  // row, since cmp() only goes numeric when BOTH sides parse
  '.doc.title>=alpha',
  '.doc.title<gamma',
  '.task.priority<1',
  '.task.priority>=2',
  '.task.priority>2',
  // ranges, inclusive and exclusive
  '.task.priority=0..2',
  '.task.priority=0...2',
  '.task.priority=1..10',
  // several preds AND together
  '.task.status=open&.task.priority=1',
  '.task.status=open,wip&.doc.title~=widget',
  '.task.status=open&.task.domain=Eng',
  // the SPINE, which is the from table rather than a joined one — how `task
  // show T-3` asks its question, and the one component whose join would be
  // to itself
  '.entity.num=2',
  '.entity.num=1,2',
  '.entity.num!=2',
  '.entity.num=2&.task.status=open',
  // an order is a ranking, not a filter
  '.order=hot',
  '.task.status=open&.order=hot',
  // the empty query selects nothing
  '',
  // bare words are exact FTS terms (or explicit token prefixes)
  'a',
  'ab',
  'café',
  'widget',
  'gamma',
  'first',
  'WIDGET',
  'widget&.task.status=wip',
  'nothing-matches-this',
  // an empty needle is true of every string, so a TEXT pred asks only whether
  // the doc exists — and `~=` over a body asks nothing at all
  '""',
  '.doc.body~=',
  // a substring over a body, where the needle carries LIKE's own wildcards:
  // e6 holds what each becomes once they widen, and must not come back
  '.doc.body~=100%',
  '.doc.body~=under_score',
  '100%',
  'under_score',
  // an ASCII needle reaching past a multibyte character — the trigrams it
  // wants sit behind two of them
  '.doc.body~=rich',
  'rich',
  // the lazy entry partition: an eid reference, an enum, text and numeric
  // columns on the log facets, and compounds — the index reaches entries and
  // must still agree with the matcher over them
  '.entry.session=s1',
  '.entry.session=nope',
  '.message.role=user',
  '.generation.provider=codex',
  '.generation.provider=codex,claude',
  '.response.status=500',
  '.response.status>=400',
  '.response.status<400',
  '.entry.session=s1&.message.role=user',
  '.generation!',
  '.entry!',
  // reverse hops: the children pointing back through comment.target, collapsed
  // existentially (ANY / NONE / ALL) or by count. The sub-filter rides the same
  // compiler, so a ref-equality child pred compiles; a time one declines below.
  '.comments!', // ANY: has a comment
  '.comments=', // NONE: has no comment
  '.comments.created.by=p1', // ANY matching: a comment by p1
  '.comments!.created.by=p1', // NONE matching: no comment by p1
  '.comments!.created.by!=p1', // ALL (De Morgan): every comment by p1
  '.comments>=2', // cardinality: two or more comments
  '.comments>=1',
  '.comments=0',
  '.comments!=0',
  '.comments<2',
  // composes with an ordinary column pred, ANDed
  '.task.status=open&.comments!',
  '.comments.created.by=p1&.task.status=wip',
  // the multi-column reverse-union: e1's referrers are its two comments
  // (comment.target), p1's are its comments-by AND the tasks filed under it —
  // a UNION across ref columns that a single-column pred can't express
  '.refs=e1',
  '.refs=p1',
  '.refs=e2', // one comment (c3) points here
  '.refs=nobody', // no referrers at all
  // Time spans (T-22370). A phrase names a RANGE and the op picks its edge, so
  // each op is its own compilation and each has to agree — these are what a
  // window board asks, and while they declined the board answered a spine-
  // ordered prefix of its matches instead of the matches.
  '.updated.at=today',
  '.updated.at>=today',
  '.updated.at<=today',
  '.updated.at>today',
  '.updated.at<today',
  '.updated.at!=today',
  '.updated.at>=1-hour-ago',
  '.updated.at>=1-week-ago',
  '.updated.at<yesterday',
  '.created.at=today',
  '.created.at>=1-week-ago',
  '.proposed.at>=2026-07-01',
  '.proposed.at<2026-08-02',
  // an any-of list of phrases, and its negation
  '.updated.at=today,yesterday',
  '.updated.at!=today,yesterday',
  // a full stamp is a phrase too — span() reads it as the SECOND it names, so
  // this is a one-second range and not the equality it looks like
  '.created.at=2026-08-02T00:00:00',
  // the fallback: an entity never touched reads created.at as its updated.at,
  // so w4 (made today, never updated) is IN a today window and w5 (no stamps
  // at all) is in nothing — the pair a coalesce-less compile gets wrong
  '.updated.at!',
  '.updated.at=',
  // and the fallback under a filter, which is the shape a board carries
  '.updated.at>=today&.doc.title~=touched',
  // a time span inside a reverse hop's sub-filter, where the whole correlated
  // EXISTS rides the same compilation
  '.comments.created.at=today',
  '.comments.created.at>=1-week-ago',
  '.comments.created.at>=2026-08-01',
  // a value that is NO phrase falls to the ordinary scalar road — a range over
  // two stamps, compared lexically, exactly as the matcher's cmp() does
  '.created.at=2026-08-01..2026-08-04',
  '.created.at=2026-08-01...2026-08-04',
  // `~=` over a stamp is a literal substring, never a phrase
  '.created.at~=2026-08',
  '.created.at~=nope',
  // the bounded traversal: a recursive CTE over the edge table, held against a
  // plain BFS. Each depth is its own case because the cap IS the semantics.
  '.reaches[requires,<=1]=e3',
  '.reaches[requires,<=2]=e3',
  '.reaches[requires,<=3]=e3', // the cycle closes: e3 reaches itself
  '.reaches[requires,<=9]=e3', // and a deeper cap adds nothing more
  '.reaches[contains,<=3]=e3', // one edge type only — e4, never the requires chain
  '.reaches[requires,<=2]=e4', // nothing points at e4 through requires
  '.reaches[requires,<=2]=nobody', // an unknown target reaches nothing
  // composes with an ordinary column pred, ANDed like any other filter
  '.reaches[requires,<=3]=e3&.task.status=open',
  // the EDGES rider is a DELIVERY, not a filter: it must not move the answer
  '.task.status=open&.edges!',
  '.task.status=open&.edges.peers=task.status,doc.title',
]

for (let q of COMPILES) {
  Deno.test(`sql agrees with the matcher: ${q || '(empty)'}`, () => {
    assertEquals(agrees(q), 'agreed', `expected ${q} to compile`)
  })
}

// The declines are as load-bearing as the agreements: each one is a predicate
// whose SQL would be a GUESS, and the caller's fallback is what keeps the
// answer right. If one of these ever starts compiling, it must arrive with its
// own agreement case rather than by accident.
let DECLINES = [
  '.doc.body=', // a body is only ever narrowed by the index, never scanned
  '.task.domain>=1', // text column against a numeric operand
  // explicit substring filters shorter than a trigram still decline
  '.doc.body~=a',
  '.doc.body~=ab',
  '.doc.body~=a%b', // wildcards leave no run of three
  // a non-ASCII needle: SQLite's lower() folds A-Z and no more, so the two
  // matchers do not mean the same thing by `~=café`
  '.doc.body~=café',
  '.doc.title~=café',
  // a body substring on a NON-doc body: sql.ts only ever narrows doc.body, so a
  // content-body scan declines and the matcher answers it over the partition
  '.content.body~=boom',
  // the reverse-union's presence/absence admit rows in no reverse map, so SQL
  // declines them (as the anchor does) and the matcher answers
  '.refs!',
  '.refs=',
]

for (let q of DECLINES) {
  Deno.test(`sql declines rather than guesses: ${q}`, () => {
    assertEquals(bySql(q), null, `${q} should have declined`)
  })
}

// The aggregate projections answer VALUES, not eids, so they run their own
// parity — the compiled distinct/tally over the same graph the matcher reduces.
// domain is a text column, where cast-to-text and String(v) agree; a numeric
// column would disagree, and aggregateSql declines it rather than guess.
Deno.test('aggregate: distinct SQL is the matcher census over a column', () => {
  let ps = parseQuery('.distinct=domain')
  let at = aggOf(ps)!.at
  let built = aggregateSql(ps)!
  let sql = (db.prepare(built.sql).all(...built.params) as { value: string }[])
    .map((r) => r.value)
  assertEquals(sql, distinctValues(Object.values(world), at))
})

Deno.test('aggregate: tally SQL is the matcher tally over a column', () => {
  let ps = parseQuery('.tally=domain')
  let at = aggOf(ps)!.at
  let built = aggregateSql(ps)!
  let sql = new Map(
    (db.prepare(built.sql).all(...built.params) as {
      value: string
      n: number
    }[])
      .map((r) => [r.value, r.n] as [string, number]),
  )
  assertEquals(sql, tally(Object.values(world), at))
})

Deno.test('aggregate: a numeric column declines rather than mis-cast', () => {
  assertEquals(aggregateSql(parseQuery('.distinct=priority')), null)
})

// A PROJECTED query answers rows (eid + named columns), not just eids, so it runs
// its own two-sided parity: the eids it returns are EXACTLY the membership
// `where()` returns over the same filter, and each row's projected values are
// what the column holds. A ~-volatile field projects identically — volatility is
// the caller's change-signal concern, invisible to SQL. This runs on its OWN
// in-memory db so the pins (and the canvas/target entities their {eid} FKs need)
// never enter the shared graph the agreement and kind= tests read.
Deno.test('projection: select carries the named columns beside the eid', () => {
  let pdb = open(':memory:')
  let m = Number(
    (pdb.prepare('select max(num) as n from entity').get() as { n: number })
      .n ??
      0,
  )
  let add = (eid: string, rows: Record<string, Record<string, Cell>>) => {
    pdb.prepare('insert into entity (eid, num) values (?, ?)').run(eid, ++m)
    for (let [comp, cols] of Object.entries(rows)) {
      // id-keyed owner + eid→id ref resolution, as in put() above.
      let names = Object.keys(cols)
      let colSql = ['entity', ...names.map((k) => `"${k}"`)].join(',')
      let valSql = [
        '(select id from entity where eid = ?)',
        ...names.map((k) =>
          isRef(comp, k) ? '(select id from entity where eid = ?)' : '?'
        ),
      ].join(',')
      pdb.prepare(`insert into "${comp}" (${colSql}) values (${valSql})`)
        .run(eid, ...names.map((k) => cols[k]))
    }
  }
  // bare entities — just the spine row the {eid} FKs (pin.canvas, card.target) need
  for (let e of ['cv', 'other', 't1', 't2', 't3']) add(e, {})
  // a pinned card is card + pin on one eid, and pin.eid references card(eid), so
  // card must be inserted before pin (the object key order the inserter walks).
  add('pinA', {
    card: { target: 't1', view: 'card' },
    pin: { canvas: 'cv', x: 5, y: 6, w: 7, h: 8, z: 9 },
  })
  add('pinB', {
    card: { target: 't2', view: 'card' },
    pin: { canvas: 'cv', x: 1, y: 2, w: 3, h: 4, z: 2 },
  })
  add('pinC', {
    card: { target: 't3', view: 'card' },
    pin: { canvas: 'other', x: 0, y: 0, w: 1, h: 1, z: 1 },
  })
  let q = '.pin.canvas=cv&.card!&.fields=pin.x,pin.y,pin.w,pin.h,pin.z~'
  let built = select(parseQuery(q))!
  let rows = pdb.prepare(built.sql).all(...built.params) as Record<
    string,
    unknown
  >[]
  // membership: the two cards pinned to canvas cv, and only those
  assertEquals(rows.map((r) => r.eid).sort(), ['pinA', 'pinB'])
  // and it is EXACTLY the eid-only membership where() gives the same filter
  let w = where(parseQuery(q))!
  assertEquals(
    (pdb.prepare(w.sql).all(...w.params) as { eid: string }[])
      .map((r) => r.eid).sort(),
    rows.map((r) => r.eid).sort(),
  )
  // each projected column rides in aliased comp.prop; z is present though volatile
  let a = rows.find((r) => r.eid == 'pinA')!
  assertEquals(
    [a['pin.x'], a['pin.y'], a['pin.w'], a['pin.h'], a['pin.z']],
    [5, 6, 7, 8, 9],
  )
  pdb.close()
})

// No projection: select IS where — eid only, byte-identical, so the migration can
// route every membership query through the one door without a special case.
Deno.test('projection: no .fields makes select the plain membership where', () => {
  let ps = parseQuery('.task.status=open')
  assertEquals(select(ps), where(ps))
})

// Exactness across the projection: an unknown projected column, and a filter
// beside the projection that itself declines (a path deref, a second join),
// both decline the whole thing rather than answer an almost-right question.
Deno.test('projection: an unknown column or a declining filter declines', () => {
  assertEquals(
    select([{
      comp: '',
      prop: '',
      op: PROJECT,
      value: '',
      fields: [{ comp: 'pin', prop: 'nope', wake: true }],
    }]),
    null,
  )
  assertEquals(select(parseQuery('.assignee.title~=j&.fields=pin.x')), null)
})

// kind=K is not a filter STRING but a synthetic Pred[] (query.ts kindPreds):
// K present and every earlier kindOrder comp absent, which is EXACTLY kindOf.
// So the compiled set must equal both the JS matcher over those preds AND
// kindOf itself — the derivation and the index cannot drift, and neither may
// drift from what an entity IS. `pt` is the adversarial row: a task carrying a
// project comp too, which presence would miscount as a project and kind must
// not. Every kind still compiles (the absence tail is 27 joins at its
// longest); a kind naming nothing is an empty set, not a decline.
let kindOfSet = (kind: string) =>
  Object.entries(world).filter(([, c]) => kindOf(c) == kind)
    .map(([eid]) => eid).sort()
let bySqlKind = (kind: string) => {
  let built = where(kindPreds(kind)!)
  if (!built) return null
  return (db.prepare(built.sql).all(...built.params) as { eid: string }[])
    .map((r) => r.eid).sort()
}
let byJsKind = (kind: string) =>
  Object.entries(world).filter(([, c]) => matchQuery(c, kindPreds(kind)!))
    .map(([eid]) => eid).sort()

for (let kind of ['task', 'project', 'doc', 'board', 'alias', 'memory']) {
  Deno.test(`kind=${kind} compiles to kindOf exactly`, () => {
    let want = kindOfSet(kind)
    assertEquals(byJsKind(kind), want, `${kind}: kindPreds is not kindOf`)
    assertEquals(bySqlKind(kind), want, `${kind}: sql disagreed with kindOf`)
  })
}

// A word naming no kind declines to a JS screen — the derived `entity` kind
// (every kindOrder comp absent) has no component to point at, so the door's
// screen() stays its only reader.
Deno.test('kind= for a non-kind word has no preds to compile', () => {
  assertEquals(kindPreds('entity'), null)
  assertEquals(kindPreds('nonsense'), null)
})

// doc_gram indexes doc and nothing else, so a substring over any OTHER body
// column would narrow by the wrong table's rowid and lose rows. No dot-param
// reaches those columns today (they are server-stamped), so this is the only
// door the invariant can be tested through — and the day one of them becomes
// wire-writable, it must not start compiling by accident.
Deno.test('a body column the index does not cover declines', () => {
  assertEquals(
    where([{ comp: 'session', prop: 'final_text', op: '~', value: 'hello' }]),
    null,
  )
})
