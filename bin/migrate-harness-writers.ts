#!/usr/bin/env -S deno run -A
// One-time (T-58840): a line a person typed into the harness's terminal is
// written by the config's `person`, through its session, as the terminal's
// backend writes one now. Until fc0b1c0b5 it wrote them with nobody.
//
// A typed line is an input of a transcript the harness began (`session.id` is
// its eid's first eight characters) that is no delegated child's, that nobody
// wrote, and that the harness did not put there itself: a child's receipt
// (`delivery:…`), the runner's recovery line, the runtime's "Continue", and
// the transcripts a test left behind on 09-10 (packages/harness/
// prompts_test.ts: instructions "shared rule", then "work"). One line a model
// wrote into another transcript through graph_apply is the model's, not his.
//
// It reports how many lines moved, and how many rows each person is the
// writer of before and after. Deleted once the box's file is migrated.
//
//   deno run -A bin/migrate-harness-writers.ts <db> [config]

import { DatabaseSync } from 'node:sqlite'
import {
  among,
  and,
  as,
  col,
  count,
  type Driver,
  each,
  eq,
  exists,
  type Expr,
  fn,
  isNull,
  lit,
  ne,
  not,
  op,
  render,
  select,
  table,
  val,
} from '@yaks/sql'

let db = new DatabaseSync(Deno.args[0])
let d: Driver = {
  query: (s) => {
    let { sql, params } = render(s)
    return db.prepare(sql).all(...(params as never[])) as Record<
      string,
      unknown
    >[]
  },
}

let config = Deno.args[1] ?? `${Deno.env.get('HOME')}/.yak/yak.json`
let named = String(JSON.parse(Deno.readTextFileSync(config)).person ?? '')
let [who] = d.query(select({
  cols: [col('id', 'e')],
  from: table('entity', 'e'),
  joins: [{
    how: 'join',
    src: table('person', 'p'),
    on: eq(col('entity', 'p'), col('id', 'e')),
  }],
  where: eq(col('eid', 'e'), val(named)),
}))
if (!who) throw new Error(`${config} names no person here: ${named}`)
let person = who.id as number

// The line graph_apply wrote from 42dacef4 into 14cfb85b ("Owner says…").
let RELAYED = 'c7f183e6-35d8-471b-961a-131b8b3be9f8'

let c = (name: string) => col(name, 'c')
let e = col('entity', 'en')
let like = (a: Expr, pattern: string) => op('like', a, lit(pattern))

// Whether an entity wears a component.
let has = (comp: string, entity: Expr = e) =>
  exists(select({
    cols: [lit(1)],
    from: table(comp, 'x'),
    where: eq(col('entity', 'x'), entity),
  }))

// Whether the session holds the test's instruction snapshot.
let fixture = exists(select({
  cols: [lit(1)],
  from: table('entry', 'fx'),
  joins: [
    {
      how: 'join',
      src: table('prompt', 'fp'),
      on: eq(col('entity', 'fp'), col('entity', 'fx')),
    },
    {
      how: 'join',
      src: table('content', 'fc'),
      on: eq(col('entity', 'fc'), col('entity', 'fx')),
    },
    {
      how: 'join',
      src: table('blob_text', 'fb'),
      on: eq(col('sha', 'fb'), col('body', 'fc')),
    },
  ],
  where: and(
    eq(col('session', 'fx'), col('session', 'en')),
    eq(col('value', 'fb'), lit('shared rule')),
  ),
}))

// How many rows each person is the writer of.
let people = () =>
  Object.fromEntries(
    d.query(select({
      cols: [as(col('eid', 'e'), 'eid'), as(count(), 'n')],
      from: table('created', 'c'),
      joins: [
        {
          how: 'join',
          src: table('person', 'p'),
          on: eq(col('entity', 'p'), c('by')),
        },
        {
          how: 'join',
          src: table('entity', 'e'),
          on: eq(col('id', 'e'), c('by')),
        },
      ],
      group: [col('eid', 'e')],
    })).map((r) => [r.eid, r.n]),
  )

// What a person typed into the harness's terminal and nobody signed.
let typed = () =>
  d.query(select({
    cols: [as(e, 'entity')],
    from: table('entry', 'en'),
    joins: [
      { how: 'join', src: table('entity', 'e'), on: eq(col('id', 'e'), e) },
      {
        how: 'join',
        src: table('entity', 'se'),
        on: eq(col('id', 'se'), col('session', 'en')),
      },
      {
        how: 'join',
        src: table('session', 's'),
        on: eq(col('entity', 's'), col('session', 'en')),
      },
      { how: 'join', src: table('created', 'c'), on: eq(c('entity'), e) },
      {
        how: 'join',
        src: table('content', 'ct'),
        on: eq(col('entity', 'ct'), e),
      },
      {
        how: 'join',
        src: table('blob_text', 'b'),
        on: eq(col('sha', 'b'), col('body', 'ct')),
      },
    ],
    where: and(
      eq(col('id', 's'), fn('substr', col('eid', 'se'), lit(1), lit(8))),
      not(has('spawned', col('session', 'en'))),
      isNull(c('by')),
      ...[
        'output',
        'notice',
        'result',
        'prompt',
        'error',
        'checkpoint',
        'reasoning',
        'exception',
        'stop',
        'call',
        'ask',
        'imported',
      ].map((k) => not(has(k))),
      not(like(col('eid', 'e'), 'delivery:%')),
      not(like(
        col('value', 'b'),
        'System recovery: the previous response was interrupted.%',
      )),
      not(like(col('value', 'b'), 'Continue from the current state.%')),
      not(fixture),
      ne(col('eid', 'e'), lit(RELAYED)),
    ),
  }))

let sign = () => {
  let rows = typed()
  if (!rows.length) return 0
  return d.query({
    t: 'update',
    table: 'created',
    as: 'c',
    set: { by: val(person), via: col('session', 'en') },
    from: table('entry', 'en'),
    where: and(
      eq(e, c('entity')),
      among(c('entity'), each(rows.map((r) => r.entity as number))),
    ),
    returning: [col('entity')],
  }).length
}

d.query({ t: 'pragma', name: 'busy_timeout', value: 10_000 })
console.log('before', people())
d.query({ t: 'begin', mode: 'immediate' })
try {
  console.log('typed', sign())
  d.query({ t: 'commit' })
} catch (e) {
  d.query({ t: 'rollback' })
  throw e
}
console.log('after', people())
