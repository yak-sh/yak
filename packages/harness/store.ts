import { repairSequences } from '@yaks/session'
import { diagnostics } from './diagnostics.ts'
import { home } from './paths.ts'
// The harness's own graph: one SQLite file, the vocabulary it speaks, and the
// plugins that decide what a batch means. Nothing here reaches a server — the
// harness holds its whole world in `~/.harness/harness.db` (or wherever
// `HARNESS_DB` points, `:memory:` for a test), so an agent runs with the
// tasks daemon down and the same bundles move into the fleet's graph later.
//
// What the harness is MADE of is said once, in ./plugin.ts: the documents it
// speaks, the columns it computes rather than keeps, and the rules that decide
// what a batch means. This file takes those same facets for the harness's own
// file, and a host composing the harness (@yaks/cli `compose`) takes them for
// a served one. What is here and not there is BOOT: the upgrades an older file
// needs, and the reconciliation an abnormal ending leaves behind.
//
// Boot reconciles what an abnormal ending leaves behind: `reapLeases` frees
// every lock whose holder is not a session in this graph. What a half-done
// STEP leaves is reconciled a rung up, by run.ts `resume()`, because waking a
// transcript needs a model and this file has none.

import {
  address,
  type Blobs,
  blobSchema,
  bodies,
  encode,
  sqliteBlobs,
} from '@yaks/blob'
import { Database, driver } from '@yaks/sqlite/db'
import { type Effects, effects } from '@yaks/effects'
import { type Graph, graph } from '@yaks/graph'
import { reapLeases } from '@yaks/session'
import { type Driver, migrations, storage, type Store } from '@yaks/sqlite'
import { type Vocab } from '@yaks/vocab'

import { derived, rules } from './plugin.ts'
import { vocab } from './vocab.ts'
export { harnessDoc, vocab } from './vocab.ts'

/** Where the graph lives when nobody says: `$HARNESS_DB`, else
 * `$HARNESS_HOME/harness.db` (home defaults to `~/.harness`). */
export let dbPath = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_DB') || `${home(env)}/harness.db`

/** An open harness graph: the file it is, the store under it, the graph over
 * it, and the effects registry the daemon hangs on. */
export type Harness = {
  path: string
  db: Database
  store: Store
  g: Graph
  fx: Effects
  vocab: Vocab
  migrations: ReturnType<typeof migrations>
  close: () => void
}

/**
 * Open (or create) the harness graph and reconcile it.
 *
 * ```ts
 * import { open } from '@yaks/harness'
 *
 * let h = open(':memory:')
 * h.close()
 * ```
 */
/** Move every body column this vocabulary marks `store: blob` into the blob
 * table, once. A marker row decides, never the shape of the text: a body that
 * happens to read like a hash is prose like any other, and re-running the sweep
 * over already-addressed rows would address the addresses. The marker and the
 * rows it speaks for commit together, so a half-moved database cannot exist. */
let toBlobs = (sql: Driver, bytes: Blobs) => {
  let quote = (name: string) => '"' + name.replaceAll('"', '""') + '"'
  sql.exec('begin immediate')
  try {
    for (let statement of blobSchema()) sql.exec(statement)
    sql.exec(
      'create table if not exists harness_upgrade (name text primary key)',
    )
    let done = sql.query(
      "select name from harness_upgrade where name = 'blob-v1'",
      [],
    ).length
    if (!done) {
      for (let { comp, prop } of bodies(vocab)) {
        let rows = sql.query(
          'select entity, ' + quote(prop) + ' as body from ' + quote(comp) +
            ' where ' + quote(prop) + ' is not null',
          [],
        )
        for (let row of rows) {
          let body = String(row.body)
          let sha = address(body)
          bytes.put(sha, encode(body))
          sql.query(
            'update ' + quote(comp) + ' set ' + quote(prop) +
              ' = ? where entity = ?',
            [sha, Number(row.entity)],
          )
        }
      }
      sql.exec("insert into harness_upgrade values ('blob-v1')")
    }
    sql.exec('commit')
  } catch (error) {
    sql.exec('rollback')
    throw error
  }
}

