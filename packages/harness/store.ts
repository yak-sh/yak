// The graph a harness runs over: the one a `yak` config names, composed as
// every `yak` process composes it (@yaks/cli `compose`), and seen the way the
// runner and its tools use it. The harness keeps no graph of its own: which
// packages make it up, and so what a write means, is the config's to say, and
// a graph it runs over is the same graph with the same rules whichever process
// opened it.

import { type Blobs } from '@yaks/blob'
import type { Effects } from '@yaks/effects'
import type { Eid, Graph, NamedTool, Storage } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import type { Host, MigrationMonitor } from '@yaks/host'
import type { Vault } from '@yaks/secrets'
import type { Reply } from '@yaks/tools'

/** A graph as a harness runs over it: the store under it, the graph
 * over it, the effects registry the runner is handled on, and the process
 * working it. */
export type Harness = {
  /** The configured person whose default provider accounts serve native sessions. */
  person?: Eid
  store: Storage
  g: Graph
  fx: Effects
  vocab: Vocab
  /** the process row this graph is worked by: what a run's lease names */
  me: Eid
  /** whether a lease's holder is over, so what it held is had now rather than
   * at its expiry (@yaks/cli `Host.gone`) */
  gone: (holder: Eid) => Promise<boolean>
  /** where this graph's secrets are kept — its sign-ins among them */
  vault: Vault
  /** Explicitly lent machine providers; no host disk is assumed. */
  machines?: Host['machines']
  /** Binary artifacts shared with the host's blob door. */
  artifacts: Blobs
  /** what a tool call the agent makes directly is owed beside its answer,
   * as the host's own runner adds it (@yaks/cli `Host.reply`): the entities
   * near one it just created, among them */
  reply?: Reply
  /** every tool the host runs, its plugins' own among them (`memory_around`),
   * read when a transcript names one the harness does not carry for all */
  hostTools?: () => NamedTool[]
  migrations?: MigrationMonitor
  close: () => void | Promise<void>
}

/** The graph a `yak` config composed, as a harness runs over it: its store,
 * graph, effects and vault are the host's. Closing the harness runs `close`,
 * which by default leaves the host open for whoever composed it to close. */
export let hosted = (
  host: Host,
  close: () => void | Promise<void> = () => {},
): Harness => {
  return {
    person: host.config.person,
    store: host.storage,
    g: host.graph,
    fx: host.fx,
    vocab: host.vocab,
    me: host.me,
    gone: host.gone,
    vault: host.vault,
    artifacts: host.artifacts,
    machines: host.machines,
    reply: host.reply,
    hostTools: () => host.tools,
    migrations: host.storage.migrations,
    close,
  }
}
