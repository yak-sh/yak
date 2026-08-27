// Explicit historical materializations: read a co-located graph through the
// shared SQLite generators, then hand ordinary Change batches to a caller's
// generic write boundary. This module never writes SQLite itself — /apply or
// the in-process MCP write capability remains the one graph mutation path.
import { DatabaseSync } from './sqlite.ts'
import { historicalWorked } from './db.ts'
import { historicalReferenced } from './reference_changes.ts'
import { type Change } from './types.ts'

export let backfillKinds = ['worked', 'referenced'] as const
export type BackfillKind = typeof backfillKinds[number]

let generators: Record<BackfillKind, (db: DatabaseSync) => Change[]> = {
  worked: historicalWorked,
  referenced: historicalReferenced,
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
      landed: state.landed + out.filter((c) => c.name == 'dependency').length,
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
