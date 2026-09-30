#!/usr/bin/env -S deno run -A
// One-time (T-46375): what a session wrote on its own account, recorded as
// written by the person (or session) that began it, is recorded as the
// session's own. Two shapes of it:
//
// - an instruction snapshot harness `begin()` wrote under whoever began the
//   session, via the session: its writer is the session's own (`through`),
//   so `created.by` is cleared, as the fixed begin() leaves it;
// - a session a person created whose doc is the session's closing report
//   (the old fleet's "Work session"): its writer is who the session speaks
//   as (@yaks/session `speaking`), through the session.
//
// It reports how many rows each moved, and how many rows each person is
// the writer of before and after. Deleted once the box's file is migrated.
//
//   deno run -A bin/migrate-session-writers.ts <db>

import { DatabaseSync } from 'node:sqlite'
import {
  and,
  as,
  col,
  count,
  type Driver,
  eq,
  exists,
  fn,
  lit,
  ne,
  notNull,
  render,
  select,
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

// Instruction snapshots written under whoever began their session.
let snapshots = () =>
  d.query({
    t: 'update',
    table: 'created',
    as: 'c',
    set: { by: lit(null) },
    from: [table('entry', 'e'), table('prompt', 'p'), table('created', 'sc')],
    where: and(
      eq(col('entity', 'e'), c('entity')),
      eq(col('entity', 'p'), c('entity')),
      eq(col('entity', 'sc'), col('session', 'e')),
      eq(c('via'), col('session', 'e')),
      notNull(c('by')),
      ne(c('by'), col('session', 'e')),
      eq(c('by'), col('by', 'sc')),
    ),
    returning: [col('entity')],
  }).length

// Sessions a person created that hold the session's own report.
let reports = () =>
  d.query({
    t: 'update',
    table: 'created',
    as: 'c',
    set: {
      by: fn('coalesce', col('actor', 's'), col('entity', 's')),
      via: col('entity', 's'),
    },
    from: [table('session', 's'), table('doc', 'd')],
    where: and(
      eq(col('entity', 's'), c('entity')),
      eq(col('entity', 'd'), c('entity')),
      ne(fn('coalesce', col('title', 'd'), lit('')), lit('')),
      exists(select({
        cols: [lit(1)],
        from: table('person', 'p'),
        where: eq(col('entity', 'p'), c('by')),
      })),
    ),
    returning: [col('entity')],
  }).length

d.query({ t: 'pragma', name: 'busy_timeout', value: 10_000 })
console.log('before', people())
d.query({ t: 'begin', mode: 'immediate' })
try {
  console.log('snapshots', snapshots())
  console.log('reports', reports())
  d.query({ t: 'commit' })
} catch (e) {
  d.query({ t: 'rollback' })
  throw e
}
console.log('after', people())
