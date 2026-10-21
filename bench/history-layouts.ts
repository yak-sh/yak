// Where a component's versions live (D-130964, T-131140): three layouts over
// one copy of the box's graph whose journal has moved into versions
// (bin/migrate-history.ts), on the same reads and writes.
//
//   deno run -A bench/history-layouts.ts <copy.db> [rounds]
//
// - `beside`, as built: the live table, and `<comp>$versions` beside it with
//   every version, the open one included.
// - `view`: `<comp>$versions` is the table, and `<comp>` a view of main's open
//   rows over it. A write edits the open row in place and copies the version
//   it replaces out as a closed one, so the live table's triggers move onto
//   the versions unchanged but for a guard to main's open rows.
// - `table`: the same table, read with the condition written into each read
//   instead of through a view: versions kept in the component's own table.
//   Its writes are the view's.
// - `keyed`: the view's layout with the versions kept without a rowid, in
//   `(entity, $branch, $to)` order, as a live table is kept in entity order.
//
// The view and the keyed layout are each a connection whose temporary views
// stand in front of the live tables, as a mode's do (packages/sqlite/mode.ts);
// SQLite folds a temporary view into a read exactly as it folds a stored one.
// What is written is `doc.title` on open tasks, the edit bench/history.ts
// makes; attribution's rows are the same in every layout and are left out.
// `beside:in-place` keeps beside's tables and writes its versions the view's
// way, to tell the layout's cost from the way a version is written.
// Never point it at the live graph: it writes into the file, and puts back
// what it wrote to `doc` when done. Prints one JSON line per measurement.

import {
  among,
  and,
  as,
  col,
  count,
  desc,
  eq,
  exists,
  type Expr,
  fn,
  isNull,
  join,
  left,
  lit,
  ne,
  not,
  op,
  or,
  type Query,
  select,
  type Source,
  type Stmt,
  table,
  TRUE,
  val,
} from '@yaks/sql'
import { beside, BRANCH, FROM, TO } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'

let [db, roundsArg] = Deno.args
if (!db) throw new Error('usage: history-layouts.ts <copy.db> [rounds]')
let rounds = Number(roundsArg ?? 31)
let out = (o: Record<string, unknown>) => console.log(JSON.stringify(o))
let sql = open(db)
let q = (s: Stmt) => sql.query(s)

type W = Extract<Stmt, { t: 'insert' | 'update' | 'delete' }>

// ---- what the copy holds ----

let KEYED = '$keyed'
let keyed = (comp: string) => `${comp}${KEYED}`
let main = (name: string, as?: string): Source => ({
  t: 'table',
  name,
  schema: 'main',
  as,
})

let pragma = (name: string, arg: string) => q({ t: 'pragma', name, arg })
let columns = (t: string) => pragma('table_info', t)
let stored = (comp: string) =>
  columns(beside(comp)).map((r) => String(r.name))
    .filter((c) => c != 'entity' && !c.startsWith('$'))
let tip = Number(
  q(select({
    cols: [as(fn('max', col('id')), 'id')],
    from: table('journal_tx'),
  }))[0].id,
)

// The component with the most closed versions for each open one: where
// keeping versions in the table costs a current read the most.
let tables = q(select({
  cols: [col('name')],
  from: table('sqlite_master'),
  where: and(
    eq(col('type'), lit('table')),
    op('like', col('name'), lit('%$versions')),
  ),
})).map((r) => String(r.name).slice(0, -'$versions'.length))
let tally = tables.map((comp) => {
  let [r] = q(select({
    cols: [
      as(fn('sum', eq(col(TO), lit(0))), 'open'),
      as(fn('sum', ne(col(TO), lit(0))), 'closed'),
    ],
    from: table(beside(comp)),
    where: eq(col(BRANCH), lit(0)),
  }))
  return { comp, open: Number(r.open ?? 0), closed: Number(r.closed ?? 0) }
})
let versions = tally.reduce((n, t) => n + t.open + t.closed, 0)
let live = tally.reduce((n, t) => n + t.open, 0)
out({ m: 'copy', tables: tables.length, live, versions, tip })
let busy = tally.filter((t) => t.open >= 1000 && stored(t.comp).length)
  .sort((a, b) => b.closed / b.open - a.closed / a.open)[0]
