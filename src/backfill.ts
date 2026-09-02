// Explicit historical materializations: read a co-located graph through the
// shared SQLite generators, then hand ordinary Change batches to a caller's
// generic write boundary. This module never writes SQLite itself — /apply or
// the in-process MCP write capability remains the one graph mutation path.
import { DatabaseSync } from './store/sqlite.ts'
import { historicalWorked } from './db.ts'
import { historicalReferenced } from './reference_changes.ts'
import { type Change, uuid } from './types.ts'
import { type EntrySpec } from './entries.ts'
import { absorbedSpec } from './ingest.ts'

export let backfillKinds = ['worked', 'referenced', 'prompt'] as const
export type BackfillKind = typeof backfillKinds[number]

// The `prompt` tag for user entries ingested before ingest stamped it: each
// native user entry names the transcript line it came from (imported
// source/line) and its session names the transcript, so re-read that one
// line and tag the entry when the harness marked the turn as typed
// (origin.kind 'human' — the same test ingest.ts applies live). One
// transcript is held at a time; a missing or rewritten file yields nothing.
export let historicalPrompts = (
  db: DatabaseSync,
  read = (path: string) => Deno.readTextFileSync(path),
): Change[] => {
  let rows = db.prepare(
    `select o.eid as eid, i.line as line, s.transcript as path
       from entry t
       join entity o on o.id = t.entity
       join imported i on i.entity = t.entity and i.source = 'native'
       join message m on m.entity = t.entity and m.role = 'user'
       join session s on s.entity = t.session
       left join prompt p on p.entity = t.entity
      where p.entity is null and s.transcript is not null
      order by s.transcript, i.line`,
  ).all() as { eid: string; line: number; path: string }[]
  let held: { path: string; lines: string[] } | undefined
  let linesOf = (path: string) => {
    if (held?.path != path) {
      let text = ''
      try {
        text = read(path)
      } catch { /* gone or unreadable — nothing to tag */ }
      held = { path, lines: text.split('\n') }
    }
    return held.lines
  }
  let lineOf = (path: string, n: number) => linesOf(path)[n - 1] ?? ''
  let typed = (raw: string) => {
    try {
      let e = JSON.parse(raw)
      return e?.type == 'user' && e.origin?.kind == 'human'
    } catch {
      return false
    }
  }
  let tags = rows
    .filter((r) => typed(lineOf(r.path, r.line)))
    .map((r): Change => ({ eid: r.eid, name: 'prompt', comp: {} }))
  // Turns the harness absorbed mid-turn (ingest.ts absorbedTurn) in sessions
  // that have ENDED. An open session's whole transcript is re-read by the
  // live tailer and the boot reconcile, which ingest what they now
  // recognize; a finished session is never read again, so its absorbed turns
  // are minted here. Born over the wire they carry no source coordinate and
  // are stamped at backfill time, so the dedup is the turn's own text among
  // the session's prompt-tagged turns.
  let ended = db.prepare(
    `select o.eid as eid, s.transcript as path from session s
       join entity o on o.id = s.entity
      where s.transcript is not null and s.finished_at is not null
        and coalesce(s.origin, '') != 'managed'
      order by s.transcript`,
  ).all() as { eid: string; path: string }[]
  let saidIn = (session: string) =>
    new Set(
      (db.prepare(
        `select c.body as body from entry e
           join prompt p on p.entity = e.entity
           join message m on m.entity = e.entity and m.role = 'user'
           join content c on c.entity = e.entity
          where e.session = (select id from entity where eid = ?)`,
      ).all(session) as { body: string }[]).map((r) => r.body),
    )
  let turns: Change[] = []
  for (let s of ended) {
    let said: Set<string> | undefined
    for (let raw of linesOf(s.path)) {
      let spec: EntrySpec | undefined
      try {
        spec = absorbedSpec(JSON.parse(raw))
      } catch {
        continue
      }
      if (!spec) continue
      said ??= saidIn(s.eid)
      let body = String(spec.content.body)
      if (said.has(body)) continue
      said.add(body)
      let eid = uuid()
      turns.push(
        { eid, name: 'entry', comp: { session: s.eid } },
        ...Object.entries(spec).map(([name, comp]): Change => ({
          eid,
          name,
          comp,
        })),
      )
    }
  }
  return [...tags, ...turns]
}

let generators: Record<BackfillKind, (db: DatabaseSync) => Change[]> = {
  worked: historicalWorked,
  referenced: historicalReferenced,
  prompt: historicalPrompts,
}

export let backfillChanges = (db: DatabaseSync, kind: BackfillKind) =>
  generators[kind](db)

export let readBackfill = (path: string, kind: BackfillKind) => {
  let db = new DatabaseSync(path, { readOnly: true })
  db.exec('pragma busy_timeout = 5000')
  try {
    return backfillChanges(db, kind)
  } finally {
    db.close()
  }
}

export type BackfillProgress = {
  found: number
  submitted: number
  landed: number
}

export let landBackfill = async (
  pending: Change[],
  write: (changes: Change[]) => Promise<Change[]>,
  progress: (state: BackfillProgress) => void = () => {},
): Promise<BackfillProgress> => {
  let state = { found: pending.length, submitted: 0, landed: 0 }
  progress(state)
  for (let i = 0; i < pending.length; i += 200) {
    let batch = pending.slice(i, i + 200)
    let out = await write(batch)
    state = {
      ...state,
      submitted: state.submitted + batch.length,
      landed: state.landed +
        out.filter((c) => c.name == 'dependency' || c.name == 'prompt').length,
    }
    progress(state)
    // The old server route yielded between chunks so a large historical sweep
    // could not monopolize its event loop. Preserve that property for the
    // in-process MCP writer; HTTP callers already yield while send() resolves.
    if (state.submitted < state.found) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return state
}
