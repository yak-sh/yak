// Where a stored value lives: the module a server imports from
// `@yaks/blob/rules`. The store is the host's own (@yaks/cli `Host.blobs`, a
// table in the server's database); the schema declarations are in ./vocab.ts,
// where a browser can load them without a store coming with them.

import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { blobs } from './plugin.ts'
import type { Blobs } from './store.ts'

/** The plugin for every body property this vocabulary marks `store: blob`,
 * storing each distinct value once in the host's blob store however many rows
 * hold the same text. */
export let rules = (host: { vocab: Vocab; blobs: Blobs }): Plugin[] => [
  blobs(host.vocab, host.blobs),
]
