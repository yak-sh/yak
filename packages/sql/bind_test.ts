// Self-contained unit tests: @yaks/sql over a tiny inline vocab, no fleet. They pin the public contract the integration builds on — the shape of
// the compiled statement, the derived-property hook, that values are bound
// never inlined, and that a gap declines loudly.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { absent, and, eq, parse, present, text } from '@yaks/query'
import { loadVocab, Unknown } from '@yaks/vocab'
import type { VocabDoc } from '@yaks/vocab'
import {
  ARMS,
  col,
  compile,
  type Derived,
  fn,
  gt,
  isNull,
  lit,
  Unsupported,
  val,
  when,
} from './mod.ts'

// The spine, a doc, and a task with a stored priority and a computed status
// (computed: true) — the smallest vocab that exercises routing, a scalar, and
// the derived hook.
let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    task: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        priority: { type: 'number', format: 'priority' },
        status: {
          type: 'string',
          enum: ['open', 'wip', 'done'],
          computed: true,
        },
      },
    },
    note: {
      component: true,
      type: 'object',
      properties: {
        about: { type: 'string', ref: 'entity', death: 'cascade' },
        stars: { type: 'number' },
      },
    },
  },
}
let v = loadVocab(doc)

let status: Derived = {
  'task.status': {
    tag: 'enum',
    values: ['open', 'wip', 'done'],
    expr: (owner) => when([[isNull(owner), lit(null)]], lit('open')),
  },
}

Deno.test('a scalar predicate binds its value as a param, never inlined', () => {
  let { sql, params } = compile(parse('.priority=1'), v)
  assertEquals(params, [1])
  assert(sql.includes('"task"."priority" = ?'), sql)
})

Deno.test('JSON equality compares the stored text without numeric coercion', () => {
  let vocab = loadVocab({
    $defs: {
      config: {
        component: true,
        type: 'object',
        properties: { value: { type: 'string', format: 'json' } },
      },
    },
  })
  let { sql, params } = compile(parse('.config.value=1'), vocab)
  assertEquals(params, ['1'])
  assert(sql.includes('cast("config"."value" as text) = ?'), sql)
})

Deno.test('a text term requires a search extension', () => {
  assertThrows(() => compile(parse('hello'), v), Unsupported)
})

Deno.test('a contains needle rides as a param', () => {
  let { params } = compile(parse('.title~=hi'), v)
  assert(params.includes('hi'))
})

Deno.test('the derived hook supplies a computed property expression', () => {
  let { sql, params } = compile(parse('.status=open'), v, { derived: status })
  assert(sql.includes('case when'), sql)
  assertEquals(params, ['open'])
})

Deno.test('a computed property with no registration declines loudly', () => {
  assertThrows(
    () => compile(parse('.status=open'), v),
    Unsupported,
  )
})

// A derived read builds on rows of its own choosing — @yaks/session's
// `session.status` is computed from the entries a session has, and answers
// `empty` for an owner with none. Every entity in a graph has none, so
// `.session.status=empty` selected all of them (T-37730). A qualified path
// names its component as much as its property, so the read is NULL without it,
// the way every stored property reads through the left join.
Deno.test('a derived read is NULL where the component is not worn', () => {
  let blind: Derived = {
    'task.status': {
      tag: 'enum',
      values: ['open', 'empty'],
      expr: () => lit('x'),
    },
  }
  let { sql } = compile(parse('.status=empty'), v, { derived: blind })
  assert(
    sql.includes(`(case when "task"."entity" is not null then 'x' end)`),
    sql,
  )
  // and the narrowing a value test keeps, now that the read can carry it
  assert(sql.includes('("task"."entity" is not null and '), sql)
  // over a dereferenced leaf the component is a row of its own, not a column
  let deref = compile(parse('.note.about.status=empty'), v, { derived: blind })
  assert(
    deref.sql.includes(
      `(case when exists (select 1 from "task" as "__pw" where` +
        ` "__pw"."entity" = `,
    ),
    deref.sql,
  )
})

