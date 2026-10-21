#!/usr/bin/env -S deno run -A
// One-time: the journal's values become versions (D-130964, T-130972).
//
//   deno run -A bin/migrate-history.ts <db> [--check=<n>]
//
// Opens <db> composed as ~/.yak/yak.json says, with @yaks/journal keeping
// attribution and versions: that makes each component's table of versions
// and takes every live row as its open version, from no transaction. Then it
// reads every value the journal recorded (`journal_field`) and keeps, for each
// entity's component, every version the journal saw it hold, `[from, to)` in
// the journal's transaction ids, and starts each open version at the
// transaction that opened it. The journal records after-images, so a version
// of something written before it began holds only what it recorded since.
//
// Some writes went around the journal (repairs, renames, what it once kept
// out). A live row that differs from the journal's last version is open from
// that version's transaction; a row the journal never saw begin starts at the
// first transaction after its entity was made (a tombstone, after its burial),
// and a version the journal never saw end ends when its entity was buried, or
// at the newest transaction.
//
// Run it with every writer stopped. A second run changes nothing. `--check=<n>`
// then reads <n> entities as of a transaction that changed each and compares
// them with what the journal says they held just after it.

import { compose, facet } from '@yaks/cli/host'
import { read as config } from '@yaks/cli'
import type { Comp } from '@yaks/graph'
import { TOMBSTONE } from '@yaks/graph/bundle'
import { sha256 } from '@yaks/graph/sha256'
import { dec, log } from '@yaks/journal'
import { isBody, sqliteBlobs } from '@yaks/blob'
import {
  and,
  as,
  col,
  eq,
  type Expr,
  fn,
  ge,
  gt,
  isNull,
  join,
  le,
  left,
  lit,
  lt,
  or,
  select,
  type Stmt,
  sub,
  table,
  val,
} from '@yaks/sql'
import { beside, BRANCH, FROM, keeps, TO, upsertSql } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'

let [db] = Deno.args.filter((a) => !a.startsWith('--'))
if (!db) throw new Error('usage: migrate-history.ts <db> [--check=<n>]')
let checks = Number(
  Deno.args.find((a) => a.startsWith('--check='))?.slice(8) ?? 0,
)
let say = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

let cfg = config(`${Deno.env.get('HOME')}/.yak/yak.json`)
type Named = string | { use: string; with?: Record<string, unknown> }
let plugins = (cfg.plugins as Named[]).map((p) =>
  (typeof p == 'string' ? p : p.use) == '@yaks/journal'
    ? {
      use: '@yaks/journal',
      with: {
        ...typeof p == 'string' ? {} : p.with,
        attribution: true,
        versions: true,
      },
    }
    : p
) as typeof cfg.plugins
let host = (mode?: { at: number }) =>
  compose(
    { ...cfg, plugins, db, tracker: undefined, duties: false },
    ['graph'],
    facet,
    { process: false, mode },
  )

let t0 = performance.now()
let h = await host()
let vocab = h.vocab
say('composed with versions', +(performance.now() - t0).toFixed(0), 'ms')

let d = open(db)
let one = (s: Stmt) => d.query(s)[0] ?? {}
let num = (v: unknown) => Number(v ?? 0)
let tip = num(
  one(
    select({
      cols: [as(fn('max', col('id')), 'n')],
      from: table('journal_tx'),
    }),
  )
    .n,
)
let besides = new Set(
  d.query(select({
    cols: [col('name')],
    from: table('sqlite_master'),
    where: eq(col('type'), lit('table')),
  })).map((r) => String(r.name)).filter((n) => n.endsWith('$versions')),
)
// Main keeps versions of a component the vocabulary still declares and keeps.
let kept = (comp: string) =>
  besides.has(beside(comp)) && keeps(vocab, comp) &&
  (comp == TOMBSTONE || !!vocab.comp(comp))

