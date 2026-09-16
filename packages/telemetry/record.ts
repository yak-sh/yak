// Writing a row. Recording is best-effort BY CONTRACT: a telemetry failure
// must never break the thing it watches, so `record` swallows and warns. A
// record that observes its own append failure would turn one broken call into
// a loop, so a re-entrant record is dropped, not chased.

import type { Driver } from './driver.ts'
import { type Source, TABLE } from './ddl.ts'
import { scrub } from './scrub.ts'

/**
 * What a caller reports. `ok` is the only judgement: a tool that answered with
 * an error is a call that happened AND failed, and both facts matter.
 */
export type Call = {
  source: Source
  name: string
  session_id?: string | null
  ok: boolean
  ms?: number | null
  error?: string | null
  detail?: string | null
}

let inside = false

/** Append one call. Never throws. */
export let record = (db: Driver, c: Call): void => {
  if (inside) return
  inside = true
  try {
    db.query(
      `insert into "${TABLE}" (source, name, session_id, ok, ms, error, detail)
       values (?, ?, ?, ?, ?, ?, ?)`,
      [
        c.source,
        c.name,
        c.session_id ?? null,
        Number(c.ok),
        c.ms == null ? null : Math.round(c.ms),
        scrub(c.error),
        scrub(c.detail),
      ],
    )
  } catch (e) {
    console.warn('telemetry: row dropped —', e)
  } finally {
    inside = false
  }
}