// The read that answers for a row wearing nothing says so: the fleet's
// `updated.at` coalesces to `created.at`, because being made is the last time
// an untouched row changed, and 1,656 of 10,767 entities were invisible to
// `.updated.at>=…` before it did.
Deno.test('a read marked worn: false keeps its value without the component', () => {
  let fallback: Derived = {
    'task.status': {
      tag: 'enum',
      values: ['open'],
      worn: false,
      expr: () => fn('coalesce', col('priority', 'task'), lit('open')),
    },
  }
  let { sql } = compile(parse('.status=open'), v, { derived: fallback })
  assert(!sql.includes('case when'), sql)
  assert(!sql.includes('("task"."entity" is not null and '), sql)
})

Deno.test('the .kind scope expands to present-and-earlier-absent', () => {
  // task sorts before doc, so `.kind=doc` is doc present and task absent.
  let { sql } = compile(parse('.kind=doc'), v)
  assert(sql.includes('"doc"."entity" is not null'), sql)
  assert(sql.includes('"task"."entity" is null'), sql)
})

Deno.test('a reverse hop compiles to a correlated EXISTS', () => {
  let { sql, params } = compile(parse('.notes'), v)
  assert(
    sql.includes('exists (select 1 from "note" where "note"."about" ='),
    sql,
  )
  assertEquals(params, [])
  assert(compile(parse('!notes'), v).sql.includes('not exists'), 'absence')
})

// The step relation a chained walk composes: the hops joined on each other, so
// one rung of the CTE crosses the whole chain. `.fork.from.session` is the
// session a session forked out of.
Deno.test('a walk over a chain of references composes one step', () => {
  let vocab = loadVocab({
    $defs: {
      entity: {
        component: true,
        type: 'object',
        wire: false,
        properties: { num: { type: 'number', stamped: true } },
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
        properties: {
          session: { type: 'string', ref: 'entity', death: 'cascade' },
        },
      },
    },
  })
  let { sql, params } = compile(parse('.fork.from.session[<=3]->S-1'), vocab)
  assert(
    sql.includes(
      'select "fork"."entity" as "from", "__w1"."session" as "to" from "fork"' +
        ' join "entry" as "__w1" on "__w1"."entity" = "fork"."from"',
    ),
    sql,
  )
  assertEquals(params, [1, 3])
  // a hop that is no reference is refused, never answered empty
  assertThrows(
    () => compile(parse('.entry.session.num->S-1'), vocab),
    Unsupported,
  )
})

Deno.test('a reverse cardinality binds its count', () => {
  let { sql, params } = compile(parse('.notes>=5'), v)
  assert(sql.includes('count(*) from "note"'), sql)
  assert(sql.includes(') >= ?'), sql)
  assertEquals(params, [5])
})

Deno.test('a reverse child filter screens the child row', () => {
  let { sql, params } = compile(parse('.notes.stars=5'), v)
  assert(sql.includes('"note"."stars" = ?'), sql)
  assertEquals(params, [5])
  // a child property in another component is left-joined inside the subquery
  let joinSql = compile(parse('.notes.title~=hi'), v).sql
  assert(
    joinSql.includes(
      'left join "doc" on "doc"."entity" = ' +
        '"note"."entity"',
    ),
    joinSql,
  )
})

Deno.test('a reverse hop with no count and no child filter declines', () => {
  let e = assertThrows(() => compile(parse('.notes~=lots'), v), Unsupported)
  assertEquals((e as Unsupported).feature, 'a reverse hop')
  // and one reaching for the spine, whose name means the outer row down there
  assertThrows(() => compile(parse('.notes.num=3'), v), Unsupported)
})

Deno.test('an unreachable directive throws Unsupported naming the feature', () => {
  let e = assertThrows(
    () => compile(parse('.near=x&.order=similar'), v),
    Unsupported,
  ) as Unsupported
  assertEquals(e.feature, '.near')
})

