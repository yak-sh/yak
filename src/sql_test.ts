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
import { matchQuery, parseQuery } from './query.ts'
import { where } from './sql.ts'
import { open } from './db.ts'

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
    let keys = ['eid', ...Object.keys(cols)]

    db.prepare(
      `insert into "${comp}" (${keys.map((k) => `"${k}"`).join(',')}) values (${
        keys.map(() => '?').join(',')
      })`,
    ).run(eid, ...Object.values(cols))
  }
}

// project_eid is a real reference, so its target has to exist.
put('p1', { doc: { title: 'a project' }, project: {} })

put('e1', {
  doc: { title: 'alpha widget', body: 'the first one' },
  task: { status: 'open', priority: 1, domain: 'Eng', project_eid: 'p1' },
  proposed: { at: '2026-08-01T00:00:00.000Z', by: null, via: null },
})
put('e2', {
  doc: { title: 'beta WIDGET', body: '100% sure' },
  task: { status: 'wip', priority: 2, domain: 'Ops', project_eid: 'p1' },
})
put('e3', {
  doc: { title: 'gamma', body: 'under_score' },
  task: { status: 'done', priority: 0, domain: '', project_eid: null },
})
put('e4', { doc: { title: 'delta', body: '' } }) // no task component at all
put('e5', {
  doc: { title: '10', body: 'digits in a text column' },
  task: { status: 'open', priority: 10, domain: '9' },
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
  for (let comp of ['doc', 'task', 'proposed']) {
    for (
      let r of db.prepare(`select * from "${comp}"`).all() as Record<
        string,
        unknown
      >[]
    ) {
      out[String(r.eid)][comp] = r
    }
  }
  return out
}

let world = graph()

let byJs = (q: string) => {
  let preds = parseQuery(q)
  return Object.entries(world)
    .filter(([, comps]) => matchQuery(comps, preds))
    .map(([eid]) => eid).sort()
}

let bySql = (q: string) => {
  let built = where(parseQuery(q))
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
  '.task.project_eid=',
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
  '.task.project_eid!=',
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
  // the empty query is every entity
  '',
  // a bare word: the trigram index narrows, instr() decides — title, body,
  // and the entities carrying no doc at all
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
  '.updated.at>=1-week-ago', // a moving span
  '.updated.at!', // the matcher falls back to created.at
  '.created.at=today',
  '.doc.body=', // a body is only ever narrowed by the index, never scanned
  '.task.domain>=1', // text column against a numeric operand
  // shorter than a trigram: fts5 would answer these by decoding the whole
  // index, slower than the scan the index was brought in to replace
  '.doc.body~=a',
  '.doc.body~=ab',
  'a',
  'ab',
  '.doc.body~=a%b', // wildcards leave no run of three
  // a non-ASCII needle: SQLite's lower() folds A-Z and no more, so the two
  // matchers do not mean the same thing by `~=café`
  '.doc.body~=café',
  '.doc.title~=café',
  'café',
]

for (let q of DECLINES) {
  Deno.test(`sql declines rather than guesses: ${q}`, () => {
    assertEquals(bySql(q), null, `${q} should have declined`)
  })
}

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
