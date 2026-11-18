// Rebuildable SQLite caches stay at their path and inode: another process may
// still have them open. Their file-URL columns identify entries nobody can use
// once the source is gone; deleting and vacuuming returns their pages in place.
import * as io from '@yaks/file/io'
import { col, type Driver, oneOf, select, table } from '@yaks/sql'
import { Database } from './legacy.ts'
import { driver } from './native.ts'
import { unit } from './unit.ts'

/** A rebuildable database's byte budget and its tables' file-URL columns.
 * Tables not named here, such as cache version metadata, are kept. */
export type Cache = { most: number; tables: Record<string, string> }

/** The bytes a cache and its SQLite WAL occupy, without the shared-memory
 * index, whose size is unrelated to the bytes stored. */
export let held = async (path: string): Promise<number> => {
  let sizes = await Promise.all([path, path + '-wal'].map(async (p) => {
    try {
      return (await io.stat(p)).size
    } catch (error) {
      if (io.isNotFound(error)) return 0
      throw error
    }
  }))
  return sizes.reduce((sum, n) => sum + n, 0)
}

let missing = (specifier: string): boolean => {
  try {
    io.statSync(io.fileURLToPath(specifier))
    return false
  } catch (error) {
    if (io.isNotFound(error) || io.isNotADirectory(error)) return true
    if (io.isPermissionDenied(error)) return false
    throw error
  }
}

/** Remove entries for missing local files through a cache's declared columns.
 * Remote specifiers and unreadable local files stay cached. */
export let prune = (
  db: Driver,
  tables: Cache['tables'],
  gone: (specifier: string) => boolean = missing,
): number => {
  let removed = 0
  for (let [name, key] of Object.entries(tables)) {
    let rows = db.query(select({
      distinct: true,
      cols: [col(key)],
      from: table(name),
      where: {
        t: 'op',
        op: 'like',
        parts: [col(key), { t: 'val', v: 'file:%' }],
      },
    }))
    let stale = rows.map((r) => String(r[key])).filter(gone)
    if (!stale.length) continue
    let change = {
      t: 'delete' as const,
      from: name,
      where: oneOf(col(key), stale),
    }
    removed += unit(
      db,
      () => db.run?.(change) ?? (db.query(change), stale.length),
    )
  }
  return removed
}

let compact = (db: Driver) => {
  db.query({ t: 'vacuum' })
  let [checkpoint] = db.query({
    t: 'pragma',
    name: 'wal_checkpoint',
    value: 'truncate',
  })
  if (checkpoint?.busy) throw new Error('cache checkpoint is busy')
}

/** Trim a cache over budget in place. Missing sources go first; if its live
 * entries still exceed the budget, clear its rebuildable tables. The database
 * and its WAL are never unlinked, including while another connection uses it.
 * Returns bytes reclaimed. A cache that does not exist is left absent. */
export let trim = async (path: string, cache: Cache): Promise<number> => {
  let before = await held(path)
  if (before <= cache.most) return 0
  let db = driver(new Database(path, { create: false }))
  try {
    db.query({ t: 'pragma', name: 'busy_timeout', value: 1000 })
    prune(db, cache.tables)
    compact(db)
    if (await held(path) > cache.most) {
      unit(db, () => {
        for (let name of Object.keys(cache.tables)) {
          db.query({ t: 'delete', from: name })
        }
      })
      compact(db)
    }
    return Math.max(0, before - await held(path))
  } finally {
    db.close()
  }
}