// A rule sigil is an instruction to a rule engine, and storage has no engine:
// compiling one away would answer a question nobody asked.
Deno.test('a rule sigil throws Unsupported rather than compiling', () => {
  for (let q of ['+task', '+!task', '*task', '#task', '$t']) {
    assertThrows(() => compile(parse(q), v), Unsupported, 'directive')
  }
})

Deno.test('ordering by an unfiltered property still joins its table', () => {
  let { sql } = compile(parse('.priority=1&.order=title'), v)
  assert(sql.includes('left join "doc"'), sql)
  // the spine breaks ties — the num where there is one, the row id always —
  // so the order a query asks for is total and a page of it is the same page
  // wherever it is cut
  assert(
    sql.endsWith(
      'order by "doc"."title", "entity"."num" desc, ' +
        '"entity"."id" desc',
    ),
    sql,
  )
})

Deno.test('a window with no .order is newest-first by spine num', () => {
  let { sql, params } = compile(parse('.priority=1&.limit=2&.after=7'), v)
  assert(sql.includes('order by "entity"."num" desc'), sql)
  assert(sql.includes('"entity"."num" < ?'), sql)
  assertEquals(params, [1, 7, 2])
})

// A number is opt in (@yaks/id), so the same vocabulary without it: the spine
// is there, the property is not.
let unnumbered = loadVocab({
  $defs: {
    ...doc.$defs,
    entity: { component: true, type: 'object', wire: false, properties: {} },
  },
} as VocabDoc)

Deno.test('a store with no numbers still states its order, by the spine id', () => {
  let { sql } = compile(parse('.priority=1&.limit=2'), unnumbered)
  assert(sql.endsWith('order by "entity"."id" desc limit ?'), sql)
  assert(!sql.includes('"entity"."num"'), sql)
})

Deno.test('a cursor names an entity by number, and a store with none says so', () => {
  assertThrows(
    () => compile(parse('.priority=1&.after=7'), unnumbered),
    Unsupported,
    'does not number its entities',
  )
})

Deno.test('an explicit .order survives a window', () => {
  let { sql } = compile(parse('.priority=1&.order=-title&.limit=2'), v)
  assert(
    sql.endsWith(
      'order by "doc"."title" desc, "entity"."num" desc, ' +
        '"entity"."id" desc limit ?',
    ),
    sql,
  )
})

Deno.test('.after pages within the asked order, keyed on the anchor', () => {
  let { sql, params } = compile(parse('.order=title&.limit=2&.after=7'), v)
  // the cursor names an entity by its num — the same form whatever the
  // order — and the anchor's own value is read back to page past it
  assert(sql.includes('where "__cur"."num" = 7'), sql)
  assert(sql.includes('"doc"."title" > (select'), sql)
  // ties fall to the spine num, and an anchor no entity has is the first page
  assert(sql.includes(`"entity"."num" < ?`), sql)
  assert(sql.includes('not exists (select 1 from "entity" as "__cur"'), sql)
  assertEquals(params, [7, 2])
})

Deno.test('.after over a derived order reads the anchor through the hook', () => {
  let { sql } = compile(parse('.order=status&.after=7'), v, { derived: status })
  // the derived expression is written twice: once over the row, once over the
  // anchor's own owner id
  assert(sql.includes(`case when "task"."entity" is null`), sql)
  assert(
    sql.includes('case when ((select "__cur"."id" from "entity" as "__cur"'),
    sql,
  )
})

let among = (col: string) =>
  `"entity"."${col}" in (select value from json_each(?))`

Deno.test('.eid names entities as one set lookup on the spine', () => {
  let one = compile(parse('.eid=a3f1'), v)
  assert(one.sql.includes(among('eid')), one.sql)
  assertEquals(one.params, ['["a3f1"]'])
  let many = compile(parse('.eid=a3f1,b7c2'), v)
  assert(many.sql.includes(among('eid')), many.sql)
  assertEquals(many.params, ['["a3f1","b7c2"]'])
  // the explicit form routes to the same place
  assert(compile(parse('.entity.eid=a3f1'), v).sql.includes(one.sql.slice(-40)))
  // a list binds one parameter however long it is: a Durable Object's SQLite
  // refuses a statement binding more than 100
  let ids = Array.from({ length: 150 }, (_, i) => `e${i}`)
  assertEquals(compile(parse(`.eid=${ids}`), v).params, [JSON.stringify(ids)])
})

