// T-164366: the box's numbered rows move under their letters (D-164344, items
// 8 and 9).
//
// 1. Copy. Every numbered row stored without a prefix takes the letter it
//    printed with before series had letters: its kind's declared prefix, else
//    the kind's initial (@yaks/id `initial`, deleted in T-164363).
// 2. Renumber the small sets. A declared series under 1,000 entities is
//    numbered from 1 in `created.at` order, stepping over a number another
//    entity keeps as a name, and each old id becomes an alias of its entity.
// 3. Two letters. An entity carrying a declared prefix besides the one it
//    printed with gets an alias under that letter with its old number, as the
//    number alone named it before.
// 4. Counters. `entity_series.high` is 0 for a copied series, so new ids fill
//    its holes, and the last number given for a renumbered one.
// 5. The spine is made again without the unique index on `num` alone.
//
// Aliases go through the graph first (an entity holding the pair still wins
// over its alias), then the spine moves in one transaction on a connection of
// its own with foreign keys off. A second run finds nothing to move.
//
//   deno run -A bin/series-move.ts <yak.json> plan
//   deno run -A bin/series-move.ts <yak.json> write
//   deno run -A bin/series-move.ts <yak.json> check <before.json>

import type { Bundle, Graph } from '@yaks/graph'
import { open } from '@yaks/sqlite/db'
import { built, respined, sole } from '@yaks/sqlite'
import { unit } from '@yaks/sqlite/unit'
import {
  and,
  col,
  type Driver,
  eq,
  isNull,
  left,
  lit,
  notNull,
  oneOf,
  op,
  select,
  table,
  val,
} from '@yaks/sql'
import { format, prefixes, seriesOf } from '@yaks/id'
import { aliasEid } from '@yaks/alias'
import { dbOf, read } from '../packages/cli/config.ts'
import { opened } from '../packages/cli/local.ts'

let [config, mode, before] = Deno.args
if (!['plan', 'write', 'check', 'new'].includes(mode)) {
  throw new Error('usage: <yak.json> plan|write|check [before.json]|new')
}
let SMALL = 1000
let MARK = 'series-move'

let host = await opened(
  config,
  ['graph'],
  false,
  mode == 'plan' || mode == 'check',
)
let g: Graph = host.graph
let vocab = host.vocab
let declared = prefixes(vocab)
let initial = (kind: string) => (kind.match(/[a-z]/i)?.[0] ?? '').toUpperCase()
// The letter an entity printed with before T-164363: its kind's declared
// prefix, or the kind's initial.
let printed = (tables: string[]) => {
  let kind = vocab.kindOf(Object.fromEntries(tables.map((t) => [t, true])))
  return declared[kind] ?? initial(kind)
}

let db = dbOf(read(config))
let driver: Driver = open(
  db.startsWith('/')
    ? db
    : new URL(db, `file://${Deno.realPathSync(config)}`).pathname,
)
let chunk = <T>(xs: T[], n: number) =>
  Array.from(
    { length: Math.ceil(xs.length / n) },
    (_, i) => xs.slice(i * n, i * n + n),
  )

type Row = {
  id: number
  eid: string
  num: number
  prefix: string | null
  tables: string[]
  dead: boolean
  at: string
}
// Every numbered entity, with the tables its archetype names, whether it is
// a tombstone, and when it was made.
let rows = (): Row[] =>
  driver.query(select({
    cols: [
      col('id', 'e'),
      col('eid', 'e'),
      col('num', 'e'),
      col('prefix', 'e'),
      col('tables', 'a'),
      col('entity', 't'),
      col('at', 'c'),
    ],
    from: table('entity', 'e'),
    joins: [
      left(
        table('archetype', 'a'),
        eq(col('entity', 'a'), col('archetype', 'e')),
      ),
      left(table('tombstone', 't'), eq(col('entity', 't'), col('id', 'e'))),
      left(table('created', 'c'), eq(col('entity', 'c'), col('id', 'e'))),
    ],
    where: notNull(col('num', 'e')),
  })).map((r) => ({
    id: Number(r.id),
    eid: String(r.eid),
    num: Number(r.num),
    prefix: r.prefix == null ? null : String(r.prefix),
    tables: r.tables == null ? [] : JSON.parse(String(r.tables)),
    dead: r.entity != null,
    at: String(r.at ?? ''),
  }))

