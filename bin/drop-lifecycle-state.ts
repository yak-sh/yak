// Final T59065 local schema contraction; values were moved through the graph.
import { open } from '../packages/sqlite/db.ts'
import { unit } from '../packages/sqlite/unit.ts'
import { columns } from '../packages/sqlite/physical.ts'
import { as, col, count, notNull, select, table } from '@yaks/sql'
let path = Deno.args[0]
if (!path || !path.startsWith('/')) throw new Error('Name existing database')
await Deno.stat(path)
if (
  path == `${Deno.env.get('HOME')}/.yak/yak.db` && !Deno.args.includes('--live')
) throw new Error('Live requires --live')
let d = open(path)
try {
  unit(d, () => {
    for (let name of ['attempt', 'execution']) {
      if (!columns(d, name).includes('state')) continue
      let n = Number(
        d.query(
          select({
            cols: [as(count(), 'n')],
            from: table(name),
            where: notNull(col('state')),
          }),
        )[0].n,
      )
      if (n) throw new Error(`${name} still has ${n} stored lifecycle values`)
      // attempt_state is the historical vocabulary's scalar index only.
      d.query({
        t: 'drop',
        kind: 'index',
        name: `${name}_state`,
        ifExists: true,
      })
      d.query({ t: 'alter table', table: name, drop: 'state' })
    }
  })
  console.log(
    JSON.stringify({
      columns: Object.fromEntries(
        ['attempt', 'execution'].map((name) => [name, columns(d, name)]),
      ),
    }),
  )
} finally {
  d.close()
}
