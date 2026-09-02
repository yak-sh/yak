// The dream's corpus hygiene pass: derive bounded, reviewable candidates from
// memories, personas, and recurring tool errors, then file at most one proposal
// for graph prose and one for telemetry. It never edits, archives, merges, or
// supersedes authored graph data. SERVER-ONLY (imports db).
import { createHash } from 'node:crypto'
import { apply, human } from './db.ts'
import { sentences } from './edge.ts'
import { db } from './live_db.ts'
import { commitEffects } from './effects.ts'
import { FLOOR, similar, stored, textOf } from './embed.ts'
import { personaGraph } from './graph_query.ts'
import { materialize } from './persona.ts'
import { fingerprint, type Log, recent } from './telemetry.ts'
import { type Change, uuid } from './types.ts'

type Cast = (changes: Change[]) => void

let idOf = `(select id from entity where eid = ?)`

let DAY = 86_400_000
export let STALE_DAYS = Number(Deno.env.get('TASKS_DREAM_STALE_DAYS')) || 12 * 7
export let LONG_CHARS = Number(Deno.env.get('TASKS_DREAM_LONG_CHARS')) || 4000
export let LONG_LINES = Number(Deno.env.get('TASKS_DREAM_LONG_LINES')) || 40
export let PERSONA_BYTES = Number(Deno.env.get('TASKS_DREAM_PERSONA_BYTES')) ||
  32_000
export let ERROR_COUNT = Number(Deno.env.get('TASKS_DREAM_ERROR_COUNT')) || 3
let LIMIT = Number(Deno.env.get('TASKS_DREAM_HYGIENE_LIMIT')) || 10
let NET = 60

// The safety contract belongs beside the code that enforces it, and also rides
// in the dream model's prompt. The model may notice; only this module writes,
// and what it writes is a proposal with pointers to the source entities.
export let HARD_SCOPE = `HARD SCOPE
MAY: identify merge, archive, shortening, persona-bloat, and recurring-error
candidates; propose review with pointers to the graph evidence.
MUST NOT: edit, archive, delete, merge, or supersede a memory or persona; decide
an operator-authored proposal; claim that a write landed. The caller validates
and writes proposals, then reads each artifact back before recording success.`

type MemoryRow = {
  eid: string
  title: string
  body: string
  created: string
  confirmed: string | null
  recalled: string | null
  retired: number
}

export type Candidate = {
  kind: 'merge' | 'archive' | 'shorten' | 'persona'
  key: string
  line: string
  targets: string[]
}

export type HygieneResult = {
  candidates: number
  errors: number
  filed: number
  recurred: number
  skipped: number
  verified: string[]
}

let fleet = (project: string) =>
  !!db.prepare(
    `select 1 from project p join entity e on e.id = p.entity
      where e.eid = ? and e.num = 19`,
  ).get(project)

// A venture owns its scoped memories. The Task Graph dream also owns the
// unscoped corpus and memories stranded under retired projects, so those rows
// are swept once even when a retired venture no longer dreams. Already archived
// or superseded memories have left the candidate pool: their review happened.
let memories = (project: string): MemoryRow[] =>
  db.prepare(
    `select e.eid, coalesce(d.title, '') as title,
            coalesce(d.body, '') as body, c.at as created,
            m.last_confirmed_at as confirmed, r.last_at as recalled,
            exists(
              select 1 from project p join archived a on a.entity = p.entity
               where p.entity = m.scope
            ) as retired
       from memory m
       join entity e on e.id = m.entity
       join doc_value d on d.entity = m.entity
       join created c on c.entity = m.entity
       left join recall r on r.entity = m.entity
      where (m.scope = ${idOf} or (? and (
        m.scope is null or exists (
          select 1 from project p join archived a on a.entity = p.entity
           where p.entity = m.scope
        )
      )))
        and not exists (select 1 from archived a where a.entity = m.entity)
        and not exists (
          select 1 from (${sentences('supersedes')}) dep
           where dep.child = m.entity
        )`,
  ).all(project, Number(fleet(project))) as MemoryRow[]

let digest = (s: string) =>
  createHash('sha256').update(s).digest('hex').slice(0, 24)