out({ m: 'busiest', ...busy, per: +(busy.closed / busy.open).toFixed(1) })
let COMPS = ['doc', 'task', 'completed', 'cancelled', busy.comp]

// ---- the keyed copies ----

// `comp`'s versions without a rowid, keyed `(entity, $branch, $to)`, with the
// closed-version index and each plain index the versions carry.
let keyedDdl = (comp: string): Stmt[] => {
  let from = beside(comp), to = keyed(comp)
  let cols = columns(from)
  let indexes = pragma('index_list', from)
    .map((r) => String(r.name))
    .filter((n) => !n.endsWith('.key') && !n.endsWith('.to'))
  return [
    { t: 'drop', kind: 'table', name: to, ifExists: true },
    {
      t: 'create table',
      name: to,
      cols: cols.map((r) => ({
        name: String(r.name),
        type: String(r.type) || undefined,
        notNull: !!r.notnull,
        ...r.name == 'entity' ? { ref: { table: 'entity', cols: ['id'] } } : {},
        ...String(r.name).startsWith('$') && r.name != FROM
          ? { default: lit(0) }
          : {},
      })),
      keys: [{ pk: ['entity', BRANCH, TO] }],
      withoutRowid: true,
    },
    {
      t: 'insert',
      into: to,
      cols: cols.map((r) => String(r.name)),
      q: select({
        cols: cols.map((r) => col(String(r.name))),
        from: table(from),
        order: [col('entity'), col(BRANCH), col(TO)],
      }),
    },
    {
      t: 'create index',
      name: `${to}.to`,
      on: to,
      cols: [col(TO)],
      where: ne(col(TO), lit(0)),
    },
    ...indexes.map((n): Stmt => ({
      t: 'create index',
      name: n.replace('$versions', KEYED),
      on: to,
      cols: pragma('index_info', n).map((r) => col(String(r.name))),
    })),
  ]
}
for (let comp of COMPS) {
  let s = performance.now()
  q({ t: 'begin' })
  for (let st of keyedDdl(comp)) q(st)
  q({ t: 'commit' })
  out({ m: 'keyed:made', comp, ms: Math.round(performance.now() - s) })
}

// ---- the layouts' connections ----

let OPEN = (a?: string) =>
  and(eq(col(BRANCH, a), lit(0)), eq(col(TO, a), lit(0)))
let viewed = (of: (comp: string) => string) => {
  let c = open(db)
  for (let comp of COMPS) {
    c.query({
      t: 'create view',
      temp: true,
      name: comp,
      q: select({
        cols: ['entity', ...stored(comp)].map((n) => col(n)),
        from: main(of(comp)),
        where: OPEN(),
      }),
    })
  }
  return c
}
type Layout = {
  name: string
  on: ReturnType<typeof open>
  // A component's rows as this layout reads them, and the condition on them.
  src: (comp: string, as: string) => { src: Source; on: Expr }
  // The tables that keep `comp` in this layout.
  keeps: (comp: string) => string[]
}
let plain = (comp: string, as: string) => ({ src: table(comp, as), on: TRUE })
let layouts: Layout[] = [
  { name: 'beside', on: sql, src: plain, keeps: (c) => [c, beside(c)] },
  { name: 'view', on: viewed(beside), src: plain, keeps: (c) => [beside(c)] },
  {
    name: 'table',
    on: sql,
    src: (c, a) => ({ src: table(beside(c), a), on: OPEN(a) }),
    keeps: (c) => [beside(c)],
  },
  { name: 'keyed', on: viewed(keyed), src: plain, keeps: (c) => [keyed(c)] },
]

// ---- timing ----

let other = open(db)
let commit = () =>
  other.query({
    t: 'insert',
    or: 'replace',
    into: 'server_meta',
    cols: ['k', 'v'],
    rows: [[val('bench'), val(String(Math.random()))]],
  })
