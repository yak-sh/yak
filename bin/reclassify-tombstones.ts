// One-time (T-59119): the tombstones whose archetype pointer still names what
// they held alive, left by removals past the graph before @yaks/sqlite's own
// removal classified what it removed (the effect pool's rollout script left
// 135,534 effect rows so). Each is classified again from the tables it holds
// rows in. Proven on a VACUUM INTO copy, run on the live file after a backup,
// and deleted once run.
//
//   deno run -A bin/reclassify-tombstones.ts ~/.yak/yak.json

import { eidOf } from '@yaks/archetype'
import {
  col,
  eq,
  isNull,
  join,
  left,
  ne,
  or,
  select,
  table,
  val,
} from '@yaks/sql'
import { reclassify } from '@yaks/sqlite'
import { read } from '../packages/cli/config.ts'
import { compose } from '../packages/cli/host.ts'

let host = await compose({ ...read(Deno.args[0]), duties: false }, ['graph'])
let stale = host.sql.query(select({
  cols: [col('eid', 'e')],
  from: table('tombstone', 't'),
  joins: [
    join(table('entity', 'e'), eq(col('id', 'e'), col('entity', 't'))),
    left(table('entity', 'd'), eq(col('id', 'd'), col('archetype', 'e'))),
  ],
  where: or(
    isNull(col('eid', 'd')),
    ne(col('eid', 'd'), val(eidOf(['tombstone']))),
  ),
})).map((r) => String(r.eid))
console.log(`tombstones not pointing at the tombstone set: ${stale.length}`)

let moved = 0
for (let i = 0; i < stale.length; i += 5000) {
  let out = reclassify(host.sql, stale.slice(i, i + 5000))
  moved += out.filter((b) => b.archetype == null).length
}
console.log(`reclassified: ${moved}`)
await host.close(0)