let pairCandidates = (rows: MemoryRow[]): Candidate[] => {
  let byEid = new Map(rows.map((r) => [r.eid, r]))
  let pairs = new Map<string, Candidate & { score: number }>()
  for (let row of rows) {
    let vec = stored(db, row.eid, textOf(row.title, row.body))
    if (!vec) continue
    for (let hit of similar(db, vec, NET, FLOOR)) {
      let other = byEid.get(hit.eid)
      if (!other || other.eid == row.eid) continue
      let ids = [row.eid, other.eid].sort()
      let key = `merge:${ids.join(':')}`
      if (pairs.has(key)) continue
      pairs.set(key, {
        kind: 'merge',
        key,
        line: `- merge ${human(db, ids[0])} + ${human(db, ids[1])} ` +
          `(similarity ${hit.score.toFixed(2)})`,
        targets: ids,
        score: hit.score,
      })
    }
  }
  return [...pairs.values()].sort((a, b) => b.score - a.score).slice(0, LIMIT)
}

let memoryCandidates = (
  rows: MemoryRow[],
  now: number,
): Candidate[] => {
  let before = now - STALE_DAYS * DAY
  let cold = rows.filter((r) =>
    r.retired &&
    Date.parse(r.recalled ?? r.confirmed ?? r.created) < before
  ).slice(0, LIMIT).map((r): Candidate => ({
    kind: 'archive',
    key: `archive:${r.eid}`,
    line: `- archive candidate ${human(db, r.eid)} — no use since ${
      (r.recalled ?? r.confirmed ?? r.created).slice(0, 10)
    }; scope is retired`,
    targets: [r.eid],
  }))
  let long = rows.filter((r) =>
    r.body.length > LONG_CHARS || r.body.split('\n').length > LONG_LINES
  ).sort((a, b) => b.body.length - a.body.length).slice(0, LIMIT)
    .map((r): Candidate => ({
      kind: 'shorten',
      key: `shorten:${r.eid}`,
      line: `- shorten ${human(db, r.eid)} — ${r.body.length} chars / ${
        r.body.split('\n').length
      } lines`,
      targets: [r.eid],
    }))
  return [...pairCandidates(rows), ...cold, ...long]
}

let personaCandidates = (project: string, now: number): Candidate[] => {
  let rows = db.prepare(
    `select e.eid from persona p join entity e on e.id = p.entity
      where p.home = ${idOf} or (? and (
        p.home is null or exists (
          select 1 from project hp join archived a on a.entity = hp.entity
           where hp.entity = p.home
        )
      ))`,
  ).all(project, Number(fleet(project))) as { eid: string }[]
  return rows.flatMap(({ eid }): Candidate[] => {
    let graph = personaGraph(db, [eid])
    let root = graph.all.find((r) => r.eid == eid)
    if (!root) return []
    let bytes = new TextEncoder().encode(
      materialize(graph.all, graph.deps, root, now),
    ).length
    if (bytes <= PERSONA_BYTES) return []
    return [{
      kind: 'persona',
      key: `persona:${eid}`,
      line: `- trim ${human(db, eid)} — materializes to ${bytes} bytes`,
      targets: [eid],
    }]
  }).sort((a, b) => a.key.localeCompare(b.key)).slice(0, LIMIT)
}

export let candidates = (project: string, now = Date.now()): Candidate[] => [
  ...memoryCandidates(memories(project), now),
  ...personaCandidates(project, now),
]

// Telemetry is fleet log data, so exactly one dream — the Task Graph home —
// owns it. recent() already cohorts identical failures; the threshold turns a
// one-off into recurrence, and the caller files the whole set as ONE task.
export let recurringErrors = (project: string, since: string): Log[] =>
  fleet(project)
    ? recent(db, { since, only: 'errors', limit: 500 })
      .filter((r) => (r.count ?? 1) >= ERROR_COUNT)
      .sort((a, b) => (b.count ?? 1) - (a.count ?? 1))
      .slice(0, LIMIT * 2)
    : []

type Artifact = {
  key: string
  title: string
  body: string
  project: string
  priority: number
  targets: string[]
}

let errorArtifact = (
  project: string,
  rows: Log[],
  since: string,
  now: number,
): Artifact | undefined => {
  if (!rows.length) return
  let shape = rows.map((r) => fingerprint(r)).sort().join('\n')
  let lines = rows.map((r) =>
    `- ${r.count ?? 1}× ${r.source}/${r.name} — ${
      (r.error ?? 'error').split('\n', 1)[0].slice(0, 160)
    }`
  )
  return {
    key: `hygiene:errors:${digest(shape)}`,
    title: 'triage recurring tool errors',
    body:
      `Recurring error cohorts observed through ${
        new Date(now).toISOString()
      }. Inspect current rows with \`task telemetry --errors --since=${since}\`.` +
      `\n\n${lines.join('\n')}`,
    project,
    priority: 2,
    targets: [],
  }
}

