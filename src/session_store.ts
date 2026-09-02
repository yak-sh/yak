// Server-owned persistence for a Session's split components. It keeps the
// canonical facets and rolling aliases in one transaction owned by its caller,
// and gives SQL consumers the same canonical-first projection as graph clients.
import type { Sql, SqlValue } from './store/sql.ts'
import {
  type Change,
  comps,
  type Session,
  sessionFacetNames,
  sessionOf,
  stamped,
} from './types.ts'
import { isRef } from './props.ts'
import { readComp } from './db.ts'

type Row = Record<string, unknown>
type Facet = typeof sessionFacetNames[number]

let active = new Set(['starting', 'running', 'stopping'])
let terminal = new Set(['completed', 'failed', 'interrupted', 'lost'])
let lifecycle = new Set<Facet>(['run', 'settled', 'yield'])

let sql = (name: string) => `"${name.replaceAll('"', '""')}"`

// The eid→id storage seam (D-18866): these tables key by the owner's int id and
// store references as int ids, while every caller here speaks EIDs. Reads go
// through db.ts readComp(), which projects the owner and each reference back to
// eids exactly as the graph-out door does. Writes resolve the other way: the
// owner key and any {eid} reference column bind an eid that this correlated
// lookup turns into the stored id (a null eid resolves to null — a cleared ref).
let ownerId = `(select id from entity where eid = ?)`
let bindOf = (name: string, col: string) =>
  isRef(name, col) ? `(select id from entity where eid = ?)` : '?'
let fields = (name: Facet) => [
  ...Object.keys(comps[name]),
  ...Object.keys(stamped[name] ?? {}),
]

let facet = (row: Row, name: Facet) => {
  let cols = fields(name)
  return Object.fromEntries(cols.map((col) => [
    col,
    row[name == 'settled' && col == 'at' ? 'finished_at' : col],
  ]))
}

let remove = (db: Sql, eid: string, name: Facet): Change[] => {
  let gone = db.prepare(
    `delete from ${sql(name)} where entity = ${ownerId}`,
  ).run(eid).changes
  return gone ? [{ eid, name, comp: null }] : []
}

let writeFacet = (
  db: Sql,
  eid: string,
  name: Facet,
  values: Row,
): Change[] => {
  values = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  )
  let cols = Object.keys(values)
  if (!cols.length) return []
  let prior = readComp(db, eid, name) as Row | undefined
  let moved = Object.fromEntries(
    Object.entries(values).filter(([key, value]) =>
      !prior || prior[key] !== value
    ),
  )
  if (!Object.keys(moved).length) return []
  db.prepare(
    `insert into ${sql(name)} (entity, ${cols.map(sql).join(', ')})
     values (${ownerId}, ${cols.map((col) => bindOf(name, col)).join(', ')})
     on conflict(entity) do update set ${
      cols.map((col) => `${sql(col)} = excluded.${sql(col)}`).join(', ')
    }`,
  ).run(eid, ...cols.map((col) => values[col] as SqlValue))
  return [{ eid, name, comp: moved }]
}

export let sessionRow = (
  db: Sql,
  eid: string,
): Session | undefined => {
  let session = readComp(db, eid, 'session') as Session | undefined
  if (!session) return
  let parts: Parameters<typeof sessionOf>[0] = { session }
  for (let name of sessionFacetNames) {
    let row = readComp(db, eid, name) as Row | undefined
    if (row) parts[name] = row as never
  }
  return sessionOf(parts)
}

export let sessionRows = (
  db: Sql,
  tail = '',
  args: SqlValue[] = [],
) =>
  (db.prepare(
    `select o.eid as eid from session s
       join entity o on o.id = s.entity ${tail}`,
  ).all(...args) as {
    eid: string
  }[]).flatMap((row) => {
    let session = sessionRow(db, row.eid)
    return session ? [session] : []
  })

// The caller owns the transaction and journal. The session aliases update
// first for rollback readers; canonical component changes follow in the same
// transaction and therefore win in every current projection.
export let writeSession = (
  db: Sql,
  eid: string,
  patch: Row,
): Change[] => {
  let prior = readComp(db, eid, 'session') as Row | undefined
  if (!prior) return []
  let moved = Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => prior[key] !== value),
  )
  let changes: Change[] = []
  let cols = Object.keys(moved)
  if (cols.length) {
    db.prepare(
      `update session set ${
        cols.map((col) => `${sql(col)} = ${bindOf('session', col)}`).join(', ')
      }
       where entity = ${ownerId}`,
    ).run(
      ...cols.map((col) => moved[col] as SqlValue),
      eid,
    )
    changes.push({ eid, name: 'session', comp: moved })
  }
  for (let name of sessionFacetNames) {
    if (lifecycle.has(name)) continue
    changes.push(...writeFacet(db, eid, name, facet(patch, name)))
  }

  let status = patch.status
  let ending = terminal.has(String(status)) ||
    ('finished_at' in patch && patch.finished_at != null)
  let clearing = ('status' in patch && status == null) &&
    ('finished_at' in patch && patch.finished_at == null)
  let run = facet(patch, 'run')
  let touchedRun = Object.values(run).some((value) => value !== undefined)
  if (ending) {
    changes.push(...remove(db, eid, 'run'))
    changes.push(...writeFacet(db, eid, 'settled', facet(patch, 'settled')))
  } else if (clearing) {
    changes.push(...remove(db, eid, 'run'))
    changes.push(...remove(db, eid, 'settled'))
  } else if (touchedRun) {
    if (active.has(String(status)) || patch.finished_at === null) {
      changes.push(...remove(db, eid, 'settled'))
    }
    changes.push(...writeFacet(db, eid, 'run', run))
  }
  changes.push(...writeFacet(db, eid, 'yield', facet(patch, 'yield')))
  return changes
}
