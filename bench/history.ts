// The history bench (D-130964): the box's composed graph over a copy of its
// database, in one configuration of stamps and history, timing the writes and
// reads the design compares and the bytes each change keeps.
//
//   deno run -A bench/history.ts <copy.db> <config> [rounds]
//
// `config` is one of
//
// - `none`: neither @yaks/provenance nor @yaks/journal;
// - `stamps`: @yaks/provenance alone;
// - `attribution`: @yaks/journal's attribution aspect, no stamps;
// - `versions`: attribution and versions, no stamps;
// - `journal`: ~/.yak/yak.json as it is, the stamps and today's journal.
//
// Each runs on the same copy in turn, `versions` last: it reshapes the store
// and records that the store requires the journal. Never point it at the live
// graph. Prints one JSON line per measurement.

import { compose, facet } from '@yaks/cli/host'
import { read as config } from '@yaks/cli'
import { type Bundle, signed, token } from '@yaks/graph'
import { history } from '@yaks/journal/graph'
import {
  among,
  as,
  col,
  desc,
  eq,
  fn,
  join,
  lit,
  select,
  table,
  val,
} from '@yaks/sql'
import { branch } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'

let [db, kind, roundsArg] = Deno.args
let rounds = Number(roundsArg ?? 31)
let cfg = config(`${Deno.env.get('HOME')}/.yak/yak.json`)
let named = (p: unknown) =>
  typeof p == 'string' ? p : (p as { use: string }).use
let journal = (aspects: Record<string, boolean>) => ({
  use: '@yaks/journal',
  with: aspects,
})
let configs: Record<string, (p: unknown[]) => unknown[]> = {
  none: (ps) => ps.filter((p) => !/provenance|journal/.test(named(p))),
  stamps: (ps) => ps.filter((p) => named(p) != '@yaks/journal'),
  attribution: (ps) =>
    ps.filter((p) => named(p) != '@yaks/provenance').map((p) =>
      named(p) == '@yaks/journal'
        ? journal({ attribution: true, versions: false })
        : p
    ),
  versions: (ps) =>
    ps.filter((p) => named(p) != '@yaks/provenance').map((p) =>
      named(p) == '@yaks/journal'
        ? journal({ attribution: true, versions: true })
        : p
    ),
  journal: (ps) => ps,
}
if (!configs[kind]) throw new Error(`no config ${kind}`)
let plugins = configs[kind](cfg.plugins!) as typeof cfg.plugins
let host = (mode?: { at: number } | { branch: number }) =>
  compose(
    { ...cfg, plugins, db, tracker: undefined, duties: false },
    ['graph'],
    facet,
    { process: false, mode },
  )
let out = (o: Record<string, unknown>) =>
  console.log(JSON.stringify({ kind, ...o }))

let t0 = performance.now()
let h = await host()
let g = h.graph
out({ m: 'compose', ms: +(performance.now() - t0).toFixed(1) })

// Another writer: its commit is what lets each host's memory go between timed
// reads, as any other writer's does on the box, and it reads the file's size.
let other = open(db)
let commit = () =>
  other.query({
    t: 'insert',
    or: 'replace',
    into: 'server_meta',
    cols: ['k', 'v'],
    rows: [[val('bench'), val(String(Math.random()))]],
  })
// The bytes history keeps: its tables and their indexes, as SQLite's page
// statistics count them.
let HISTORY = ['journal_tx', 'journal_change', 'journal_field', 'doc$versions']
let kept = () =>
  Number(
    other.query(select({
      cols: [as(fn('sum', col('pgsize')), 'n')],
      from: table('dbstat'),
      where: among(
        col('name'),
        select({
          cols: [col('name')],
          from: table('sqlite_master'),
          where: among(col('tbl_name'), HISTORY.map(val)),
        }),
      ),
    }))[0].n ?? 0,
  )
let tip = () =>
  Number(
    other.query(select({
      cols: [as(fn('max', col('id')), 'id')],
      from: table('journal_tx'),
    }))[0].id ?? 0,
  )

let stats = (xs: number[]) => {
  let s = [...xs].sort((a, b) => a - b)
  let at = (p: number) =>
    +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3)
  return { median: at(0.5), p90: at(0.9), min: +s[0].toFixed(3) }
}
// Each call's own time, after three untimed; a cold one follows another
// writer's commit, so it is read from SQLite rather than from memory.
let time = async (
  m: string,
  f: (i: number) => unknown,
  n = rounds,
  cold = false,
) => {
  for (let i = 0; i < 3; i++) await f(-1 - i)
  let xs: number[] = []
  for (let i = 0; i < n; i++) {
    if (cold) commit()
    let s = performance.now()
    await f(i)
    xs.push(performance.now() - s)
  }
  out({ m, ...stats(xs) })
}
let eids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)
let titleOf = async (on: typeof g, eid: string) =>
  ((await on.get([eid]))[0]?.doc as { title?: string })?.title