// A tombstone's archetype names only the grave. What it held living is in
// the journal: every component it was ever given.
let journaled = (ids: number[]): Map<number, string[]> => {
  let out = new Map<number, string[]>()
  for (let part of chunk(ids, 500)) {
    for (
      let r of driver.query(select({
        distinct: true,
        cols: [col('entity'), col('component')],
        from: table('journal_change'),
        where: and(
          oneOf(col('entity'), part),
          eq(col('operation'), val('upsert')),
        ),
      }))
    ) {
      let id = Number(r.entity)
      out.set(id, [...out.get(id) ?? [], String(r.component)])
    }
  }
  return out
}

let all = rows()
let moving = all.filter((r) => r.prefix == null)
let unpointed = moving.filter((r) => !r.tables.length && !r.dead)
if (unpointed.length) {
  console.log(`unpointed: ${unpointed.length}`, unpointed.slice(0, 5))
}
// Each moving row's letter as it printed, and the series it is kept in: that
// letter where its kind declares it, else the declared letter its components
// pick (@yaks/id `seriesOf`), else none, and its number is cleared.
let printedOf = new Map<number, string>()
let letterOf = new Map<number, string | null>()
let graves = moving.filter((r) => r.dead)
let pick = seriesOf(vocab, declared)
let lived = journaled(
  moving.filter((r) => r.dead && r.tables.every((t) => t == 'tombstone'))
    .map((r) => r.id),
)
for (let r of moving) {
  let tables = r.tables.filter((t) => t != 'tombstone')
  if (r.dead && !tables.length) {
    r.tables = tables = lived.get(r.id) ?? []
  }
  let kind = vocab.kindOf(Object.fromEntries(tables.map((t) => [t, true])))
  let was = printed(tables)
  printedOf.set(r.id, was)
  // A grave keeps its number under its letter, as it answers to it today: it
  // shows nowhere, and no name can be kept for it.
  letterOf.set(r.id, r.dead ? was : declared[kind] ?? pick(tables) ?? null)
}
let cleared = moving.filter((r) => letterOf.get(r.id) == null)

// The series as they will stand: each row under its letter.
let letter = (r: Row) => r.prefix ?? letterOf.get(r.id) ?? null
let series = Map.groupBy(
  all.filter((r) => letter(r) != null),
  (r) => letter(r)!,
)
let small = [...series].filter(([p, list]) =>
  Object.values(declared).includes(p) && list.length < SMALL
)
let renumbering = !driver.query(select({
  cols: [col('v')],
  from: table('server_meta'),
  where: eq(col('k'), val(MARK)),
})).length

// The names to keep, none for a grave (its names are released with it): each
// renumbered entity's old id, the old id of one whose number is cleared, and
// every entity's id under each other declared letter it carries, with its old
// number.
let aliases = new Map<string, string>()
let living = (list: Row[]) => list.filter((r) => !r.dead)
if (renumbering) {
  for (let [p, list] of small) {
    for (let r of living(list)) aliases.set(format(p, r.num), r.eid)
  }
}
let twoLetters = 0
for (let r of living(moving)) {
  let mine = letter(r)
  let others = new Set([
    printedOf.get(r.id)!,
    ...r.tables.flatMap((t) => declared[t] ? [declared[t]] : []),
  ])
  for (let other of others) {
    if (other != mine && !aliases.has(format(other, r.num))) {
      aliases.set(format(other, r.num), r.eid)
      twoLetters++
    }
  }
}

