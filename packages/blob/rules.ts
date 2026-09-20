// Where a stored value LIVES: the `rules` facet a host takes
// (`@yaks/blob/rules`). This is the facet that needs a database — it raises
// the blob tables through the host's own connection before the rule that
// writes to them — which is why the words are in ./vocab.ts, where a browser
// can reach them and this file's SQL is nowhere in sight.

import type { Plugin } from '@yaks/graph'
import type { Driver } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'
import { blobs } from './plugin.ts'
import { blobSchema, sqliteBlobs } from './sqlite.ts'

/** Every body column this vocabulary marks `store: blob`, kept once in the
 * host's own SQLite file however many rows hold the same text. */
export let rules = (host: { vocab: Vocab; sql: Driver }): Plugin[] => {
  for (let statement of blobSchema()) host.sql.exec(statement)
  return [blobs(host.vocab, sqliteBlobs(host.sql))]
}
