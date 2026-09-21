// The tools an agent can call here: the module exported as
// `@yaks/sqlite/tools`, holding the implementations behind the `tool: true`
// declarations in ./vocab.json. Both are CHECKS: tools whose verb is `check`,
// which is all a "doctor" command is (@yaks/tools ./check.ts).
//
// These are the checks that cannot be run as graph queries. An orphaned
// component row and a reference to an entity that is gone are invisible to
// every query by construction — a read starts from the spine, so a row with no
// spine is not there to be found, which is exactly why the fleet's copies of
// them went unnoticed for months. They are questions about the FILE, so they
// belong to the package that owns the file, and they are run against the
// connection (`host.sql`), not the store.
//
// WHAT THE SCHEMA ALREADY PREVENTS is most of it: every component table keys
// to `entity(id)` and every reference carries a foreign key, so neither state
// can be WRITTEN while foreign keys are on (./ddl.ts). That makes this check
// cheap and precise instead of a scan: ask SQLite whether enforcement is on,
// and ask it which rows violate a key. A file that was written by a connection
// with `foreign_keys` off is how the impossible gets in, and that is the one
// thing worth reporting. A `keep` reference is deliberately key-free — it
// outlives the row it names, which is what "kept as history" means — so it is
// never a finding here.
//
// THE ARCHETYPE POINTER is the same kind of question. @yaks/archetype
// maintains it inside the transaction, and ./archetype.ts `drift` reads the
// physical presence it should describe; a raw writer that inserts rows without
// naming the owners it touched leaves a pointer both the read path and the
// query planner trust. @yaks/archetype cannot run this check — it knows
// component sets and moves, not tables — so it lives here, where the file is.

import type { Runs } from '@yaks/graph/tools'
import { checked, type Finding } from '@yaks/tools'
import { drift } from './archetype.ts'
import { componentTables } from './physical.ts'
import type { Driver, Row } from './driver.ts'

/** What configuration this package's checks accept. */
export type Options = {
  /** how many drifted entities to name (default 12) */
  sample?: number
}

let SAMPLE = 12

// `pragma foreign_key_check` returns one row per violation: the table holding
// it, its rowid, and which of that table's foreign keys it broke.
type Violation = { table?: unknown; parent?: unknown; rowid?: unknown }

let tally = (rows: Row[]): Map<string, number> => {
  let out = new Map<string, number>()
  for (let r of rows as Violation[]) {
    let said = `${String(r.table)} → ${String(r.parent)}`
    out.set(said, (out.get(said) ?? 0) + 1)
  }
  return out
}

/** The implementations behind the tools ./vocab.json declares — over the
 * calling application's own connection, which is why this is a factory. */
export let runs = (
  host: { sql: Driver },
  options: Options = {},
): Runs => ({
  storage_check: (_bundles, ctx) => {
    let found: Finding[] = []
    // Enforcement first: every finding below is only as reliable as this
    // pragma, and a file written with it off is how a broken key gets in at
    // all.
    let on = host.sql.query('pragma foreign_keys', [])[0]
    if (!Number(Object.values(on ?? {})[0] ?? 0)) {
      found.push({
        level: 'warn',
        text: 'this connection has `foreign_keys` off — the schema stops ' +
          'orphaned rows and dangling references only while it is on, and a ' +
          'writer that opened the file this way could have left either',
      })
    }
    for (
      let [said, n] of tally(host.sql.query('pragma foreign_key_check', []))
    ) {
      found.push({
        level: 'fail',
        text: `${said}: ${n} row(s) point at an entity that is not there — ` +
          `a component row with no spine, or a reference to a deleted entity`,
      })
    }
    let verdict = host.sql.query('pragma integrity_check', [])[0]
    let said = String(Object.values(verdict ?? {})[0] ?? 'unknown')
    if (said != 'ok') {
      found.push({
        level: 'fail',
        text: `SQLite's own integrity check answers ${said}`,
      })
    }
    return checked(
      ctx.call,
      'the file holds no orphaned row and no broken reference',
      found,
    )
  },

  archetype_check: (_bundles, ctx) => {
    let about = 'every archetype pointer matches the components its owner wears'
    // An application that never composed @yaks/archetype has no such table and
    // no pointers to disagree with anything. Reporting that beats an audit that
    // reads every entity as drifted because nothing ever classified one.
    if (!componentTables(host.sql).includes('archetype')) {
      return checked(ctx.call, about, [{
        level: 'warn',
        text: 'this file keeps no archetypes (@yaks/archetype is not ' +
          'composed here), so there is no pointer to check',
      }])
    }
    let sample = options.sample ?? SAMPLE
    let d = drift(host.sql, sample)
    let rest = d.drifted - d.sample.length
    return checked(
      ctx.call,
      about,
      d.drifted
        ? [{
          level: 'fail',
          text: `${d.drifted} of ${d.checked} pointer(s) disagree with the ` +
            `tables their owner has rows in: ${d.sample.join(', ')}` +
            `${rest > 0 ? `, and ${rest} more` : ''}. Something wrote rows ` +
            `past the graph without naming the owners it touched, or this ` +
            `file was never classified at all (./archetype.ts backfill)`,
        }]
        : [],
    )
  },
})
