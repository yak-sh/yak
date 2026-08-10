// Server-owned persistence for a Session's split components. It keeps the
// canonical facets and rolling aliases in one transaction owned by its caller,
// and gives SQL consumers the same canonical-first projection as graph clients.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import {
  type Change,
  comps,
  type Session,
  sessionFacetNames,
  sessionOf,
  stamped,
} from './types.ts'

type Row = Record<string, unknown>
type Facet = typeof sessionFacetNames[number]

let sql = (name: string) => `"${name.replaceAll('"', '""')}"`
let fields = (name: Facet) => [
  ...Object.keys(comps[name]),
  ...Object.keys(stamped[name] ?? {}),
]

let facet = (row: Row, name: Facet) => {
  let cols = fields(name)
  return Object.fromEntries(cols.map((col) => [col, row[col]]))
}

export let sessionRow = (
  db: DatabaseSync,
  eid: string,
): Session | undefined => {
  let session = db.prepare('select * from session where eid = ?').get(eid) as
    | Session
    | undefined
  if (!session) return
  let parts: Parameters<typeof sessionOf>[0] = { session }
  for (let name of sessionFacetNames) {
    let row = db.prepare(`select * from ${sql(name)} where eid = ?`).get(
      eid,
    ) as Row | undefined
    if (row) parts[name] = row as never
  }
  return sessionOf(parts)
}

export let sessionRows = (
  db: DatabaseSync,
  tail = '',
  args: SQLInputValue[] = [],
) =>
  (db.prepare(`select eid from session ${tail}`).all(...args) as {
    eid: string
  }[]).flatMap((row) => {
    let session = sessionRow(db, row.eid)
    return session ? [session] : []
  })

// The caller owns the transaction and journal. The session aliases update
// first for rollback readers; canonical component changes follow in the same
// transaction and therefore win in every current projection.
export let writeSession = (
  db: DatabaseSync,
  eid: string,
  patch: Row,
): Change[] => {
  let prior = db.prepare('select * from session where eid = ?').get(eid) as
    | Row
    | undefined
  if (!prior) return []
  let moved = Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => prior[key] !== value),
  )
  let changes: Change[] = []
  let cols = Object.keys(moved)
  if (cols.length) {
    db.prepare(
      `update session set ${cols.map((col) => `${sql(col)} = ?`).join(', ')}
       where eid = ?`,
    ).run(
      ...cols.map((col) => moved[col] as SQLInputValue),
      eid,
    )
    changes.push({ eid, name: 'session', comp: moved })
  }
  for (let name of sessionFacetNames) {
    let values = facet(patch, name)
    values = Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== undefined),
    )
    let cols = Object.keys(values)
    if (!cols.length) continue
    let prior = db.prepare(`select * from ${sql(name)} where eid = ?`).get(
      eid,
    ) as Row | undefined
    let moved = Object.fromEntries(
      Object.entries(values).filter(([key, value]) =>
        !prior || prior[key] !== value
      ),
    )
    if (!Object.keys(moved).length) continue
    db.prepare(
      `insert into ${sql(name)} (eid, ${cols.map(sql).join(', ')})
       values (?, ${cols.map(() => '?').join(', ')})
       on conflict(eid) do update set ${
        cols.map((col) => `${sql(col)} = excluded.${sql(col)}`).join(', ')
      }`,
    ).run(eid, ...cols.map((col) => values[col] as SQLInputValue))
    changes.push({ eid, name, comp: moved })
  }
  return changes
}
