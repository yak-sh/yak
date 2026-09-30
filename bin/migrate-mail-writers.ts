#!/usr/bin/env -S deno run -A
// One-time (T-58819): a letter recorded as written by a person who does not
// wear its `mail.from` is written by whoever does, or by nobody where nobody
// here has that address, as @yaks/mail's arrived() writes one now. These are
// the July and August letters the old fleet signed as the box's owner: agents'
// reports sent from their project addresses, and arrivals from outside.
//
// It reports how many letters moved, and how many rows each person is the
// writer of before and after. Deleted once the box's file is migrated.
//
//   deno run -A bin/migrate-mail-writers.ts <db>

import { DatabaseSync } from 'node:sqlite'
import {
  and,
  as,
  col,
  count,
  type Driver,
  eq,
  exists,
  type Expr,
  not,
  render,
  select,
  sub,
  table,
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

let c = (name: string) => col(name, 'c')
let from = col('from', 'm')

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

// The entity wearing an address.
let wearing = (address: Expr) =>
  select({
    cols: [col('entity', 'w')],
    from: table('email', 'w'),
    where: eq(col('address', 'w'), address),
  })

// Letters a person is recorded as writing, from an address not theirs.
let letters = () =>
  d.query({
    t: 'update',
    table: 'created',
    as: 'c',
    set: { by: sub(wearing(from)) },
    from: table('mail', 'm'),
    where: and(
      eq(col('entity', 'm'), c('entity')),
      exists(select({
        cols: [col('entity', 'p')],
        from: table('person', 'p'),
        where: eq(col('entity', 'p'), c('by')),
      })),
      not(exists(select({
        cols: [col('entity', 'w')],
        from: table('email', 'w'),
        where: and(
          eq(col('entity', 'w'), c('by')),
          eq(col('address', 'w'), from),
        ),
      }))),
    ),
    returning: [col('entity')],
  }).length

d.query({ t: 'pragma', name: 'busy_timeout', value: 10_000 })
console.log('before', people())
d.query({ t: 'begin', mode: 'immediate' })
try {
  console.log('letters', letters())
  d.query({ t: 'commit' })
} catch (e) {
  d.query({ t: 'rollback' })
  throw e
}
console.log('after', people())