// The writer: a session, as a session's writes are signed.
let [session] = await g.read('.session .limit=1')
let who = { by: session.entity.eid, via: session.entity.eid }
let tasks = eids(await g.read('.task.status=open .order=entity.num .limit=100'))
out({ m: 'tasks', n: tasks.length })

// Reads, before this run writes anything.
let page = '.task.status=open .order=-entity.num .limit=50'
await time('read:open-page', () => g.read(page), rounds, true)
let [busiest] = other.query(select({
  cols: [as(col('eid', 'e'), 'eid'), as(fn('count', lit('*')), 'n')],
  from: table('entry', 'x'),
  joins: [join(table('entity', 'e'), eq(col('id', 'e'), col('session', 'x')))],
  group: [col('session', 'x')],
  order: [desc(col('n'))],
  limit: lit(1),
}))
let entries = `.entry.session=${busiest.eid} .order=-entry.seq .limit=100`
await time('read:session-entries', () => g.read(entries), rounds, true)
await time('read:get-10-tasks', () => g.get(tasks.slice(0, 10)), rounds, true)

// Writes.
let before = tip()
let probe = tasks[0]
let prior = await titleOf(g, probe)
let run = Math.floor(Math.random() * 1e6)
await time('write:title-edit', (i) =>
  g.apply(signed([{
    entity: { eid: tasks[(i + 4) % tasks.length] },
    doc: { title: `edit ${kind} ${run} ${i}` },
  }], who)))
let batch = (i: number) =>
  g.apply(signed(
    tasks.map((eid) => ({
      entity: { eid },
      doc: { title: `batch ${kind} ${run} ${i}` },
    })),
    who,
  ))
await time('write:batch-100-edits', batch)

let [effect] = await g.read('.effect .limit=1')
await time('write:effect-claim', async () => {
  let [now] = await g.get([effect.entity.eid])
  let row = now.effect as Record<string, unknown>
  return g.apply([{
    entity: { eid: effect.entity.eid },
    effect: {
      attempts: Number(row.attempts ?? 0) + 1,
      lease_owner: who.by,
      lease_token: crypto.randomUUID(),
      lease_expiry: new Date(Date.now() + 60_000).toISOString(),
    },
    $was: {
      effect: {
        lease_token: token(row.lease_token ?? null),
        attempts: token(row.attempts ?? null),
      },
    },
  }], { trusted: true })
})

// What the file keeps per component a write changes: twenty batches of a
// hundred title edits, a hundred changes each.
let start = kept()
for (let i = 0; i < 20; i++) await batch(100 + i)
out({ m: 'bytes:per-change', bytes: Math.round((kept() - start) / 2000) })

if (kind == 'versions') {
  // The past: main as of the transaction before this run's writes.
  let s = performance.now()
  let past = await host({ at: before })
  out({ m: 'as-of:compose', ms: +(performance.now() - s).toFixed(1) })
  out({
    m: 'as-of:answer',
    ok: await titleOf(past.graph, probe) == prior,
    then: await titleOf(past.graph, probe),
    prior,
    now: await titleOf(g, probe),
  })
  await time('as-of:get', () => past.graph.get([probe]), rounds, true)
  await time('as-of:open-page', () => past.graph.read(page), rounds, true)
  await time(
    'as-of:session-entries',
    () => past.graph.read(entries),
    rounds,
    true,
  )
  await past.close()

  // A branch of main at its newest transaction, edited and read.
  let clock = history({ versions: true })!
  await time('branch:create', () => branch(other, clock))
  let b = branch(other, clock)
  s = performance.now()
  let on = await host({ branch: b.branch })
  out({ m: 'branch:compose', ms: +(performance.now() - s).toFixed(1) })
  await time('branch:title-edit', (i) =>
    on.graph.apply(signed([{
      entity: { eid: probe },
      doc: { title: `branch ${run} ${i}` },
    }], who)))
  out({
    m: 'branch:answer',
    branch: await titleOf(on.graph, probe),
    main: await titleOf(g, probe),
  })
  await time('branch:get', () => on.graph.get([probe]), rounds, true)
  await time('branch:open-page', () => on.graph.read(page), rounds, true)
  await on.close()
}
await h.close()
other.close()
Deno.exit(0)
