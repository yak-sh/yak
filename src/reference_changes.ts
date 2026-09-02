// Citation-derived graph changes: parse the ids and URLs an entry names, then
// compute only its missing `referenced` edges from an injected SQLite reader.
// Keeping this seam free of live_db lets operator backfills scan read-only.
import type { Sql } from './store/sql.ts'
import { human, resolveId } from './db.ts'
import { entityId, normalize } from './url.ts'
import { sentences } from './edge.ts'
import { type Change } from './types.ts'

let idOf = `(select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`
let ID = /\b[A-Z]-\d+\b/g
let URLS = /https?:\/\/[^\s<>"'`)\]]+/g

export type Cites = { ids: string[]; urls: string[] }
export let cites = (text: string): Cites => {
  let ids = new Set<string>()
  let urls = new Set<string>()
  let prose = text.replace(URLS, (raw) => {
    let u = raw.replace(/[.,;:!?]+$/, '')
    let id = entityId(u)
    if (id) ids.add(id)
    else urls.add(normalize(u))
    return ' '
  })
  for (let m of prose.match(ID) ?? []) ids.add(m)
  return { ids: [...ids], urls: [...urls] }
}

let pageOf = (db: Sql, url: string): string | undefined =>
  (db.prepare(
    'select o.eid as eid from web w join entity o on o.id = w.entity where w.url = ?',
  ).get(url) as { eid: string } | undefined)?.eid

export let referencedChanges = (
  db: Sql,
  eid: string,
  text: string,
): Change[] => {
  let { ids, urls } = cites(text)
  let targets = new Set<string>()
  for (let id of ids) {
    let hit: string | undefined
    try {
      hit = resolveId(db, id)
    } catch {
      continue
    }
    if (!hit || hit == eid) continue
    if (/^[A-Z]-\d+$/.test(id) && human(db, hit) != id) continue
    if (!db.prepare('select 1 from entity where eid = ?').get(hit)) continue
    targets.add(hit)
  }
  for (let url of urls) {
    let hit = pageOf(db, url)
    if (hit && hit != eid) targets.add(hit)
  }
  if (!targets.size) return []
  let worn = new Set(
    (db.prepare(
      `select ${refEid('d.child')} as child
         from (${sentences('referenced')}) d
        where d.parent = ${idOf}`,
    ).all(eid) as { child: string }[]).map((r) => r.child),
  )
  return [...targets].filter((t) => !worn.has(t)).map((child): Change => ({
    eid,
    name: 'dependency',
    comp: { type: 'referenced', child },
  }))
}

// The one historical sweep: every stored entry's missing referenced edges.
// The caller lands these through the ordinary write boundary; reruns find only
// what the last run missed.
export let historicalReferenced = (db: Sql): Change[] =>
  (db.prepare(
    `select o.eid as eid, c.body as body
       from entry e
       join entity o on o.id = e.entity
       join content c on c.entity = e.entity
      where not exists (select 1 from recalled r where r.entity = e.entity)`,
  ).all() as { eid: string; body: string }[])
    .flatMap((r) => referencedChanges(db, r.eid, r.body))