export let open = (path: string = dbPath()): Harness => {
  if (path != ':memory:') {
    let dir = path.slice(0, path.lastIndexOf('/'))
    if (dir) Deno.mkdirSync(dir, { recursive: true })
  }
  let db = new Database(path)
  db.exec('pragma foreign_keys = on')
  // A file is read by a person's `ls` while an agent writes it; a memory
  // database has no journal to move.
  if (path != ':memory:') {
    db.exec('pragma journal_mode = wal')
    // NORMAL is WAL's crash-safe pairing: checkpoints fsync; power loss may lose recent commits.
    db.exec('pragma synchronous = normal')
    db.exec('pragma busy_timeout = 5000')
  }
  let sql = driver(db)
  const migration = migrations(sql)
  try {
    migration.ready()
  } catch (error) {
    db.close()
    throw error
  }
  let bytes = sqliteBlobs(sql)
  let store = storage(sql, vocab, {
    // Agent sessions, TUI microtasks and transcript artifacts use eids.
    number: false,
    derived: derived(vocab),
  })
  store.install()
  // The short-lived completed.actor spelling duplicated the completion
  // author. Preserve that author (including anonymous nulls), not the old
  // work-attribution value in by. The column itself is the migration guard.
  sql.exec('begin immediate')
  try {
    if (
      sql.query('pragma table_info(completed)', []).some((c) =>
        c.name == 'actor'
      )
    ) {
      sql.exec('update completed set "by" = actor')
      sql.exec('drop index if exists completed_actor')
      sql.exec('alter table completed drop column actor')
    }
    sql.exec('commit')
  } catch (error) {
    sql.exec('rollback')
    db.close()
    throw error
  }
  // Provenance moved off the prose it describes: a model's words were
  // `content{body, source}`, and direction was read from whether `source` was
  // set. It is `output{source}` now, worn only by an output. The old column is
  // the migration's own guard — once it is gone the pass is over.
  sql.exec('begin immediate')
  try {
    if (
      sql.query('pragma table_info(content)', []).some((c) =>
        c.name == 'source'
      )
    ) {
      sql.exec(
        'insert or ignore into "output" (entity, "source")' +
          ' select entity, "source" from "content" where "source" is not null',
      )
      sql.exec('drop index if exists content_source')
      sql.exec('alter table "content" drop column "source"')
    }
    sql.exec('commit')
  } catch (error) {
    sql.exec('rollback')
    db.close()
    throw error
  }
  // A lock's timestamp is `claim.at` now, the word every other mark uses.
  // `install` above has already planted the new column; this carries the taken
  // moment across and takes the old spelling away, which is its own guard.
  sql.exec('begin immediate')
  try {
    if (
      sql.query('pragma table_info(claim)', []).some((c) =>
        c.name == 'claimed_at'
      )
    ) {
      sql.exec('update claim set at = claimed_at where at is null')
      sql.exec('drop index if exists claim_claimed_at')
      sql.exec('alter table claim drop column claimed_at')
    }
    sql.exec('commit')
  } catch (error) {
    sql.exec('rollback')
    db.close()
    throw error
  }
  // Sequence high-water was captured by install before clearing historical
  // entry numbers. No remaining human identifier is renumbered or reused.
  sql.exec(
    'update entity set num = null where num is not null and id in (select entity from entry)',
  )
  try {
    toBlobs(sql, bytes)
  } catch (error) {
    db.close()
    throw error
  }
  // Exclusive startup transaction: preserve EID fork boundaries while repairing
  // legacy fractional/duplicate positions. No live work is admitted yet.
  sql.exec('create table if not exists harness_upgrade (name text primary key)')
  if (
    !sql.query(
      "select name from harness_upgrade where name = 'entry-seq-v1'",
      [],
    ).length
  ) {
    try {
      store.tx((tx) => {
        repairSequences(tx)
        sql.exec("insert into harness_upgrade values ('entry-seq-v1')")
      })
    } catch (error) {
      // A transcript this pass cannot straighten is a warning, never a locked
      // door: the harness must always open. The upgrade stays unrecorded, so
      // the next boot tries again with whatever the repair has learned.
      let ties = sql.query(
        'select count(*) as n from (select "session", "seq" from entry' +
          ' group by "session", "seq" having count(*) > 1)',
        [],
      )
      console.warn(
        'harness: transcript repair skipped:',
        error instanceof Error ? error.message : String(error),
        '(' + Number(ties[0]?.n ?? 0) + ' tied positions)',
      )
    }
  }
  // The effects registry writes through the graph's own door, trusted: what an
  // effect writes is the harness's own word, never a client's.
  let fx = effects(vocab, {
    write: (b) => g.apply(b, { trusted: true }),
    report: (error) => diagnostics().report(error, { phase: 'effect' }),
  })
  let g = graph({
    storage: store,
    vocab,
    plugins: [
      ...rules({
        config: { db: path },
        vocab,
        storage: store,
        sql,
        get graph(): Graph {
          return g
        },
      }),
      fx,
    ],
  })
  reapLeases(store)
  return {
    path,
    db,
    store,
    g,
    fx,
    vocab,
    migrations: migration,
    close: () => db.close(),
  }
}