let stats = (xs: number[]) => {
  let s = [...xs].sort((a, b) => a - b)
  let at = (p: number) =>
    +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3)
  return { median: at(0.5), p90: at(0.9) }
}
// Each call's own time after three untimed; a cold one follows another
// writer's commit, so it reads from SQLite rather than from memory.
let time = (l: string, m: string, f: (i: number) => unknown, cold = false) => {
  for (let i = 0; i < 3; i++) f(-1 - i)
  let xs: number[] = []
  for (let i = 0; i < rounds; i++) {
    if (cold) commit()
    let s = performance.now()
    f(i)
    xs.push(performance.now() - s)
  }
  out({ layout: l, m, ...stats(xs) })
}

// ---- reads ----

let tasks = q(select({
  cols: [col('entity', 't')],
  from: table('task', 't'),
  joins: [join(table('doc', 'd'), eq(col('entity', 'd'), col('entity', 't')))],
  where: not(exists(select({
    cols: [lit(1)],
    from: table('completed', 'c'),
    where: eq(col('entity', 'c'), col('entity', 't')),
  }))),
  order: [col('entity', 't')],
  limit: lit(100),
})).map((r) => Number(r.entity))
let hot = q(select({
  cols: [col('entity')],
  from: table(beside(busy.comp)),
  group: [col('entity')],
  order: [desc(count())],
  limit: lit(10),
})).map((r) => Number(r.entity))

let then = (a: string, at: number) =>
  and(
    eq(col(BRANCH, a), lit(0)),
    or(isNull(col(FROM, a)), op('<=', col(FROM, a), val(at))),
    or(eq(col(TO, a), lit(0)), op('>', col(TO, a), val(at))),
  )
type Src = Layout['src']
let reads = {
  get: (s: Src): Query => {
    let d = s('doc', 'd')
    return select({
      cols: [col('entity', 'd'), col('title', 'd'), col('body', 'd')],
      from: d.src,
      where: and(among(col('entity', 'd'), tasks.slice(0, 10).map(val)), d.on),
    })
  },
  page: (s: Src): Query => {
    let t = s('task', 't'), d = s('doc', 'd')
    let none = (comp: string, a: string) => {
      let x = s(comp, a)
      return not(exists(select({
        cols: [lit(1)],
        from: x.src,
        where: and(eq(col('entity', a), col('entity', 't')), x.on),
      })))
    }
    return select({
      cols: [col('num', 'e'), col('title', 'd')],
      from: t.src,
      joins: [
        join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 't'))),
        left(d.src, and(eq(col('entity', 'd'), col('entity', 't')), d.on)),
      ],
      where: and(t.on, none('completed', 'c'), none('cancelled', 'x')),
      order: [desc(col('num', 'e'))],
      limit: lit(50),
    })
  },
  'busiest:get': (s: Src): Query => {
    let b = s(busy.comp, 'b')
    return select({
      cols: [col('entity', 'b')],
      from: b.src,
      where: and(among(col('entity', 'b'), hot.map(val)), b.on),
    })
  },
  'busiest:count': (s: Src): Query => {
    let b = s(busy.comp, 'b')
    return select({ cols: [count()], from: b.src, where: b.on })
  },
}
// As of a transaction: the same select over whichever table keeps versions.
let past = tip - 20_000
let asOf = (of: (c: string) => string): Src => (c, a) => ({
  src: main(of(c), a),
  on: then(a, past),
})

for (let l of layouts) {
  for (let [m, r] of Object.entries(reads)) {
    let st = r(l.src)
    time(l.name, `read:${m}`, () => l.on.query(st), true)
  }
}
for (let [name, of] of [['versions', beside], ['keyed', keyed]] as const) {
  for (let m of ['get', 'page'] as const) {
    let st = reads[m](asOf(of))
    time(name, `as-of:${m}`, () => sql.query(st), true)
  }
}
// The plans, to see that a view folds into a read as the written condition
// does.
for (let l of layouts) {
  let plan = l.on.query({ t: 'explain query plan', of: reads.page(l.src) })
  out({ layout: l.name, m: 'plan:page', plan: plan.map((r) => r.detail) })
}