// The same derived status used by boards, expressed against the task alias in
// this keyed read. A claim row is the active lease; reaping deletes it.
let TASK_STATUS = `case
  when exists(select 1 from cancelled x where x.entity = t.entity) then 'cancelled'
  when exists(select 1 from completed x where x.entity = t.entity) then 'done'
  when exists(select 1 from claim x where x.entity = t.entity) then 'wip'
  else 'open'
end`

let filed = (key: string) =>
  db.prepare(
    `select e.eid, f.hits, (${TASK_STATUS}) as status, d.body,
            exists(select 1 from proposed p where p.entity = f.entity) as proposed,
            exists(select 1 from decided d where d.entity = f.entity) as decided
       from finding f
       join entity e on e.id = f.entity
       join task t on t.entity = f.entity
       join doc_value d on d.entity = f.entity
      where f.key = ? limit 1`,
  ).get(key) as
    | {
      eid: string
      hits: number | null
      status: string
      body: string
      proposed: number
      decided: number
    }
    | undefined

let oops = (comp: string, e: unknown) =>
  console.warn(`hygiene effect ${comp} —`, e)

let land = (changes: Change[], cast: Cast) => {
  commitEffects((t) => apply(db, changes, t), cast, oops)
}

type Filing = { fate: 'filed' | 'recurred' | 'skipped'; eid?: string }

// Every success verdict comes from a fresh keyed read after apply(). apply is
// atomic, but the readback is deliberately stronger: the action log can only
// name an artifact the graph now answers for with its proposal mark intact.
let file = (a: Artifact, cast: Cast): Filing => {
  let seen = filed(a.key)
  if (seen) {
    if (seen.status != 'open' || seen.decided) {
      return { fate: 'skipped' }
    }
    let hits = (seen.hits ?? 1) + 1
    land([
      { eid: seen.eid, name: 'doc', comp: { body: a.body } },
      {
        eid: seen.eid,
        name: 'finding',
        comp: { hits, last: new Date().toISOString() },
      },
    ], cast)
    let after = filed(a.key)
    if (
      after?.eid != seen.eid || after.hits != hits || after.body != a.body ||
      !after.proposed
    ) throw new Error(`hygiene readback failed: ${human(db, seen.eid)}`)
    return { fate: 'recurred', eid: seen.eid }
  }
  let eid = uuid()
  land([
    { eid, name: 'doc', comp: { title: a.title, body: a.body } },
    {
      eid,
      name: 'task',
      comp: { priority: a.priority, project: a.project },
    },
    { eid, name: 'proposed', comp: {} },
    {
      eid,
      name: 'finding',
      comp: { key: a.key, hits: 1, last: new Date().toISOString() },
    },
    ...a.targets.map((child) => ({
      eid,
      name: 'dependency',
      comp: { type: 'about', child },
    } as Change)),
  ], cast)
  let after = filed(a.key)
  if (after?.eid != eid || after.hits != 1 || !after.proposed) {
    throw new Error(`hygiene readback failed: ${human(db, eid)}`)
  }
  return { fate: 'filed', eid }
}

export let hygieneSweep = (
  project: string,
  since: string,
  cast: Cast,
  now = Date.now(),
): HygieneResult => {
  let found = candidates(project, now)
  let errors = recurringErrors(project, since)
  // Memory candidates are counted but never filed: each sweep's candidate set
  // differed, so every run minted a fresh "review memory hygiene candidates"
  // task (ten open duplicates on one persona), and the owner's direction is
  // that agents do not file memory process work on his board (M-31946).
  // Recurring errors are telemetry, which he values, so those still file.
  let artifacts = [errorArtifact(project, errors, since, now)]
    .filter((a): a is Artifact => !!a)
  let result: HygieneResult = {
    candidates: found.length,
    errors: errors.length,
    filed: 0,
    recurred: 0,
    skipped: 0,
    verified: [],
  }
  for (let artifact of artifacts) {
    let made = file(artifact, cast)
    result[made.fate]++
    if (made.eid) result.verified.push(made.eid)
  }
  return result
}
