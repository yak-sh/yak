import { diagnostics } from './diagnostics.ts'
import { home } from './paths.ts'
// The harness's own graph: one SQLite file, the vocabulary it loads, and the
// plugins that decide what a write means. Nothing here reaches a server — the
// harness holds everything in `~/.yak/yak.db` (or wherever `HARNESS_DB` points,
// `:memory:` for a test), so an agent runs with the tasks server down and the
// same rows can move into the fleet's graph later.
//
// What the harness is made of is declared in ./vocab.ts and ./rules.ts: the
// vocabulary documents it loads, the properties it computes rather than
// stores, and the plugins that decide what a write means. A `yak` config lists
// the same packages as plugins, and the harness's tools run over that host
// instead (local.ts `hosted`). What is here and not there is startup: the
// reconciliation an abnormal shutdown leaves behind.
//
// That reconciliation is `reapLeases`, which frees every lease whose holder is
// not a session in this graph. What a half-finished step leaves behind is the
// runner's (@yaks/session `running`), which the agent registers and which
// sweeps up what a restart left owed when it starts working the pool: waking a
// transcript needs a model and this file has none.
//
// The graph keeps the runs its commits owe (@yaks/effects), like any host's,
// and is its own worker: a process row, written here, is what a run's lease
// names as its holder. One is minted per graph opened, so two opened in one
// process are two workers, and one closed reads as ended.

import { type Blobs, fileBlobs, memoryBlobs } from '@yaks/blob'
import { type Effects, effects, released } from '@yaks/effects'
import { type Eid, type Graph, graph, then } from '@yaks/graph'
import { EXIT, started } from '@yaks/process'
import { reapLeases } from '@yaks/session'
import { migrations, storage, type Store } from '@yaks/sqlite'
import { open as opened, type Opened } from '@yaks/sqlite/db'
import type { Vocab } from '@yaks/vocab'
import { vaultOf } from '@yaks/cli'
import { dbOf, type Host } from '@yaks/cli/host'
import type { Vault } from '@yaks/secrets'
import { install } from '@yaks/connections'

import { computed, vocab } from './vocab.ts'
import { rules } from './rules.ts'
export { harnessDoc, vocab } from './vocab.ts'

/** Where the graph lives when nothing names a path: `$HARNESS_DB`, else
 * `$HARNESS_HOME/yak.db` (the home directory defaults to `~/.yak`). */
export let dbPath = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_DB') || `${home(env)}/yak.db`

/** An open harness graph: its file, the store under it, the graph over it, the
 * effects registry the runner is handled on, and the process working it. */
export type Harness = {
  path: string
  store: Store
  g: Graph
  fx: Effects
  vocab: Vocab
  /** the process row this graph is worked by: what a run's lease names */
  me: Eid
  /** where this graph's secrets are kept — its sign-ins among them */
  vault: Vault
  /** where its artifacts' bytes are kept (@yaks/blob): the `images` directory
   * beside the database, or memory for a graph in memory */
  artifacts: Blobs
  migrations: ReturnType<typeof migrations>
  close: () => void
}

/** Where the artifacts of the graph at `path` keep their bytes: the `images`
 * directory beside it, or memory for a graph in memory. */
export let artifactsAt = (path: string): Blobs =>
  path == ':memory:'
    ? memoryBlobs()
    : fileBlobs(path.slice(0, path.lastIndexOf('/') + 1) + 'images')

/** The graph a `yak` config composed (@yaks/cli `compose`), as a harness runs
 * over it: its store, graph, effects and vault are the host's, and closing the
 * harness leaves them open, since the command that composed the host closes
 * it. */
export let hosted = (host: Host): Harness => {
  let path = dbOf(host.config)
  return {
    path,
    store: host.storage,
    g: host.graph,
    fx: host.fx,
    vocab: host.vocab,
    me: host.me,
    vault: host.vault,
    artifacts: artifactsAt(path),
    migrations: migrations(host.sql),
    close: () => {},
  }
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
export let open = (
  path: string = dbPath(),
  o: {
    /** how long a run this graph claimed stands before another process may
     * take it over from one that died (ms; default @yaks/effects') */
    hold?: number
  } = {},
): Harness & { sql: Opened } => {
  let sql = opened(path)
  const migration = migrations(sql)
  try {
    migration.ready()
  } catch (error) {
    sql.close()
    throw error
  }
  let store = storage(sql, vocab, {
    // Agent sessions, TUI microtasks and transcript artifacts use eids.
    number: false,
    derived: computed(vocab),
  })
  store.install()
  // The effects registry writes through the graph's own `apply()`, trusted:
  // what an effect writes is the harness's own data, never a client's. It
  // holds no presence lease, and handles only what the agent lends it
  // (`session_run`): a run owed for code this graph lacks (a tool call's, an
  // integration's) is left for a process that has it.
  let fx = effects(vocab, {
    lease: o.hold,
    write: (b) => g.apply(b, { trusted: true }),
    report: (error) => diagnostics().report(error, { phase: 'effect' }),
  })
  let me = crypto.randomUUID() as Eid
  // Where this graph's secrets are kept, as a composed host keeps them
  // (@yaks/cli `vaultOf`): the plugin sealing them and the code reading them
  // back share it.
  let vault = vaultOf(path)
  let g = graph({
    storage: store,
    vocab,
    plugins: [
      ...rules({
        vocab,
        sql,
        vault,
        write: (b) => g.apply(b, { trusted: true }),
      }),
      fx,
    ],
  })
  reapLeases(store)
  g.apply([{ ...started(), entity: { eid: me } }], { trusted: true })
  // The integrations @yaks/connections builds, installed as a composed host
  // installs them at start-up (@yaks/connections/effects): the OpenRouter
  // sign-in goes through one.
  then(
    install(g.read),
    (change) => change.length && g.apply(change, { trusted: true }),
  )
  return {
    path,
    sql,
    store,
    g,
    fx,
    vocab,
    me,
    vault,
    artifacts: artifactsAt(path),
    migrations: migration,
    // The last transaction, then the file: the leases this worker holds
    // released and its ending stamped, as one fact.
    close: () => {
      let shut = () => {
        try {
          sql.close()
        } catch { /* already closed */ }
      }
      try {
        let last = then(
          released(g, me),
          (rows) =>
            g.apply([...rows, { entity: { eid: me }, [EXIT]: {} }], {
              trusted: true,
            }),
        )
        if (last instanceof Promise) return void last.then(shut, shut)
      } catch { /* the file is going either way */ }
      shut()
    },
  }
}