// New numbers for the small sets' living entities, in the order they were
// made, stepping over a number kept as a name or held by a grave.
let renumbered = new Map<number, number>()
let lastOf = new Map<string, number>()
if (renumbering) {
  for (let [p, list] of small) {
    let graved = new Set(list.filter((r) => r.dead).map((r) => r.num))
    let taken = (n: number, r: Row) =>
      graved.has(n) ||
      aliases.has(format(p, n)) && aliases.get(format(p, n)) != r.eid
    let n = 0
    for (
      let r of living(list).toSorted((a, b) =>
        a.at.localeCompare(b.at) || a.num - b.num
      )
    ) {
      do n++
      while (taken(n, r))
      renumbered.set(r.id, n)
    }
    lastOf.set(p, n)
  }
}

let counts = Object.fromEntries(
  [...series].map(([p, l]) => [p, l.length]).sort(),
)
let summary = {
  numbered: all.length,
  moving: moving.length,
  graves: graves.length,
  gravesUnjournaled: graves.filter((r) => !r.tables.length).length,
  gravesOtherLetters:
    graves.filter((r) =>
      r.tables.some((t) => declared[t] && declared[t] != letter(r))
    ).length,
  cleared: Object.fromEntries(
    [...Map.groupBy(
      cleared,
      (r) => vocab.kindOf(Object.fromEntries(r.tables.map((t) => [t, true]))),
    )]
      .map(([k, l]) => [k, l.length] as const).sort((a, b) => b[1] - a[1]),
  ),
  printedElsewhere:
    moving.filter((r) =>
      letterOf.get(r.id) != null && letterOf.get(r.id) != printedOf.get(r.id)
    ).length,
  unpointed: unpointed.length,
  series: counts,
  small: Object.fromEntries(small.map(([p, l]) => [p, l.length])),
  aliases: aliases.size,
  twoLetters,
  renumbered: renumbered.size,
  sole: sole(driver),
}
console.log(JSON.stringify(summary, null, 2))

// Every id people hold, and the eid it opened: under the letter each row
// printed with, and under each other declared letter it carries.
let held = (rs: Row[]) =>
  Object.fromEntries(rs.flatMap((r) => {
    let was = r.prefix ?? printedOf.get(r.id)!
    // A row given its letter already answers to that pair alone.
    let others = r.dead || r.prefix
      ? []
      : r.tables.flatMap((t) => declared[t] ? [declared[t]] : [])
    return [...new Set([was, ...others])].map((p) => [format(p, r.num), r.eid])
  }))

if (mode == 'plan') {
  let kinds = (rs: Row[]) =>
    Object.fromEntries(
      [...Map.groupBy(rs, (r) =>
        vocab.kindOf(Object.fromEntries(r.tables.map((t) => [t, true]))))]
        .map(([k, l]) =>
          [k, l.length] as const
        ).sort((a, b) => b[1] - a[1])
        .slice(0, 6),
    )
  console.log(JSON.stringify({
    declared,
    kinds: Object.fromEntries([...series].map(([p, l]) => [p, kinds(l)])),
    unpointed: unpointed.map((r) => r.eid),
  }))
  await Deno.writeTextFile(
    'series-before.json',
    JSON.stringify(held(all)),
  )
  console.log('wrote series-before.json')
  Deno.exit(0)
}

if (mode == 'new') {
  let PROBE = {
    by: 'a6433884-44a7-4033-9517-37f371087a47',
    via: 'adff6a66-8c06-4d6e-8190-8cb4d5dfc89f',
  }
  // A new task and a new project, as the store gives them now.
  let made = await g.apply([
    {
      entity: { eid: '$t' },
      doc: { title: 'series-move probe' },
      task: {},
      $actor: PROBE,
    },
    {
      entity: { eid: '$p' },
      doc: { title: 'series-move probe' },
      project: {},
      topic: { name: 'series-move-probe' },
      $actor: PROBE,
    },
  ] as Bundle[])
  console.log(JSON.stringify(made.map((b) => b.entity)))
  Deno.exit(0)
}