// The journal's clock: the first transaction at or after a moment. Something
// the journal never saw begin or end did so no earlier than its entity was
// made or buried.
d.query({
  t: 'create table',
  name: 'clock',
  temp: true,
  ifNot: true,
  cols: [{ name: 'ts', type: 'text', pk: true }, {
    name: 'id',
    type: 'integer',
  }],
})
d.query({
  t: 'insert',
  or: 'ignore',
  into: 'clock',
  cols: ['ts', 'id'],
  q: select({
    cols: [col('ts'), col('id')],
    from: table('journal_tx'),
    order: [col('id')],
  }),
})
let clock = (at: Expr) =>
  sub(select({
    cols: [col('id', 'k')],
    from: table('clock', 'k'),
    where: ge(col('ts', 'k'), at),
    order: [col('ts', 'k')],
    limit: lit(1),
  }))
let start = String(
  one(select({ cols: [as(fn('min', col('ts')), 'ts')], from: table('clock') }))
    .ts,
)
let buried = (id: number) =>
  one(select({
    cols: [as(clock(col('deleted_at')), 'tx')],
    from: table(TOMBSTONE),
    where: eq(col('entity'), val(id)),
  })).tx

// A body is kept as a blob, under its hash. An old journal recorded some as a
// reference to an entity named by that hash, and recorded one written before
// the store kept bodies as blobs as its text.
let blobs = sqliteBlobs(d)
let SHA = /^[0-9a-f]{64}$/
let addressed = (text: string): string => {
  let sha = sha256(text)
  if (!blobs.has(sha)) blobs.put(sha, new TextEncoder().encode(text))
  return sha
}

let jc = (c: string) => col(c, 'jc')
let jf = (c: string) => col(c, 'jf')
let span = num(
  one(select({
    cols: [as(fn('max', col('entity')), 'n')],
    from: table('journal_change'),
  })).n,
)
// Every recorded value of the entities in `[lo, hi)`, change by change.
let recorded = (lo: number, hi: number) =>
  select({
    cols: [
      as(jc('entity'), 'id'),
      as(col('eid', 'e'), 'eid'),
      as(jc('id'), 'change'),
      as(jc('tx'), 'tx'),
      as(col('ts', 'jt'), 'ts'),
      as(jc('component'), 'comp'),
      as(jc('operation'), 'op'),
      as(jf('field'), 'prop'),
      as(jf('value'), 'value'),
      as(col('eid', 'r'), 'address'),
    ],
    from: table('journal_change', 'jc'),
    joins: [
      join(table('entity', 'e'), eq(col('id', 'e'), jc('entity'))),
      join(table('journal_tx', 'jt'), eq(col('id', 'jt'), jc('tx'))),
      left(
        table('journal_field', 'jf'),
        and(eq(jf('change'), jc('id')), eq(jf('present'), lit(1))),
      ),
      left(table('entity', 'r'), eq(col('id', 'r'), jf('ref'))),
    ],
    where: and(
      ge(jc('entity'), val(lo)),
      lt(jc('entity'), val(hi)),
      le(jc('tx'), val(tip)),
    ),
    order: [jc('entity'), jc('tx'), jc('ordinal'), jf('ordinal')],
  })

type Change = {
  tx: number
  ts: string
  comp: string
  op: string
  value: Comp
}
type Version = { comp: string; value: Comp; from: number; to: number }