// ---- writes ----

let cols = stored('doc')
// Past every transaction a version names, this bench's earlier runs included.
let tx = Math.max(
  tip,
  ...[FROM, TO].map((c) =>
    Number(
      q(select({
        cols: [as(fn('max', col(c)), 'n')],
        from: table(beside('doc')),
      }))[0].n ?? 0,
    )
  ),
)
let MAIN_OPEN = OPEN()

// Beside, as packages/sqlite/history.ts keeps an upsert: the live row, then
// main's open versions of its owner made to match it again.
let besideEdit = (e: number, title: string, tx: number): W[] => {
  let to = beside('doc')
  let same = exists(select({
    cols: [lit(1)],
    from: table('doc', '__live'),
    where: and(
      eq(col('entity', '__live'), col('entity', to)),
      ...cols.map((c) => op('is', col(c, '__live'), col(c, to))),
    ),
  }))
  let stale = and(MAIN_OPEN, eq(col('entity'), val(e)), not(same))
  let none = not(exists(select({
    cols: [lit(1)],
    from: table(to, '__open'),
    where: and(
      eq(col('entity', '__open'), col('entity', 'doc')),
      OPEN('__open'),
    ),
  })))
  return [
    {
      t: 'insert',
      into: 'doc',
      cols: ['entity', 'title'],
      rows: [[val(e), val(title)]],
      upsert: [{
        on: [col('entity')],
        set: { title: col('title', 'excluded') },
      }],
    },
    { t: 'delete', from: to, where: and(stale, eq(col(FROM), val(tx))) },
    { t: 'update', table: to, set: { [TO]: val(tx) }, where: stale },
    {
      t: 'insert',
      into: to,
      cols: ['entity', ...cols, BRANCH, FROM, TO],
      q: select({
        cols: [
          col('entity'),
          ...cols.map((c) => col(c)),
          lit(0),
          val(tx),
          lit(0),
        ],
        from: table('doc'),
        where: and(eq(col('entity'), val(e)), none),
      }),
    },
  ]
}

// A version kept in place: the open row is edited where it stands, and the
// version it replaces is copied out as a closed one, unless this same
// transaction opened it, since nobody else ever saw it. The open row's key
// never moves, and a trigger on the table sees an edit as an edit.
let inPlace = (v: string) => (e: number, title: string, tx: number): W[] => {
  let mine = and(MAIN_OPEN, eq(col('entity'), val(e)))
  let changes = and(mine, op('is not', col('title'), val(title)))
  return [
    {
      t: 'insert',
      into: v,
      cols: ['entity', ...cols, BRANCH, FROM, TO],
      q: select({
        cols: [
          col('entity'),
          ...cols.map((c) => col(c)),
          lit(0),
          col(FROM),
          val(tx),
        ],
        from: table(v),
        where: and(changes, op('is not', col(FROM), val(tx))),
      }),
    },
    {
      t: 'update',
      table: v,
      set: { title: val(title), [FROM]: val(tx) },
      where: changes,
    },
  ]
}
let besideInPlace = (e: number, title: string, tx: number): W[] => [
  besideEdit(e, title, tx)[0],
  ...inPlace(beside('doc'))(e, title, tx),
]

