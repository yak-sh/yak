#!/usr/bin/env -S deno run -A
// One-time (T-45632): the embedding index's one-row dirty flag goes. The
// quantized index keeps its build in `embedding_build` and the vectors changed
// since in `embedding_dirty`, which @yaks/embedding's schema raises in any
// process that opens the graph; the flag table and the three triggers that set
// it are the old shape, and nothing reads them.
//
//   deno run -A bin/drop-embedding-flag.ts <yak.db>

import { col, op, select, table, val } from '@yaks/sql'
import { open } from '@yaks/sqlite/db'

let db = open(Deno.args[0])
db.query({ t: 'begin', mode: 'immediate' })
for (let e of ['i', 'u', 'd']) {
  let name = `embedding_index_a${e}`
  db.query({ t: 'drop', kind: 'trigger', name, ifExists: true })
}
db.query({ t: 'drop', kind: 'table', name: 'embedding_index', ifExists: true })
db.query({ t: 'commit' })
let left = db.query(select({
  cols: [col('name')],
  from: table('sqlite_master'),
  where: op('like', col('name'), val('embedding_index%')),
}))
console.log(left.length, 'embedding_index objects left')
db.close()
