// T-65023: move bug.title to doc.title, then number bugs without changing eids.
// Land only: locus runs this explicit-config transition and yak restart together.
import { compose, facet, type Load } from '@yaks/cli/host'
import { read } from '../packages/cli/config.ts'
import { trackerDoc } from '../packages/tracker/vocab.ts'
import { migrateTitles } from '../packages/tracker/migrate.ts'
import { unit } from '../packages/sqlite/unit.ts'
import { open } from '@yaks/sqlite/db'
import { numberSql, reclassify } from '@yaks/sqlite'
import { col, select, table } from '@yaks/sql'

let path = Deno.args[0]
if (!path) throw new Error('explicit tracker config required')
let config = read(path)
if (
  !config.db ||
  !config.plugins?.some((p) =>
    (typeof p == 'string' ? p : p.use) == '@yaks/tracker'
  )
) {
  throw new Error('tracker database and plugin required')
}
// A temporary declaration admits the clear; the ordinary vocabulary has no
// legacy reader. Installing it once the values are empty contracts the column.
let legacy = structuredClone(trackerDoc)
legacy.$defs!.bug.properties!.title = { type: 'string', stamped: true }
let load: Load = async (plugin, name) => {
  if (plugin == '@yaks/tracker' && name == 'vocab') {
    let current = await facet(plugin, name)
    return { ...current, docs: [legacy] } as Awaited<ReturnType<Load>>
  }
  return await facet(plugin, name)
}
let host = await compose(config, ['graph'], load, { process: false })
let bugs = await host.graph.read('.bug *')
let errors = (await host.graph.read('.error')).length
let moved: number
try {
  moved = await migrateTitles(host.graph)
} finally {
  await host.close()
}
let driver = open(config.db)
let numbered = 0
try {
  unit(driver, () => {
    for (let bug of bugs) {
      numbered += driver.query(numberSql(bug.entity.eid, true)).length
    }
    reclassify(driver, bugs.map((b) => b.entity.eid), true)
  })
} finally {
  driver.close()
}
host = await compose(config, ['graph'], facet, { process: false })
try {
  let after = await host.graph.read('.bug *')
  if (
    after.length != bugs.length ||
    (await host.graph.read('.error')).length != errors ||
    after.some((b) => !b.entity.num || !(b.doc as { title?: string })?.title)
  ) {
    throw new Error(
      'tracker migration counts, titles or numbers did not verify',
    )
  }
  let db = open(config.db)
  try {
    let columns = db.query({ t: 'pragma', name: 'table_info', arg: 'bug' })
    if (columns.some((c) => c.name == 'title')) {
      let held = db.query(select({ cols: [col('title')], from: table('bug') }))
      if (held.some((b) => b.title != null)) {
        throw new Error('legacy title values remain')
      }
      db.query({ t: 'alter table', table: 'bug', drop: 'title' })
    }
  } finally {
    db.close()
  }
  console.log(JSON.stringify({ bugs: bugs.length, errors, moved, numbered }))
} finally {
  await host.close()
}