// The live doc's triggers on a table of versions, each guarded to main's open
// rows: an insert's and an edit's as they were, and a removal's also on a
// close. Any trigger maps the same way, so the move is mechanical.
let text = (row: string) => [
  col('entity', row),
  fn('coalesce', col('title', row), lit('')),
  fn('coalesce', {
    t: 'sub',
    q: select({
      cols: [col('value', '__b')],
      from: table('blob_text', '__b'),
      where: eq(col('sha', '__b'), col('body', row)),
    }),
  }, lit('')),
]
// The moved triggers keep a text index of their own, made per run from what
// the versions hold, so the copy's own index (an external-content one over the
// live rows) is never told to delete what it does not hold.
let FTS = 'doc_fts$bench'
let indexed = (v: string): Stmt[] => [
  { t: 'drop', kind: 'table', name: FTS, ifExists: true },
  {
    t: 'create virtual table',
    name: FTS,
    using: 'fts5',
    args: ['title', 'body', ['content', '']],
  },
  {
    t: 'insert',
    into: FTS,
    cols: ['rowid', 'title', 'body'],
    q: select({
      cols: text('o'),
      from: table(v, 'o'),
      where: and(OPEN('o'), among(col('entity', 'o'), tasks.map(val))),
    }),
  },
]
let fts = (row: 'new' | 'old'): W => ({
  t: 'insert',
  into: FTS,
  cols: row == 'old'
    ? [FTS, 'rowid', 'title', 'body']
    : ['rowid', 'title', 'body'],
  rows: [row == 'old' ? [lit('delete'), ...text(row)] : text(row)],
})
let owed = (row: 'new' | 'old'): W => ({
  t: 'insert',
  into: 'embedding_owed',
  cols: ['owner', 'n'],
  rows: [[col('entity', row), lit(1)]],
  upsert: [{ on: [col('owner')], set: { n: op('+', col('n'), lit(1)) } }],
})
let TRIGGERS = ['opened', 'edited', 'owed', 'closed', 'removed']
let guarded = (v: string): Stmt[] => {
  let made = (
    n: string,
    event: 'insert' | 'update' | 'delete',
    when: Expr,
    body: W[],
    of?: string[],
  ): Stmt => ({
    t: 'create trigger',
    name: `${v}_${n}`,
    timing: 'after',
    event,
    on: v,
    when,
    body,
    ...of ? { of } : {},
  })
  let both = and(OPEN('old'), OPEN('new'))
  return [
    made('opened', 'insert', OPEN('new'), [fts('new'), owed('new')]),
    made('edited', 'update', both, [fts('old'), fts('new')]),
    made('owed', 'update', both, [owed('new')], cols),
    made('closed', 'update', and(OPEN('old'), ne(col(TO, 'new'), lit(0))), [
      fts('old'),
      owed('old'),
    ], [TO]),
    made('removed', 'delete', OPEN('old'), [fts('old'), owed('old')]),
  ]
}
let unguarded = (v: string): Stmt[] =>
  TRIGGERS.map((n) => ({
    t: 'drop',
    kind: 'trigger',
    name: `${v}_${n}`,
    ifExists: true,
  }))

let size = (names: string[]) =>
  names.flatMap((t) =>
    q(select({
      cols: [col('name')],
      from: table('sqlite_master'),
      where: eq(col('tbl_name'), val(t)),
    })).map((r) => String(r.name))
  ).reduce((n, name) =>
    n + Number(
      q(select({
        cols: [as(fn('sum', col('pgsize')), 'n')],
        from: table('dbstat'),
        where: eq(col('name'), val(name)),
      }))[0].n ?? 0,
    ), 0)

let writers = [
  { name: 'beside', edit: besideEdit, keeps: ['doc', beside('doc')], v: '' },
  {
    name: 'beside:in-place',
    edit: besideInPlace,
    keeps: ['doc', beside('doc')],
    v: '',
  },
  {
    name: 'view',
    edit: inPlace(beside('doc')),
    keeps: [beside('doc')],
    v: beside('doc'),
  },
  {
    name: 'keyed',
    edit: inPlace(keyed('doc')),
    keeps: [keyed('doc')],
    v: keyed('doc'),
  },
]
let run = Math.floor(Math.random() * 1e6)
for (let w of writers) {
  if (w.v) { for (let s of [...indexed(w.v), ...guarded(w.v)]) q(s) }
  let unit = (es: number[], label: string) => {
    tx++
    q({ t: 'begin' })
    for (let e of es) for (let s of w.edit(e, `${label} ${run} ${tx}`, tx)) q(s)
    q({ t: 'commit' })
  }
  time(
    w.name,
    'write:title-edit',
    (i) => unit([tasks[(i + 4) % tasks.length]], 'edit'),
  )
  time(w.name, 'write:batch-100-edits', () => unit(tasks, 'batch'))
  let start = size(w.keeps)
  for (let i = 0; i < 20; i++) unit(tasks, 'bytes')
  out({
    layout: w.name,
    m: 'bytes:per-change',
    bytes: Math.round((size(w.keeps) - start) / 2000),
  })
  if (w.v) {
    for (let s of unguarded(w.v)) q(s)
    q({ t: 'drop', kind: 'table', name: FTS })
  }
}

