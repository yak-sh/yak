import { repairSequences } from '@yaks/session'
import type { Derived } from '@yaks/sql'
import { diagnostics } from './diagnostics.ts'
import { home } from './paths.ts'
// The harness's own graph: one SQLite file, the vocabulary it speaks, and the
// plugins that decide what a batch means. Nothing here reaches a server — the
// harness holds its whole world in `~/.harness/harness.db` (or wherever
// `HARNESS_DB` points, `:memory:` for a test), so an agent runs with the
// tasks daemon down and the same bundles move into the fleet's graph later.
//
// The vocabulary is a composition, not a document: the words a transcript is
// made of (@yaks/session), what serves it (@yaks/model, @yaks/openai), the
// programs it starts (@yaks/process), and the work it is doing (@yaks/doc,
// @yaks/edge, @yaks/task). Two of those carry a status that is COMPUTED and
// never stored, so both rules are registered as derived columns — the SQL
// halves of `statusOf` — and `.session.status=running` or `.task.status=open`
// filters in the database rather than in a loop here.
//
// Boot reconciles what an abnormal ending leaves behind: `reapLeases` frees
// every lock whose holder is not a session in this graph. What a half-done
// STEP leaves is reconciled a rung up, by run.ts `resume()`, because waking a
// transcript needs a model and this file has none.

import {
  address,
  blobRead,
  type Blobs,
  blobs,
  blobSchema,
  bodies,
  encode,
  sqliteBlobs,
} from '@yaks/blob'
import { Database } from '@yaks/sqlite/db'
import { edges } from '@yaks/edge'
import { type Effects, effects } from '@yaks/effects'
import { type Graph, graph } from '@yaks/graph'
import { processes } from '@yaks/process'
import { reapLeases, sessionDerived, sessions, taskMarks } from '@yaks/session'
import { type Driver, storage, type Store } from '@yaks/sqlite'
import { derived as taskDerived, tasks } from '@yaks/task'
import { type Vocab } from '@yaks/vocab'

import { vocab } from './vocab.ts'
export { harnessDoc, vocab } from './vocab.ts'

/** The computed columns, said in SQL: a transcript's status and a task's. */
export let derived: Derived = { ...sessionDerived, ...taskDerived(taskMarks) }

/** Where the graph lives when nobody says: `$HARNESS_DB`, else
 * `$HARNESS_HOME/harness.db` (home defaults to `~/.harness`). */
export let dbPath = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_DB') || `${home(env)}/harness.db`

/** @yaks/sqlite's two-method driver over an embedded database. */
export let driver = (db: Database): Driver => {
  // The adapter repeatedly issues the same parameterized gathers/writes. Keep
  // a bounded statement cache, not tens of thousands of prepare/finalize pairs
  // per transcript. Database.close() finalizes the retained statements.
  let cache = new Map<string, ReturnType<Database['prepare']>>()
  return {
    query: (sql, params) => {
      let statement = cache.get(sql)
      if (!statement) {
        if (cache.size >= 256) {
          let key = cache.keys().next().value!
          cache.get(key)!.finalize()
          cache.delete(key)
        }
        statement = db.prepare(sql)
        cache.set(sql, statement)
      }
      try {
        return statement.all(...params)
      } catch (error) {
        // @db/sqlite resets all() on success, but an exception while decoding
        // a row can leave a RETURNING statement at SQLITE_ROW. Retaining it
        // then prevents every later SAVEPOINT on this connection. Evict only
        // the failed statement; never retry SQL with possible side effects.
        cache.delete(sql)
        try {
          statement.finalize()
        } catch (cleanup) {
          throw new AggregateError(
            [error, cleanup],
            String(error) +
              '; SQLite statement finalization also reported an error',
            { cause: error },
          )
        }
        throw error
      }
    },
    exec: (sql) => db.exec(sql),
  }
}

/** An open harness graph: the file it is, the store under it, the graph over
 * it, and the effects registry the daemon hangs on. */
export type Harness = {
  path: string
  db: Database
  store: Store
  g: Graph
  fx: Effects
  vocab: Vocab
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
  let bytes = sqliteBlobs(sql)
  let store = storage(sql, vocab, {
    // Agent sessions, TUI microtasks and transcript artifacts use eids.
    number: false,
    derived: { ...derived, ...blobRead(vocab) },
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
      blobs(vocab, bytes),
      sessions(),
      edges(vocab),
      tasks(vocab, taskMarks),
      processes(),
      fx,
    ],
  })
  reapLeases(store)
  return { path, db, store, g, fx, vocab, close: () => db.close() }
}
