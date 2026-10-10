// A table's committed mutation token, shared by every connection. Triggers
// move it in the same transaction as the rows, including raw SQL writers.
import {
  catalogue,
  col,
  type Driver,
  fn,
  lit,
  render,
  revision,
  type Stmt,
} from '@yaks/sql/core'
import { META } from './layout.ts'
import { meta } from './meta.ts'

let key = (table: string) => `table:${table}`
let events = ['insert', 'update', 'delete'] as const

/** Add a mutation token without resetting one an earlier install raised. */
export let versioned = (table: string): Stmt[] => [
  {
    t: 'insert',
    or: 'ignore',
    into: META,
    cols: ['k', 'v'],
    rows: [[lit(key(table)), lit('0')]],
  },
  ...events.map((event): Stmt => ({
    t: 'create trigger',
    name: `${table}_version_${event}`,
    ifNot: true,
    timing: 'after',
    event,
    on: table,
    body: [{
      t: 'insert',
      into: META,
      cols: ['k', 'v'],
      rows: [[lit(key(table)), fn('hex', fn('randomblob', lit(16)))]],
      upsert: [{
        on: [col('k')],
        set: { v: col('v', 'excluded') },
      }],
    }],
  })),
]

// A counter would reuse a value after rollback and a different mutation. A
// fresh token cannot confuse that new state with a snapshot of the undone one.
let tracking = new WeakMap<Driver, {
  schema: number
  tables: Map<string, boolean>
}>()
let tracked = (driver: Driver, table: string): boolean => {
  let schema = revision(driver, 'schema')
  let held = tracking.get(driver)
  if (held?.schema != schema) {
    tracking.set(driver, held = { schema, tables: new Map() })
  }
  let found = held.tables.get(table)
  if (found !== undefined) return found
  let objects = new Map(catalogue(driver).map((o) => [o.name, o]))
  let body = (sql: string) => sql.replace(/^create trigger /i, '')
  let complete = versioned(table).every((s) =>
    s.t != 'create trigger' ||
    body(objects.get(s.name)?.sql ?? '') ==
      body(render({ ...s, ifNot: false }).sql)
  )
  held.tables.set(table, complete)
  return complete
}

/** Undefined means an older file has no token, so caches must reread rows. */
export let tableVersion = (driver: Driver, table: string): string | undefined =>
  tracked(driver, table) ? meta(driver).get(key(table)) : undefined