// One entity's changes as the versions they made: those that ended, and
// those still open with the transaction each opened at.
let walk = (changes: Change[]) => {
  let held = new Map<string, { value: Comp; from: number }>()
  let ended: Version[] = []
  let last = new Map<string, number>()
  let end = (comp: string, to: number) => {
    let o = held.get(comp)
    if (!o) return
    held.delete(comp)
    if (o.from < to) ended.push({ comp, ...o, to })
    last.set(comp, to)
  }
  for (let ch of changes) {
    if (ch.comp == 'entity') {
      if (ch.op != 'remove') continue
      for (let comp of [...held.keys()]) end(comp, ch.tx)
      held.set(TOMBSTONE, { value: { deleted_at: ch.ts }, from: ch.tx })
      continue
    }
    if (!kept(ch.comp)) continue
    if (ch.op == 'remove') {
      end(ch.comp, ch.tx)
      continue
    }
    end(TOMBSTONE, ch.tx)
    let o = held.get(ch.comp)
    let value = { ...o?.value, ...ch.value }
    if (o && same(o.value, value)) continue
    if (o && o.from == ch.tx) o.value = value
    else {
      if (o) ended.push({ comp: ch.comp, ...o, to: ch.tx })
      held.set(ch.comp, { value, from: ch.tx })
    }
  }
  return { ended, held, last }
}
let same = (a: Comp, b: Comp) =>
  Object.keys({ ...a, ...b }).every((k) =>
    JSON.stringify(a[k] ?? null) == JSON.stringify(b[k] ?? null)
  )

type Insert = Extract<Stmt, { t: 'insert' }>
// One ended version, stored as its live table stores the component.
let keep = (eid: string, id: number, v: Version): Insert => {
  let at = [lit(0), val(v.from), val(v.to)]
  if (v.comp == TOMBSTONE) {
    return {
      t: 'insert',
      or: 'ignore',
      into: beside(TOMBSTONE),
      cols: ['entity', 'deleted_at', BRANCH, FROM, TO],
      rows: [[val(id), val(String(v.value.deleted_at)), ...at]],
    }
  }
  let w = upsertSql(vocab, eid, v.comp, v.value)
  if (w.q?.t != 'select') throw new Error(`no select for ${v.comp}`)
  return {
    t: 'insert',
    or: 'ignore',
    into: beside(v.comp),
    cols: [...w.cols!, BRANCH, FROM, TO],
    q: { ...w.q, cols: [...w.q.cols!, ...at] },
  }
}
// The open version the store took from the live row, started at `from`.
let begin = (comp: string, id: number, from: number): Stmt => ({
  t: 'update',
  table: beside(comp),
  set: { [FROM]: val(from) },
  where: and(
    eq(col('entity'), val(id)),
    eq(col(BRANCH), lit(0)),
    eq(col(TO), lit(0)),
    or(isNull(col(FROM)), eq(col(FROM), val(from))),
  ),
  returning: [col('entity')],
})
let run = (s: Stmt) => d.query(s).length

let count = {
  entities: 0,
  changes: 0,
  ended: 0,
  begun: 0,
  // open in the journal with no live row: ended by a write it never saw, or
  // a tombstone since pruned
  unseenEnd: 0,
  unseenBurial: 0,
  // live with no open version in the journal: begun by a write it never saw
  unseenStart: 0,
}
let by = new Map<string, number>()
let STEP = 20_000
t0 = performance.now()
for (let lo = 0; lo <= span; lo += STEP) {
  let rows = d.query(recorded(lo, lo + STEP))
  d.query({ t: 'begin', mode: 'immediate' })
  let i = 0
  while (i < rows.length) {
    let id = num(rows[i].id), eid = String(rows[i].eid)
    let changes: Change[] = []
    while (i < rows.length && num(rows[i].id) == id) {
      let r = rows[i]
      let ch: Change = {
        tx: num(r.tx),
        ts: String(r.ts),
        comp: String(r.comp),
        op: String(r.op),
        value: {},
      }
      while (i < rows.length && rows[i].change == r.change) {
        let f = rows[i++]
        if (f.prop == null) continue
        let prop = String(f.prop), v = dec(f.value)
        ch.value[prop] = f.address != null
          ? String(f.address)
          : typeof v == 'string' && !SHA.test(v) &&
              isBody(vocab.prop(ch.comp, prop))
          ? addressed(v)
          : v
      }
      changes.push(ch)
    }
    count.entities++
    count.changes += changes.length
    let { ended, held, last } = walk(changes)
    for (let v of ended) {
      d.query(keep(eid, id, v))
      by.set(v.comp, (by.get(v.comp) ?? 0) + 1)
    }
    count.ended += ended.length
    for (let [comp, o] of held) {
      if (run(begin(comp, id, o.from))) count.begun++
      else {
        if (comp == TOMBSTONE) count.unseenBurial++
        else count.unseenEnd++
        let at = comp == TOMBSTONE ? null : buried(id)
        let to = at != null && num(at) > o.from ? num(at) : tip
        if (o.from < to) d.query(keep(eid, id, { comp, ...o, to }))
      }
    }
    for (let [comp, to] of last) {
      if (!held.has(comp) && run(begin(comp, id, to))) count.unseenStart++
    }
  }
  d.query({ t: 'commit' })
  if ((lo / STEP) % 25 == 0) say(lo, count)
}
// What the journal never saw begin, of an entity made since it began, starts
// when its entity was made, and a tombstone when it was buried.
for (let name of besides) {
  let comp = name.slice(0, -beside('').length)
  let at = comp == TOMBSTONE ? col('deleted_at', name) : sub(select({
    cols: [col('at', 'c')],
    from: table('created', 'c'),
    where: eq(col('entity', 'c'), col('entity', name)),
  }))
  count.unseenStart += d.query({
    t: 'update',
    table: name,
    set: { [FROM]: clock(at) },
    where: and(eq(col(BRANCH), lit(0)), isNull(col(FROM)), gt(at, val(start))),
    returning: [col('entity')],
  }).length
}
say('done', +((performance.now() - t0) / 1000).toFixed(1), 's', count)
say(
  'ended versions by component',
  Object.fromEntries([...by].sort((a, b) => b[1] - a[1]).slice(0, 15)),
)