Deno.test('.num and a human id name entities by their spine number', () => {
  let nums = compile(parse('.num=3,4'), v)
  assert(nums.sql.includes(among('num')), nums.sql)
  assertEquals(nums.params, ['[3,4]'])
  // `T-7` is the entity numbered 7 — the letter is display, the number is
  // identity — so a human id lands on the num arm
  let human = compile(parse('.eid=T-7'), v)
  assert(human.sql.includes(among('num')), human.sql)
  assertEquals(human.params, ['[7]'])
  // a mixed list asks both arms
  let both = compile(parse('.eid=a3f1,T-7'), v)
  assert(
    both.sql.includes(`(${among('eid')} or ${among('num')})`),
    both.sql,
  )
  assertEquals(both.params, ['["a3f1"]', '[7]'])
})

Deno.test('an OR compiles as a union of indexed selections of spine ids', () => {
  let either = compile(parse('.doc.title=a|.task.priority=1'), v)
  let [head, arms] = either.sql.split('"entity"."id" in (')
  assert(head.includes('from "entity"'), either.sql)
  // one arm per alternative, each its own selection over the same joins
  assertEquals(arms.split(/\bunion\b/).length, 2)
  assert(arms.startsWith('select "entity"."id" from "entity"'), arms)
  assertEquals(either.params, ['a', 1])
})

Deno.test('a wide OR is cut into compounds workerd will take', () => {
  // Six alternatives is a sixth term, which workerd refuses (compound.ts) —
  // the tray's own or is seven. Each group stays one indexed `in`.
  let wide = compile(
    parse(
      '.doc.title=a|.doc.body=b|.task.priority=1|.note.stars=2|.doc.title=c|.task.priority=3',
    ),
    v,
  )
  let groups = wide.sql.split('"entity"."id" in (').slice(1)
  assertEquals(groups.length, 2)
  for (let g of groups) assert(g.split(/\bunion\b/).length <= ARMS, g)
  assertEquals(wide.params, ['a', 'b', 1, 2, 'c', 3])
})

Deno.test('a spine value that is no operand list keeps the column road', () => {
  // an empty value is still absence grammar, and a range is a comparison the
  // spine's untyped column declines exactly as it did before
  assert(compile(parse('!eid'), v).sql.includes('is null'), 'absence')
  assertThrows(() => compile(parse('.num=3..5'), v), Unsupported)
})

Deno.test('the membership statement excludes graves and answers one eid', () => {
  let { sql } = compile(parse('.priority>=1'), v)
  assert(sql.startsWith('select "entity"."eid" as eid from "entity"'), sql)
  assert(sql.includes('not exists (select 1 from tombstone'), sql)
})

Deno.test('.refs= groups its arms and cuts them to what a compound may carry', () => {
  // A vocabulary wider than one compound SELECT may carry: seven tables bear a
  // reference column and one of them bears two, where workerd would refuse the
  // sixth term (./compound.ts). Every group is its own `in`, so no compound
  // here carries more than ARMS.
  let wide = loadVocab({
    $defs: {
      entity: {
        component: true,
        type: 'object',
        wire: false,
        properties: {},
      },
      ...Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((i) => [`n${i}`, {
          component: true,
          type: 'object',
          properties: { of: { type: 'string', ref: 'entity' } },
        }]),
      ),
      pair: {
        component: true,
        type: 'object',
        properties: {
          left: { type: 'string', ref: 'entity' },
          right: { type: 'string', ref: 'entity' },
        },
      },
    } as VocabDoc['$defs'],
  })
  let { sql, params } = compile(parse('.refs=a1'), wide)
  // Eight columns, one bound param each; seven arms, because a table's two
  // columns are one term, OR'd.
  assertEquals(params, Array(8).fill('a1'))
  assert(
    sql.includes(
      '"pair"."left" = (select id from "entity" where eid = ?) or ' +
        '"pair"."right" = (select id from "entity" where eid = ?)',
    ),
    sql,
  )
  // Two groups of at most four arms, and nothing else in the statement unions.
  let compounds = sql.split('"entity"."id" in (').slice(1)
    .map((piece) => piece.split(/\bunion\b/i).length)
  assertEquals(compounds, [4, 3])
  for (let terms of compounds) assert(terms <= ARMS, `${terms} terms: ${sql}`)
})