// The copy as this bench found it: every version a run opened goes, every one
// it closed opens again, and the live rows it edited take their values back.
// Its transactions all come after the journal's newest.
q({ t: 'begin' })
q({
  t: 'delete',
  from: beside('doc'),
  where: and(eq(col(BRANCH), lit(0)), op('>', col(FROM), val(tip))),
})
q({
  t: 'update',
  table: beside('doc'),
  set: { [TO]: lit(0) },
  where: and(eq(col(BRANCH), lit(0)), op('>', col(TO), val(tip))),
})
q({
  t: 'update',
  table: 'doc',
  set: {
    title: {
      t: 'sub',
      q: select({
        cols: [col('title', '__v')],
        from: table(beside('doc'), '__v'),
        where: and(eq(col('entity', '__v'), col('entity', 'doc')), OPEN('__v')),
      }),
    },
  },
  where: among(col('entity'), tasks.map(val)),
})
q({ t: 'commit' })

// ---- turning history on and off ----

// On: every live row copied in as its open version (beside, view and table
// alike; the view's then drops the live table). Off: beside drops its tables
// of versions; the view's and the table's copy main's open rows back out into
// live tables first. Timed on the component with the most live rows, in a
// scratch table, and scaled to the store by its rows.
let big = tally.filter((t) => t.open && stored(t.comp).length)
  .sort((a, b) => b.open - a.open)[0]
let scratch = `${big.comp}$scratch`
let timed = (m: string, ss: Stmt[], rows: number) => {
  let s = performance.now()
  q({ t: 'begin' })
  for (let st of ss) q(st)
  q({ t: 'commit' })
  let ms = performance.now() - s
  out({
    m,
    comp: big.comp,
    rows,
    ms: Math.round(ms),
    store_s: +(ms * live / rows / 1000).toFixed(1),
  })
}
let bcols = ['entity', ...stored(big.comp)]
timed('on:copy-live-rows', [
  { t: 'drop', kind: 'table', name: scratch, ifExists: true },
  {
    t: 'create table',
    name: scratch,
    cols: [
      ...bcols.map((name) => ({ name })),
      { name: BRANCH },
      { name: FROM },
      { name: TO },
    ],
  },
  {
    t: 'insert',
    into: scratch,
    cols: [...bcols, BRANCH, FROM, TO],
    q: select({
      cols: [...bcols.map((c) => col(c)), lit(0), lit(null), lit(0)],
      from: table(big.comp),
    }),
  },
  {
    t: 'create index',
    name: `${scratch}.key`,
    on: scratch,
    cols: [col('entity'), col(BRANCH), col(TO)],
    unique: true,
  },
], big.open)
timed('off:copy-open-rows-out', [
  { t: 'drop', kind: 'table', name: scratch, ifExists: true },
  {
    t: 'create table',
    name: scratch,
    cols: bcols.map((name) =>
      name == 'entity' ? { name, type: 'integer', pk: true } : { name }
    ),
  },
  {
    t: 'insert',
    into: scratch,
    cols: bcols,
    q: select({
      cols: bcols.map((c) => col(c)),
      from: table(beside(big.comp)),
      where: MAIN_OPEN,
    }),
  },
], big.open)
timed('off:drop-table', [{ t: 'drop', kind: 'table', name: scratch }], big.open)

// What the file keeps: every table of versions, and the live tables of the
// components that keep versions, which the view's layout would not have.
let keeping = tally.filter((t) => t.open).map((t) => t.comp)
out({
  m: 'store:bytes',
  versions: size(tables.map(beside)),
  live_kept: size(keeping),
  live_exempt: size(tables.filter((t) => !keeping.includes(t))),
})
for (let comp of COMPS) {
  q({ t: 'drop', kind: 'table', name: keyed(comp) })
}
Deno.exit(0)
