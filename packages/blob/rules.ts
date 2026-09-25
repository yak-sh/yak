// Where a stored value lives: the module a server imports from
// `@yaks/blob/rules`. This is the one that needs a database — it creates the
// blob tables through the server's own connection before returning the plugin
// that writes to them — which is why the schema declarations are in ./vocab.ts,
// where a browser can load them without this file's SQL coming with them.

import type { Plugin } from '@yaks/graph'
import type { Driver } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import { blobs } from './plugin.ts'
import { blobSchema, sqliteBlobs } from './sqlite.ts'

/** The plugin for every body property this vocabulary marks `store: blob`,
 * storing each distinct value once in the server's own SQLite file however
 * many rows hold the same text. */
export let rules = (host: { vocab: Vocab; sql: Driver }): Plugin[] => {
  for (let statement of blobSchema()) host.sql.query(statement)
  return [blobs(host.vocab, sqliteBlobs(host.sql))]
}
