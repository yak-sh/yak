#!/usr/bin/env -S deno run -A
// One-time (T-45632): a tool result is never embedded now (`result` is
// `embed: false`), so the vectors made of them before go. Deleting a vector
// owes its entity back to the sweep; these owe nothing, since the sweep would
// only find no text for them, so their queue rows go too. The index is owed a
// build by the deletions and the service makes it.
//
//   deno run -A bin/drop-result-vectors.ts <yak.db>

import { as, col, count, eq, exists, select, table } from '@yaks/sql'
import { open } from '@yaks/sqlite/db'

let db = open(Deno.args[0])
let among = (t: string) => ({
  t: 'delete' as const,
  from: t,
  where: exists(select({
    cols: [col('entity')],
    from: table('result', 'r'),
    where: eq(col('entity', 'r'), col('entity', t)),
  })),
})
let n = () =>
  db.query(select({ cols: [as(count(), 'n')], from: table('embedding') }))[0].n
let before = n()
db.query({ t: 'begin', mode: 'immediate' })
db.query(among('embedding'))
db.query(among('embedding_owed'))
db.query({ t: 'commit' })
console.log('vectors', before, '->', n())
db.close()
