#!/usr/bin/env -S deno run -A
// One-time (T-58833): a line a person typed into a transcript the old fleet's
// importer read (`imported.source` native or managed) is written by that
// person, through its session, as @yaks/session's importer writes one now.
// That importer marked a typed line with a bare `prompt`, which now names an
// instruction snapshot, and signed it with nobody; what the harness put in
// front of the model (task notifications, channel messages, skill text,
// interruptions) it read in unmarked, the shape a typed line has now.
//
// So a typed line loses its `prompt`, is written by the config's `person` via
// its session, and holds what the claude reader makes of it (a slash command
// is the command). Every other input of those transcripts is a `notice`.
//
// It reports how many rows each moved, and how many rows each person is the
// writer of before and after. Deleted once the box's file is migrated.
//
//   deno run -A bin/migrate-typed-writers.ts <db> [config]

import { DatabaseSync } from 'node:sqlite'
import { address, encode, sqliteBlobs } from '@yaks/blob'
import { claude } from '@yaks/session'
import {
  among,
  and,
  as,
  by,
  col,
  count,
  type Driver,
  each,
  eq,
  exists,
  type Expr,
  isNull,
  lit,
  not,
  or,
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

let c = (name: string) => col(name, 'c')
let e = col('entity', 'en')

// Whether the entry wears a component.
let has = (comp: string, where?: Expr) =>
  exists(select({
    cols: [lit(1)],
    from: table(comp, 'x'),
    where: and(eq(col('entity', 'x'), e), ...(where ? [where] : [])),
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

// The inputs of the old importer's transcripts: words, and nothing the model
// said or a tool returned.
let inputs = (typed: boolean) =>
  d.query(select({
    cols: [
      as(e, 'entity'),
      col('session', 'en'),
      as(col('value', 'b'), 'body'),
    ],
    from: table('entry', 'en'),
    joins: [
      {
        how: 'join',
        src: table('imported', 'i'),
        on: eq(col('entity', 'i'), e),
      },
      {
        how: 'join',
        src: table('created', 'c'),
        on: eq(c('entity'), e),
      },
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
      among(col('source', 'i'), [lit('native'), lit('managed')]),
      ...['output', 'result', 'reasoning', 'notice', 'checkpoint'].map((k) =>
        not(has(k))
      ),
      typed
        ? and(
          has(
            'prompt',
            and(
              isNull(col('scope', 'x')),
              isNull(col('source', 'x')),
              isNull(col('revision', 'x')),
            ),
          ),
          or(isNull(c('by')), eq(c('by'), val(person))),
        )
        : not(has('prompt')),
    ),
  }))

let ids = (rows: Record<string, unknown>[]) =>
  each(rows.map((r) => r.entity as number))

// Typed lines: the person's, through the session, as the reader has them.
let typed = () => {
  let rows = inputs(true)
  if (!rows.length) return { typed: 0, words: 0 }
  d.query({
    t: 'update',
    table: 'created',
    as: 'c',
    set: { by: val(person), via: col('session', 'en') },
    from: table('entry', 'en'),
    where: and(eq(e, c('entity')), among(c('entity'), ids(rows))),
  })
  let words = 0
  let blobs = sqliteBlobs(d)
  for (let r of rows) {
    let [said] = claude({
      type: 'user',
      origin: { kind: 'human' },
      message: { content: r.body },
    }).entries
    let body = said?.content?.body as string | undefined
    if (body == null || body == r.body) continue
    let sha = address(body)
    blobs.put(sha, encode(body))
    d.query({
      t: 'update',
      table: 'content',
      set: { body: val(sha) },
      where: by({ entity: r.entity as number }),
    })
    words++
  }
  d.query({
    t: 'delete',
    from: 'prompt',
    where: among(col('entity'), ids(rows)),
  })
  return { typed: rows.length, words }
}

// Everything else those transcripts read in as input: the harness's.
let notices = () => {
  let rows = inputs(false)
  if (!rows.length) return 0
  return d.query({
    t: 'insert',
    into: 'notice',
    cols: ['entity'],
    q: ids(rows),
    returning: [col('entity')],
  }).length
}

d.query({ t: 'pragma', name: 'busy_timeout', value: 10_000 })
console.log('before', people())
d.query({ t: 'begin', mode: 'immediate' })
try {
  console.log(typed())
  console.log('notices', notices())
  d.query({ t: 'commit' })
} catch (e) {
  d.query({ t: 'rollback' })
  throw e
}
console.log('after', people())
