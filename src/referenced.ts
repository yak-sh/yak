// Referenced edges (D-21262, T-21316): every reference an entry's text makes
// — entity ids (T-7, M-42) and page urls — lands as an `entry →referenced→
// target` edge, minted by a post-commit effect. Past tense on purpose: it
// records a citation after the fact, pure mechanics, no inference. Distinct
// from `recalled` (deliberate memory surfacing) so mining can tell a thought
// that floated up from an entity the text itself names — which is why a
// recall-floater entry is skipped here: its citations are the machinery's
// own, already recorded as `recalled` edges.
import { type DatabaseSync } from './sqlite.ts'
import { apply, db, human, resolveId } from './db.ts'
import { entityId, normalize } from './url.ts'
import { type Change } from './types.ts'

// Component tables key by the integer `entity` spine id (D-18866); this module
// speaks eids, so raw SQL translates at the boundary, recall.ts's way.
let OWNED = `entity = (select id from entity where eid = ?)`
let idOf = `(select id from entity where eid = ?)`
let refEid = (col: string) => `(select eid from entity where id = ${col})`

// What a text cites, parsed cold — the pure seam. Every human id is one
// capital letter, a dash, digits (types.ts idOf), so the token grammar is
// exactly that; urls lift out first so a foreign address carrying an id-shaped
// path can't fake a prose citation. A graph entity link folds into ids (its
// path token — resolveId speaks uuids and short eids too); any other http(s)
// url normalizes to the one canonical page spelling (url.ts). Trailing prose
// punctuation is not address. Deduped; resolution is the caller's.
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

// The page wearing this canonical url, if one was ever filed — find, never
// mint: a citation effect that created pages would turn every pasted link
// into an entity nobody asked for.
let pageOf = (db: DatabaseSync, url: string): string | undefined =>
  (db.prepare(
    'select o.eid as eid from web w join entity o on o.id = w.entity where w.url = ?',
  ).get(url) as { eid: string } | undefined)?.eid

// The entry's MISSING referenced edges, as a batch — [] when it cites nothing
// new. A token counts only when it names a live row: resolveId opens every id
// door, but it resolves a prefixed num by num ALONE, so a prefix-num token
// must also echo as the entity's own spelling (human()) — without that, "A-1"
// in prose would cite whatever entity wears num 1. What doesn't resolve is
// skipped, never thrown (an ambiguous short eid throws in resolveId); what
// the entry already wears is diffed away, so re-running is free and a double
// fire mints nothing twice (insert-or-ignore in apply() guards the race
// besides).
export let referencedChanges = (
  db: DatabaseSync,
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
      `select ${refEid('d.child')} as child from dependency d
        where d.parent = ${idOf} and d.type = 'referenced'`,
    ).all(eid) as { child: string }[]).map((r) => r.child),
  )
  return [...targets].filter((t) => !worn.has(t)).map((child): Change => ({
    eid,
    name: 'dependency',
    comp: { type: 'referenced', child },
  }))
}

// The effect: a new entry's text is parsed and its citations land as edges.
// Fires on `entry` created; reads whatever content committed with it. A
// recall floater (the one machine-authored entry whose whole body is
// citations) is skipped — see the header.
export let referencedEntry = (cast: (c: Change[]) => void) => (eid: string) => {
  if (db.prepare(`select 1 from recalled where ${OWNED}`).get(eid)) return
  let row = db.prepare(`select body from content where ${OWNED}`).get(eid) as
    | { body?: string }
    | undefined
  let text = String(row?.body ?? '')
  if (!text) return
  let out = referencedChanges(db, eid, text)
  if (out.length) cast(apply(db, out))
}

// The one historical sweep (the historicalWorked shape): every stored entry's
// missing referenced edges, ready for the deliberate /backfill door to land in
// ordinary apply batches. referencedChanges diffs per entry, so the sweep is
// idempotent and resumable — a rerun finds only what the last run missed.
export let historicalReferenced = (db: DatabaseSync): Change[] =>
  (db.prepare(
    `select o.eid as eid, c.body as body
       from entry e
       join entity o on o.id = e.entity
       join content c on c.entity = e.entity
      where not exists (select 1 from recalled r where r.entity = e.entity)`,
  ).all() as { eid: string; body: string }[])
    .flatMap((r) => referencedChanges(db, r.eid, r.body))
