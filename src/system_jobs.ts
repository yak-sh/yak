// In-process jobs with graph-backed tuning and decision records. Only code
// registered here runs; historical role rows never create or stop operators.
import { locate, readComp, record } from './db.ts'
import { db } from './live_db.ts'
import { isRef } from './props.ts'
import { errorChange, healthChange } from './deliver.ts'
import { type Change } from './types.ts'

type Cast = (changes: Change[]) => void
type DbRow = Record<string, unknown>
let OWNED = `entity = (select id from entity where eid = ?)`
let bindOf = (comp: string, col: string) =>
  isRef(comp, col) ? `(select id from entity where eid = ?)` : '?'

export let stamp = (eid: string, patch: DbRow, cast: Cast) => {
  let prior = readComp(db, eid, 'role') as DbRow | undefined
  if (!prior) return
  // decided_at names when the DECISION was made, so only a new decision (or
  // a new observed holder) restamps it — a reason that merely rewords itself
  // ("1 waiting" → "2 waiting") is the same decision. A field the patch omits
  // stays at its prior value (the moved-filter below never writes it), so
  // omission counts as "unchanged" too: comparing an absent key as undefined
  // once made the native adopt path look like news on every pass, and the 2s
  // liveness loop rewrote+broadcast decided_at forever.
  if (
    (['decision', 'observed'] as const).every((k) =>
      !Object.hasOwn(patch, k) || patch[k] === prior[k]
    )
  ) delete patch.decided_at
  let failure = Object.hasOwn(patch, 'error') ? patch.error : undefined
  let role = Object.fromEntries(
    Object.entries(patch).filter(([key]) => key != 'error'),
  )
  let moved = Object.fromEntries(
    Object.entries(role).filter(([key, value]) => prior[key] !== value),
  )
  let cols = Object.keys(moved)
  let changes: Change[] = []
  db.transaction(() => {
    if (cols.length) {
      db.prepare(
        `update role set ${
          cols.map((c) => `"${c}" = ${bindOf('role', c)}`).join(', ')
        }
         where ${OWNED}`,
      ).run(...cols.map((c) => moved[c] as string | number | null), eid)
      changes.push({ eid, name: 'role', comp: moved })
    }
    if (failure !== undefined) {
      let change = failure
        ? errorChange(eid, String(failure))
        : healthChange(eid)
      if (change) changes.push(change)
    }
    if (changes.length) record(db, changes)
  })
  if (changes.length) cast(changes)
}

export type SystemTuning = { quiet: number; cooldown: number; cap?: number }
export type SystemSpec = {
  alias: string // the role entity's alias slug, and the registry key
  defaults: SystemTuning // seconds; a null graph column falls back here
  run: (t: SystemTuning, cast: Cast) => { reason: string; observed?: string }
}

let systems = new Map<string, SystemSpec>()
export let registerSystem = (s: SystemSpec) => systems.set(s.alias, s)

// One system reconcile: gate on state, run the handler with graph-tuned
// values, record the decision. A throw stamps the error facet and keeps the
// role row as the place the failure is read (M-16612) — the next pass retries.
let reconcileSystem = (
  eid: string,
  spec: SystemSpec,
  cast: Cast,
  now: () => string,
) => {
  let row = db.prepare(
    `select state, quiet, cooldown, cap from role where ${OWNED}`,
  ).get(eid) as
    | {
      state: string
      quiet: number | null
      cooldown: number | null
      cap: number | null
    }
    | undefined
  if (!row) return
  if (row.state != 'running') {
    stamp(eid, {
      decision: 'skip',
      reason: `state ${row.state}`,
      observed: null,
      decided_at: now(),
    }, cast)
    return
  }
  try {
    let out = spec.run({
      quiet: Number(row.quiet ?? spec.defaults.quiet),
      cooldown: Number(row.cooldown ?? spec.defaults.cooldown),
      ...(spec.defaults.cap != null
        ? { cap: Number(row.cap ?? spec.defaults.cap) }
        : {}),
    }, cast)
    stamp(eid, {
      decision: out.observed ? 'spawn' : 'skip',
      reason: out.reason,
      observed: out.observed ?? null,
      decided_at: now(),
      error: null,
    }, cast)
  } catch (e) {
    stamp(eid, { error: String(e).slice(0, 2000) }, cast)
  }
}

// Graph rows retain the existing job controls; no role can launch an operator.
export let systemSweep = (cast: Cast, now = () => new Date().toISOString()) => {
  for (let spec of systems.values()) {
    let eid = locate(db, spec.alias)
    if (eid && readComp(db, eid, 'role')) {
      reconcileSystem(eid, spec, cast, now)
    } else {
      try {
        spec.run(spec.defaults, cast)
      } catch (e) {
        console.warn(`${spec.alias} sweep —`, e)
      }
    }
  }
}