if (mode == 'check') {
  let want: Record<string, string> = JSON.parse(await Deno.readTextFile(before))
  let ids = Object.keys(want)
  let wrong: [string, string, string | undefined][] = []
  for (let part of chunk(ids, 2000)) {
    let got = await g.named(part)
    for (let id of part) {
      let eid = got.get(id) ?? (want[id] == id ? id : undefined)
      if (eid != want[id]) wrong.push([id, want[id], eid])
    }
  }
  console.log(
    `checked ${ids.length}, wrong ${wrong.length}`,
    wrong.slice(0, 20),
  )
  Deno.exit(wrong.length ? 1 : 0)
}

// Write. The names first, through the graph, so an old id never names nothing.
let named = [...aliases].filter(([name]) =>
  !driver.query(select({
    cols: [col('eid')],
    from: table('entity'),
    where: eq(col('eid'), val(aliasEid(name))),
  })).length
)
// As the key entities themselves, so no write lands on the entity named
// (@yaks/alias README, "How a name is stored"). By the project, via the
// session that ran it.
let $actor = {
  by: 'a6433884-44a7-4033-9517-37f371087a47',
  via: Deno.env.get('SESSION') ?? 'adff6a66-8c06-4d6e-8190-8cb4d5dfc89f',
}
let wrote = 0
for (let part of chunk(named, 500)) {
  await g.apply(part.map(([name, eid]) =>
    ({
      entity: { eid: aliasEid(name) },
      key: { of: eid, value: name },
      alias: {},
      $actor,
    }) as Bundle
  ))
  wrote += part.length
  if (wrote % 10000 < 500) console.log(`aliases ${wrote}/${named.length}`)
}
console.log(`aliases written: ${named.length}`)

// Then the spine, in one unit, foreign keys off on this connection.
let t0 = performance.now()
driver.query({ t: 'pragma', name: 'foreign_keys', value: 'off' })
let lap = (what: string) =>
  console.log(`${what}: ${Math.round(performance.now() - t0)} ms`)
unit(driver, () => {
  for (let s of respined(driver)) driver.query(s)
  lap('respined')
  for (let [p, list] of Map.groupBy(moving, (r) => letter(r) ?? '')) {
    for (let part of chunk(list.map((r) => r.id), 500)) {
      driver.query({
        t: 'update',
        table: 'entity',
        set: p ? { prefix: val(p) } : { num: lit(null) },
        where: and(oneOf(col('id'), part), isNull(col('prefix'))),
      })
    }
  }
  lap('lettered')
  // Through negatives, so no two entities of a series hold one pair between.
  for (let sign of [-1, 1]) {
    for (let [id, n] of renumbered) {
      driver.query({
        t: 'update',
        table: 'entity',
        set: { num: val(sign * n) },
        where: eq(col('id'), val(id)),
      })
    }
  }
  lap('renumbered')
  for (let p of series.keys()) {
    driver.query({
      t: 'insert',
      into: 'entity_series',
      cols: ['prefix', 'high'],
      rows: [[val(p), val(lastOf.get(p) ?? 0)]],
      upsert: [{ on: [col('prefix')], set: { high: col('high', 'excluded') } }],
    })
  }
  driver.query({
    t: 'insert',
    into: 'server_meta',
    cols: ['k', 'v'],
    rows: [[val(MARK), val(new Date().toISOString())]],
    upsert: [{ on: [col('k')], set: { v: col('v', 'excluded') } }],
  })
})
lap('moved')
// Each index on the spine in a unit of its own, so no writer waits on all of
// them at once: what reads by number does meanwhile is scan.
for (let i of built(driver, vocab).filter((i) => i.on == 'entity')) {
  unit(driver, () => driver.query(i))
  lap(i.name)
}
driver.query({ t: 'pragma', name: 'foreign_keys', value: 'on' })
console.log(`spine moved in ${Math.round(performance.now() - t0)} ms`)
void op
Deno.exit(0)
