// The fleet's half of archetype classification. @yaks/sqlite's `reclassify()`
// does the work — presence read from the physical file, inside the caller's
// transaction — and this file owns only what the fleet adds to it: the driver
// that classification runs through, and the wire shape its bundles take as
// fleet Changes.
//
// THE CONTRACT. There is no queue and there are no triggers: a row written
// past the graph (a server stamp, a redaction, an embedding, a recall) must
// NAME the owners it touched, or the owner keeps a pointer that no longer
// describes it — and both the read door and the query planner trust that
// pointer. The eids are never news: `record()` names the batch it journals,
// which is the same list a raw writer already owes the journal.
import { type Driver, reclassify } from '@yaks/sqlite'
import { STOCK } from '@yaks/sql'
import type { Change } from '../types.ts'
import type { Sql, Statement } from './sql.ts'

// One driver per handle, with its own prepared statements: @yaks/sqlite caches
// the facet-table list against the driver object, so a fresh one per write
// would re-read the schema every time. The statements stay out of db.ts's
// cache on purpose — a presence probe per facet table is not an N+1 the
// request's hop tally should report.
let caches = new WeakMap<
  Sql,
  { driver: Driver; prep: (s: string) => Statement }
>()
let cacheFor = (db: Sql) => {
  let held = caches.get(db)
  if (!held) {
    let statements = new Map<string, Statement>()
    let prep = (sql: string) => {
      let stmt = statements.get(sql)
      if (!stmt) statements.set(sql, stmt = db.prepare(sql))
      return stmt
    }
    caches.set(
      db,
      held = {
        prep,
        driver: {
          query: (sql, params) => prep(sql).all(...params),
          exec: (sql) => db.exec(sql),
          // Classification runs inside the caller's write transaction — that is
          // the contract — and a failure must roll THAT batch back, so the
          // package's unit() needs no savepoint of its own here. A caller
          // without a transaction gets one.
          tx: (body) => db.inTransaction ? body() : db.transaction(body, true),
          arms: STOCK,
        },
      },
    )
  }
  return held
}

/**
 * Classify the named owners from their physical presence, inside the caller's
 * transaction: the pointer moves and any descriptor born, as the changes the
 * journal and the live cast carry. An owner already wearing the right
 * descriptor costs a presence probe and nothing else.
 */
export let classify = (db: Sql, eids: Iterable<string>): Change[] => {
  let named = [...new Set(eids)]
  if (!named.length) return []
  let { driver, prep } = cacheFor(db)
  let gone = prep(
    'select 1 from tombstone where entity = (select id from entity where eid = ?)',
  )
  // Fleet numbers explicitly (the numbers plugin), so a descriptor is born bare.
  return reclassify(driver, named, false).flatMap((b): Change[] => {
    let eid = b.entity.eid
    let archetype = b.entity.archetype as string
    if (b.archetype) {
      return [
        { eid, name: 'entity', comp: { eid, num: null, archetype } },
        { eid, name: 'archetype', comp: b.archetype as Change['comp'] },
      ]
    }
    // The physical tombstone is classified, but its wire event remains a
    // deletion. A later metadata patch would resurrect it during delta replay.
    return gone.get(eid) ? [] : [{ eid, name: 'entity', comp: { archetype } }]
  })
}
