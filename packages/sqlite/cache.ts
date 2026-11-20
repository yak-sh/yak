// Rebuildable SQLite caches stay at their path and inode: another process may
// still have them open. Deno's own caches are open in this one too, through
// the SQLite built into Deno, so a cache is opened only through that copy
// (./builtin.ts). Their file-URL columns identify entries nobody can use
// once the source is gone; deleting and vacuuming returns their pages in place.
// A trim waits on the disk, on file checks, a vacuum and its lock, so a
// process runs it on a thread of its own (./cache_worker.ts).
import * as io from '@yaks/file/io'
import { col, type Driver, oneOf, select, table } from '@yaks/sql'
import { builtin } from './builtin.ts'
import { busy, malformed } from './error.ts'
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

/** Vacuum and truncate the WAL. False while another connection reads the
 * cache: the vacuumed pages stay in the WAL until a later pass. */
let compact = (db: Driver): boolean => {
  db.query({ t: 'vacuum' })
  let [checkpoint] = db.query({
    t: 'pragma',
    name: 'wal_checkpoint',
    value: 'truncate',
  })
  return !checkpoint?.busy
}

let shrink = async (path: string, cache: Cache) => {
  let db = builtin(path)
  try {
    db.query({ t: 'pragma', name: 'busy_timeout', value: 1000 })
    prune(db, cache.tables)
    if (!compact(db) || await held(path) <= cache.most) return
    unit(db, () => {
      for (let name of Object.keys(cache.tables)) {
        db.query({ t: 'delete', from: name })
      }
    })
    compact(db)
  } finally {
    db.close()
  }
}

/** A malformed cache is rebuildable, not data: its files are removed, WAL
 * first, so the owner rebuilds it at the same path. */
let discard = async (path: string) => {
  for (let p of [path + '-wal', path + '-shm', path]) {
    await io.remove(p).catch((error) => {
      if (!io.isNotFound(error)) throw error
    })
  }
}

/** Trim a cache over budget in place. Missing sources go first; if its live
 * entries still exceed the budget, clear its rebuildable tables. The database
 * and its WAL are never unlinked while it is readable, including while another
 * connection uses it; a malformed one is removed for its owner to rebuild. A
 * cache another connection holds busy waits for the next pass. Returns bytes
 * reclaimed. A cache that does not exist is left absent. Its file checks and
 * vacuum block the calling thread; {@link threaded} runs it on its own. */
export let trim = async (path: string, cache: Cache): Promise<number> => {
  let before = await held(path)
  if (before <= cache.most) return 0
  try {
    await shrink(path, cache)
  } catch (error) {
    if (malformed(error)) await discard(path)
    else if (!busy(error)) throw error
  }
  return Math.max(0, before - await held(path))
}

/** What the trim thread answers. */
export type Trimmed = { value: number } | { error: string }

/** {@link trim} on a thread of its own, so no disk stall holds the caller's. */
export let threaded = (path: string, cache: Cache): Promise<number> =>
  new Promise((resolve, reject) => {
    let worker = new Worker(new URL('./cache_worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = ({ data }: MessageEvent<Trimmed>) => {
      worker.terminate()
      'value' in data ? resolve(data.value) : reject(new Error(data.error))
    }
    worker.onerror = (e) => {
      e.preventDefault()
      worker.terminate()
      reject(e.error ?? new Error(e.message))
    }
    worker.postMessage({ path, cache })
  })
