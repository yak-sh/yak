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

import { Database } from '@db/sqlite'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { type Effects, effects } from '@yaks/effects'
import { type Graph, graph } from '@yaks/graph'
import { modelDoc } from '@yaks/model'
import { openaiDoc } from '@yaks/openai'
import { processDoc, processes } from '@yaks/process'
import { reapLeases, sessionDerived, sessionDoc, sessions } from '@yaks/session'
import { type Driver, storage, type Store } from '@yaks/sqlite'
import { derived as taskDerived, taskDoc, tasks } from '@yaks/task'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'

/** The words no package owns: the spine, and the two stamps @yaks/graph writes
 * when a vocabulary declares them — without which nothing here has a time. */
export let harnessDoc: VocabDoc = {
  title: 'harness',
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    created: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
    updated: {
      type: 'object',
      properties: {
        at: { type: 'string', format: 'date-time', stamped: true },
      },
    },
  },
}

/** Everything the harness speaks, loaded once. */
export let vocab: Vocab = loadVocab([
  harnessDoc,
  docDoc,
  edgeDoc,
  sessionDoc,
  modelDoc,
  openaiDoc,
  processDoc,
  taskDoc,
], [edgeKeywords])

/** The computed columns, said in SQL: a transcript's status and a task's. */
export let derived = { ...sessionDerived, ...taskDerived() }

/** Where the graph lives when nobody says: `$HARNESS_DB`, else
 * `~/.harness/harness.db`. */
export let dbPath = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_DB') || `${env('HOME')}/.harness/harness.db`

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
      return statement.all(...params)
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
export let open = (path = dbPath()): Harness => {
  if (path != ':memory:') {
    let dir = path.slice(0, path.lastIndexOf('/'))
    if (dir) Deno.mkdirSync(dir, { recursive: true })
  }
  let db = new Database(path)
  db.exec('pragma foreign_keys = on')
  // A file is read by a person's `ls` while an agent writes it; a memory
  // database has no journal to move.
  if (path != ':memory:') db.exec('pragma journal_mode = wal')
  let store = storage(driver(db), vocab, { derived })
  store.install()
  // The effects registry writes through the graph's own door, trusted: what an
  // effect writes is the harness's own word, never a client's.
  let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({
    storage: store,
    vocab,
    plugins: [sessions(), edges(vocab), tasks(vocab), processes(), fx],
  })
  reapLeases(store)
  return { path, db, store, g, fx, vocab, close: () => db.close() }
}
