#!/usr/bin/env -S deno run -A
// One-time (T-40677): a graph file's `usage` rows written under input, cached,
// output and reasoning move to the one name each count has, and the four
// columns go, by the same pass every yaks.app store runs on its next wake
// (workers/yak/migrate.ts `renamed`). It reports the rows holding each name
// before and after. Deleted once the box's file is migrated.
//
//   deno run -A bin/migrate-usage.ts <db>

import { DatabaseSync } from 'node:sqlite'
import {
  as,
  col,
  count,
  type Driver,
  notNull,
  render,
  select,
  table,
} from '@yaks/sql'
import { COUNTS, renamed } from '../workers/yak/migrate.ts'

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

let held = () => {
  let has = new Set(
    d.query({ t: 'pragma', name: 'table_info', arg: 'usage' }).map((r) =>
      r.name
    ),
  )
  return Object.fromEntries(
    Object.entries(COUNTS).flat().filter((c) => has.has(c)).map((c) => [
      c,
      d.query(select({
        cols: [as(count(), 'n')],
        from: table('usage'),
        where: notNull(col(c)),
      }))[0].n,
    ]),
  )
}

d.query({ t: 'pragma', name: 'busy_timeout', value: 10_000 })
console.log('before', held())
d.query({ t: 'begin', mode: 'immediate' })
try {
  renamed(d, 'usage', COUNTS)
  d.query({ t: 'commit' })
} catch (e) {
  d.query({ t: 'rollback' })
  throw e
}
console.log('after', held())
