// The graph a harness runs over: the one a `yak` config names, composed as
// every `yak` process composes it (@yaks/cli `compose`), and seen the way the
// runner and its tools use it. The harness keeps no graph of its own: which
// packages make it up, and so what a write means, is the config's to say, and
// a graph it runs over is the same graph with the same rules whichever process
// opened it.

import { type Blobs, fileBlobs, memoryBlobs } from '@yaks/blob'
import type { Effects } from '@yaks/effects'
import type { Eid, Graph } from '@yaks/graph'
import { migrations, type Store } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'
import { dbOf, type Host } from '@yaks/cli/host'
import type { Vault } from '@yaks/secrets'

/** A graph as a harness runs over it: its file, the store under it, the graph
 * over it, the effects registry the runner is handled on, and the process
 * working it. */
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
  close: () => void | Promise<void>
}

/** Where the artifacts of the graph at `path` keep their bytes: the `images`
 * directory beside it, or memory for a graph in memory. */
export let artifactsAt = (path: string): Blobs =>
  path == ':memory:'
    ? memoryBlobs()
    : fileBlobs(path.slice(0, path.lastIndexOf('/') + 1) + 'images')

/** The graph a `yak` config composed, as a harness runs over it: its store,
 * graph, effects and vault are the host's. Closing the harness runs `close`,
 * which by default leaves the host open for whoever composed it to close. */
export let hosted = (
  host: Host,
  close: () => void | Promise<void> = () => {},
): Harness => {
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
    close,
  }
}