Deno.test('.refs= over a vocabulary that references nothing selects nothing', () => {
  let none = loadVocab({
    $defs: {
      entity: {
        component: true,
        type: 'object',
        wire: false,
        properties: {},
      },
    },
  })
  let { sql, params } = compile(parse('.refs=a1'), none)
  assertEquals(params, [])
  assert(sql.includes('where 0'), sql)
})

Deno.test('a request for a word this vocabulary never planted asks, and passes', () => {
  // `?loan` names a component nobody here declares. Asking is not asserting:
  // it narrows nothing, so the statement stands and the row simply carries no
  // loan — which is what lets one line be asked of every store in a fan-out.
  let { sql } = compile(parse('.task&?loan'), v)
  assert(!sql.includes('loan'), sql)
  // The assertion form still refuses: an empty answer would say there are none.
  // The refusal is the vocabulary's own sentence, so a door prints one line
  // whether the word was routed away or bound away.
  assertThrows(
    () => compile(parse('.loan'), v),
    Unknown,
    'unknown prop: .loan',
  )
  // And so does a request that is not a bare component name.
  assertThrows(() => compile(parse('?loan.to'), v))
})

Deno.test('reference equality compares indexed keys, not projected eids', () => {
  let one = compile(parse('.note.about=target'), v)
  assert(
    one.sql.includes(
      '"note"."about" = (select id from "entity" where eid = ?)',
    ),
    one.sql,
  )
  assertEquals(one.params, ['target'])
  // A list is one bound value however long it is: a host caps what one
  // statement binds, and a delete asks about every entity it deleted.
  let many = compile(parse('.note.about=target,other'), v)
  assert(
    many.sql.includes(
      '"note"."about" in (select id from "entity" where eid in ' +
        '(select value from json_each(?)))',
    ),
    many.sql,
  )
  assertEquals(many.params, ['["target","other"]'])
  for (let { sql } of [one, many]) assert(!sql.includes('__re'), sql)
  // Projection-based semantics still handle absent values, ranges and text
  // matching; these must not be mistaken for a list of literal reference ids.
  for (
    let query of [
      '!note.about',
      '.note.about=a..z',
      '.note.about~=target',
    ]
  ) {
    let { sql } = compile(parse(query), v)
    assert(sql.includes('__re'), sql)
  }
  // A derived override is authoritative even if the property is stored, and it
  // reads through the guard that says the component is worn.
  let { sql } = compile(parse('.note.about=target'), v, {
    derived: { 'note.about': { tag: 'eid', expr: () => lit('override') } },
  })
  assert(
    sql.includes(
      `cast((case when "note"."entity" is not null then 'override' end)` +
        ` as text) = ?`,
    ),
    sql,
  )
})

Deno.test('reverse NONE and compound child conditions bind without outer-owner leakage', () => {
  let none = compile(parse('.notes!.stars=5'), v)
  assert(none.sql.includes('not exists (select 1 from "note"'))
  assertEquals(none.params, [5])
  let ast = and({
    ...present('notes'),
    where: and(eq('note.stars', 5), text('hi')),
  })
  let child = compile(ast, v, {
    extend: [{
      name: 'test/text',
      compile: {
        text: (_, site) => gt(site.owner, val(0)),
      },
    }],
  })
  assert(child.sql.includes('"note"."entity" > ?'), child.sql)
  assertEquals(child.params, [5, 0])
  assertThrows(
    () => compile(and({ ...present('notes'), where: eq('num', 3) }), v),
    Unsupported,
  )
})