// Read back through the graph: each sampled entity as of a transaction that
// changed it, against the journal's account of just after it. Where they
// differ, a write the journal never saw explains it when the journal's newest
// account of that component differs from the live one too.
if (checks) {
  let journal = log({ rows: (s) => d.query(s), derived: h.derived })
  let sample = d.query(select({
    cols: [
      as(col('eid', 'e'), 'eid'),
      as(jc('tx'), 'tx'),
      as(jc('component'), 'comp'),
    ],
    from: table('journal_change', 'jc'),
    joins: [join(table('entity', 'e'), eq(col('id', 'e'), jc('entity')))],
    where: le(jc('tx'), val(tip)),
    order: [fn('random')],
    limit: lit(checks * 4),
  })).filter((r) => kept(String(r.comp))).slice(0, checks)
  let plain = (comp: string, c: Comp | undefined) =>
    c &&
    JSON.stringify(
      Object.entries(c)
        .filter(([p, v]) =>
          v != null && vocab.prop(comp, p)?.computed === false
        )
        .sort(([a], [b]) => a < b ? -1 : 1),
    )
  let comps = (b: object | undefined): Record<string, Comp> =>
    Object.fromEntries(Object.entries(b ?? {}))
  let apart = (a: Record<string, Comp>, b: Record<string, Comp>) =>
    [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((c) =>
      kept(c) && c != TOMBSTONE && plain(c, a[c]) != plain(c, b[c])
    )
  let agreed = 0, explained = 0, unexplained: unknown[] = []
  for (let { eid, tx } of sample) {
    let e = String(eid)
    let then = journal.before(e, num(tx) + 1)
    let past = await host({ at: num(tx) })
    let asof = comps((await past.graph.get([e]))[0])
    await past.close()
    let off = apart(then, asof)
    if (!off.length) {
      agreed++
      continue
    }
    let around = apart(
      journal.before(e, tip + 1),
      comps((await h.graph.get([e]))[0]),
    )
    let left = off.filter((c) => !around.includes(c))
    if (!left.length) explained++
    else {
      unexplained.push({
        eid,
        tx,
        off: left.map((c) => ({
          comp: c,
          journal: then[c],
          versions: asof[c],
        })),
      })
    }
  }
  say('checked', sample.length, {
    agreed,
    explained,
    unexplained: unexplained.length,
  })
  for (let x of unexplained.slice(0, 10)) console.log(JSON.stringify(x))
}
await h.close()
