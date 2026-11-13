// The box tracker's spine, moved once onto per-letter series (D-164344,
// T-164367). Its rows were numbered by one count with no letters: each bug
// printed `B-7`, from its kind's initial, and an agent resolves it by that id
// (`yak bug resolve B-7`). The spine's `num` is moved off the column that keeps
// it unique on its own (@yaks/sqlite `respined`), each bug's number is kept
// under `B`, and the spine's indexes are raised again. Every other number stays
// as it was, with no letter: none was given to anyone, and no reader answers
// to one.
//
//   deno run -A bin/tracker-series.ts <tracker.json> plan|write|check
//
// Run it with the tracker stopped, then start the tracker again: a running
// process remembers each spine as it read it.
import { open } from '@yaks/sqlite/db'
import { built, respined, sole } from '@yaks/sqlite'
import { unit } from '@yaks/sqlite/unit'
import {
  among,
  and,
  as,
  col,
  type Driver,
  eq,
  type Expr,
  fn,
  isNull,
  notNull,
  select,
  table,
  val,
} from '@yaks/sql'
import { dbOf, read } from '../packages/cli/config.ts'
import { opened } from '../packages/cli/local.ts'

let [config, mode] = Deno.args
if (!['plan', 'write', 'check'].includes(mode)) {
  throw new Error('usage: <tracker.json> plan|write|check')
}
let host = await opened(config, ['graph'], false, mode != 'write')
let db = dbOf(read(config))
let driver: Driver = open(
  db.startsWith('/')
    ? db
    : new URL(db, `file://${Deno.realPathSync(config)}`).pathname,
)
let count = (...where: Expr[]) =>
  Number(
    driver.query(select({
      cols: [as(fn('count', col('id')), 'n')],
      from: table('entity'),
      where: and(...where),
    }))[0].n,
  )
let isBug = among(
  col('id'),
  select({ cols: [col('entity')], from: table('bug') }),
)
let state = () => ({
  sole: sole(driver),
  numbered: count(notNull(col('num'))),
  unlettered: count(notNull(col('num')), isNull(col('prefix'))),
  bugsUnlettered: count(notNull(col('num')), isNull(col('prefix')), isBug),
  bugsB: count(notNull(col('num')), eq(col('prefix'), val('B')), isBug),
})

if (mode == 'plan') {
  console.log(state())
  Deno.exit(0)
}

if (mode == 'check') {
  console.log(state())
  // Every bug answers to B and its number, as it printed before.
  let rows = driver.query(select({
    cols: [col('eid'), col('num')],
    from: table('entity'),
    where: and(notNull(col('num')), isBug),
  }))
  let ids = rows.map((r) => `B-${r.num}`)
  let at = await host.graph.address(ids)
  let wrong = rows.filter((r, i) => at.get(ids[i]) != r.eid)
  console.log({
    bugs: rows.length,
    wrong: wrong.length,
    sample: wrong.slice(0, 5),
  })
  Deno.exit(wrong.length ? 1 : 0)
}

let t0 = performance.now()
let lap = (what: string) =>
  console.log(`${what}: ${Math.round(performance.now() - t0)} ms`)
console.log('before', state())
driver.query({ t: 'pragma', name: 'foreign_keys', value: 'off' })
unit(driver, () => {
  for (let s of respined(driver)) driver.query(s)
  lap('respined')
  driver.query({
    t: 'update',
    table: 'entity',
    set: { prefix: val('B') },
    where: and(notNull(col('num')), isNull(col('prefix')), isBug),
  })
  lap('bugs lettered')
})
for (let i of built(driver, host.vocab).filter((i) => i.on == 'entity')) {
  unit(driver, () => driver.query(i))
  lap(i.name)
}
driver.query({ t: 'pragma', name: 'foreign_keys', value: 'on' })
console.log('after', state())
Deno.exit(0)
