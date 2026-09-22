// Writing a row. Recording is best-effort by design: a telemetry failure must
// never break what it is measuring, so `record` catches the error and logs a
// warning. A `record` that tried to record its own failed insert would turn one
// broken call into a loop, so a `record` call made from inside another one is
// dropped.

import type { Driver } from './driver.ts'
import { type Source, TABLE } from './ddl.ts'
import { scrub } from './scrub.ts'

/**
 * What a caller reports. `ok` is the only verdict: a tool that returned an
 * error is a call that happened and failed, and both facts matter.
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

/** Insert one call. Never throws. */
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