Deno.test('a builder can preserve a terminal component facet across name collisions', () => {
  let vocab = loadVocab({
    $defs: {
      book: {
        component: true,
        type: 'object',
      },
      loan: {
        component: true,
        type: 'object',
        properties: { book: { type: 'string', ref: 'entity' } },
      },
    },
  })
  let c = compile(and({ ...absent('book'), facet: true }), vocab)
  assert(c.sql.includes('"book"."entity" is null'), c.sql)
  assert(!c.sql.includes('join "loan"'), c.sql)
})

// A bare prop several reference properties share routes to comp '' — one read
// concept with no one table behind it. Lowered, its path leaf named the table
// `""` and SQLite refused the statement; the contract is to decline (S-37088).
Deno.test('a shared reference equality unions its owners, other shapes decline', () => {
  // Two components hold a reference property of the same name: the bare word
  // routes to neither (vocab route(): comp ''), and its equality is one indexed
  // question per owner, compiled the way `.refs=` is.
  let shared = loadVocab({
    $defs: {
      entity: {
        component: true,
        type: 'object',
        wire: false,
        properties: {},
      },
      cursor: {
        component: true,
        type: 'object',
        properties: { client: { type: 'string', ref: 'entity' } },
      },
      camera: {
        component: true,
        type: 'object',
        properties: { client: { type: 'string', ref: 'entity' } },
      },
    } as VocabDoc['$defs'],
  })
  let { sql, params } = compile(parse('.client=c1'), shared)
  assertEquals(params, ['c1', 'c1'])
  assert(
    sql.includes(
      '"entity"."id" in (select "camera"."entity" from "camera" where ' +
        '"camera"."client" = (select id from "entity" where eid = ?) union ' +
        'select "cursor"."entity" from "cursor" where ' +
        '"cursor"."client" = (select id from "entity" where eid = ?))',
    ),
    sql,
  )
  for (let line of ['.client', '!client', '.client~=c1', '.client=c1,c2']) {
    let e = assertThrows(() => compile(parse(line), shared), Unsupported)
    assertEquals(e.feature, 'a shared reference')
  }
})

Deno.test('a property test says its component is present, so the planner drives from that table', () => {
  // `.board.query~=<id>` scanned the spine through a left join (243 ms on
  // the live graph) where the boards were 22 rows: a value test cannot hold
  // on a row without the component, and saying so lets SQLite start there.
  let guarded = ['.priority=1', '.priority~=1', '.priority>1', '.priority']
  for (let line of guarded) {
    let { sql } = compile(parse(line), v)
    assert(sql.includes('("task"."entity" is not null and '), `${line}: ${sql}`)
  }
  // A reference equality too, one target or a list: each arm of a delete's
  // reverse-reference read is one, and unnarrowed it scanned every entity
  // (T-38344).
  for (let line of ['.note.about=n1', '.note.about=n1,n2']) {
    let { sql } = compile(parse(line), v)
    assert(sql.includes('("note"."entity" is not null and '), `${line}: ${sql}`)
  }
  // An absence or a not-equals must still see the rows without the component.
  for (let line of ['!priority', '.priority!=1']) {
    let { sql } = compile(parse(line), v)
    assert(!sql.includes('"task"."entity" is not null'), `${line}: ${sql}`)
  }
})

Deno.test('a path leaf shared by several reference properties declines', () => {
  let vocab = loadVocab({
    $defs: {
      claim: {
        component: true,
        type: 'object',
        properties: { session: { type: 'string', ref: 'entity' } },
      },
      session: {
        component: true,
        type: 'object',
        properties: { actor: { type: 'string', ref: 'entity' } },
      },
      crew: {
        component: true,
        type: 'object',
        properties: { actor: { type: 'string', ref: 'entity' } },
      },
    },
  })
  let e = assertThrows(
    () => compile(parse('.claim.session.actor=p1'), vocab),
    Unsupported,
  ) as Unsupported
  assertEquals(e.feature, 'a shared reference leaf')
})
