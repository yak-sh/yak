import { diagnostics } from './diagnostics.ts'
import { home } from './paths.ts'
// The harness's own graph: one SQLite file, the vocabulary it loads, and the
// plugins that decide what a write means. Nothing here reaches a server — the
// harness holds everything in `~/.yak/yak.db` (or wherever `HARNESS_DB` points,
// `:memory:` for a test), so an agent runs with the tasks daemon down and the
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
// not a session in this graph. What a half-finished step leaves behind is
// reconciled one level up, by agent.ts `resume()`, because waking a transcript
// needs a model and this file has none.

import { type Blobs, fileBlobs, memoryBlobs } from '@yaks/blob'
import { type Effects, effects } from '@yaks/effects'
import { type Graph, graph, then } from '@yaks/graph'
import { reapLeases } from '@yaks/session'
import { migrations, storage, type Store } from '@yaks/sqlite'
import { open as opened, type Opened } from '@yaks/sqlite/db'
import { type Vocab } from '@yaks/vocab'
import { vaultOf } from '@yaks/cli'
import { dbOf, type Host } from '@yaks/cli/host'
import type { Vault } from '@yaks/secrets'
import { install } from '@yaks/connections'

import { computed } from './vocab.ts'
import { rules } from './rules.ts'
import { vocab } from './vocab.ts'
export { harnessDoc, vocab } from './vocab.ts'

/** Where the graph lives when nothing names a path: `$HARNESS_DB`, else
 * `$HARNESS_HOME/yak.db` (the home directory defaults to `~/.yak`). */
export let dbPath = (
  env: (name: string) => string | undefined = Deno.env.get,
): string => env('HARNESS_DB') || `${home(env)}/yak.db`

/** An open harness graph: its file, the store under it, the graph over it, and
 * the effects registry the daemon registers its handlers on. */
export type Harness = {
  path: string
  store: Store
  g: Graph
  fx: Effects
  vocab: Vocab
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
  // what an effect writes is the harness's own data, never a client's.
  let fx = effects(vocab, {
    write: (b) => g.apply(b, { trusted: true }),
    report: (error) => diagnostics().report(error, { phase: 'effect' }),
  })
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
    vault,
    artifacts: artifactsAt(path),
    migrations: migration,
    close: () => sql.close(),
  }
}
