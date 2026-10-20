// A prototype measurement, not for landing: the box's composed graph on a copy
// of its database, in one of three configurations, timing the writes and
// reads D-… compares.
//
//   deno run -A --config deno.json packages/sqlite/history_bench.ts \
//     <db> <journal|history|neither> [rounds]
//
// `journal` composes ~/.yak/yak.json as it is; `neither` leaves @yaks/journal
// out; `history` leaves it out and attaches ./history.ts to a copy that
// install.py versioned. Prints one JSON line per measurement.
import { compose, facet } from '@yaks/cli/host'
import { read as config } from '@yaks/cli'
import { type Bundle, signed } from '@yaks/graph'
import { logFor } from '@yaks/journal/graph'
import { raw } from '../sql/ast.ts'
import { open, opening } from './db.ts'
import {
  actor,
  branch,
  forget,
  forgetting,
  reads,
  tip,
  versioned,
  within,
} from './history.ts'
import type { Driver } from '@yaks/sql'

let [db, kind, roundsArg] = Deno.args
let rounds = Number(roundsArg ?? 31)
let cfg = config(`${Deno.env.get('HOME')}/.yak/yak.json`)
let name = (p: unknown) => typeof p == 'string' ? p : (p as { use: string }).use
let plugins = kind == 'journal'
  ? cfg.plugins
  : cfg.plugins!.filter((p) => name(p) != '@yaks/journal')
let drv: Driver | undefined
// Statements SQLite ran and the time they took, beside each measurement's
// wall time: what the rest is, is JavaScript.
let sql = { n: 0, ms: 0 }
opening.wrap = (d) => {
  if (drv) return
  drv = d
  let native = d.query.bind(d)
  d.query = (s) => {
    let t = performance.now()
    try {
      return native(s)
    } finally {
      sql.n++
      sql.ms += performance.now() - t
    }
  }
  if (kind == 'history') reads(versioned(d).tables)
}
let t0 = performance.now()
let host = await compose(
  { ...cfg, plugins, db, tracker: undefined, duties: false },
  ['graph'],
  facet,
  { process: false },
)
let g = host.graph
let out = (o: Record<string, unknown>) =>
  console.log(JSON.stringify({ kind, ...o }))
// A second connection's commit is what lets the store's memory go between
// timed reads, the way any other writer's commit does on the box.
let other = open(db)
forgetting.run = () =>
  void other.query(raw(
    `insert or replace into "server_meta" ("k", "v") values ('bench', ?)`,
    [String(Math.random())],
  ))
out({ m: 'compose', ms: +(performance.now() - t0).toFixed(1) })

let stats = (xs: number[]) => {
  let s = [...xs].sort((a, b) => a - b)
  let at = (p: number) =>
    +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3)
  return { median: at(0.5), p90: at(0.9), min: +s[0].toFixed(3) }
}
// Each call's own time; `cold` first lets go of what the store's memory holds,
// so a get is read from SQLite rather than from ./memo.ts.
let time = async (
  m: string,
  f: (i: number) => unknown,
  n = rounds,
  cold = false,
) => {
  for (let i = 0; i < 3; i++) await f(-1 - i)
  let xs: number[] = []
  let was = { ...sql }
  for (let i = 0; i < n; i++) {
    if (cold) forget(drv!)
    let s = performance.now()
    await f(i)
    xs.push(performance.now() - s)
  }
  out({
    m,
    ...stats(xs),
    stmts: +((sql.n - was.n) / n).toFixed(1),
    sql: +((sql.ms - was.ms) / n).toFixed(3),
  })
}
let fresh = () => ({ now: Date.now() })
let eids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)
let hash = async (x: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(x)),
      ),
    ),
  ].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')

// The writer: a session that exists, as a session's writes are signed.
let [session] = await g.read('.session .limit=1', fresh()) as Bundle[]
let who = { by: session.entity.eid, via: session.entity.eid }
let idOf = (eid: string) =>
  Number(
    drv!.query(raw('select "id" from "entity" where "eid" = ?', [eid]))[0].id,
  )
actor.by = actor.via = idOf(session.entity.eid)

let tasks = eids(
  await g.read(
    '.task.status=open .order=entity.num .limit=100',
    fresh(),
  ) as Bundle[],
)
out({ m: 'tasks', n: tasks.length })

// Current reads first, before this run writes anything.
let page = '.task.status=open .order=-entity.num .limit=50'
out({
  m: 'answer:open-page',
  hash: await hash(eids(await g.read(page, fresh()) as Bundle[])),
})
await time('read:open-page', () => g.read(page, fresh()))
let [busiest] = drv!.query(raw(
  'select "e"."eid" as "eid", count(*) as "n" from "entry" as "x" join "entity" as "e"' +
    ' on "e"."id" = "x"."session" group by "x"."session" order by "n" desc limit 1',
))
let entries = `.entry.session=${busiest.eid} .order=-entry.seq .limit=100`
out({
  m: 'answer:entries',
  hash: await hash(eids(await g.read(entries, fresh()) as Bundle[])),
})
await time('read:session-entries', () => g.read(entries, fresh()))
out({
  m: 'answer:get',
  hash: await hash(
    (await g.get(tasks.slice(0, 10))).map((
      b,
    ) => [b.entity.eid, ...Object.keys(b)]),
  ),
})
await time('read:get-10-tasks', () => g.get(tasks.slice(0, 10)), rounds, true)
if (kind == 'neither') {
  // What a test pays today for a private database: the composed schema kept
  // as an image, copied into a fresh one per test.
  let { snapshot, preparedDriver } = await import('./testing.ts')
  let s = performance.now()
  let image = snapshot(g.vocab)
  out({ m: 'test:image-build', ms: +(performance.now() - s).toFixed(1) })
  await time('test:image-copy', () => preparedDriver(image)[Symbol.dispose]())
}

// Writes.
let before = kind == 'history' ? tip(drv!) : undefined
let probe = tasks[100 % tasks.length]
let titleOf = async () =>
  ((await g.get([probe]))[0]?.doc as { title?: string })?.title
let prior = await titleOf()
let run = Math.floor(Math.random() * 1e6)
let titled = new Map<string, string>()
await time('write:title-edit', (i) => {
  let eid = tasks[(i + 100) % tasks.length]
  let title = `probe ${kind} ${run} ${i}`
  if (i >= 0) titled.set(eid, title)
  return g.apply(signed([{ entity: { eid }, doc: { title } }], who))
})
await time('write:batch-100-edits', (i) =>
  g.apply(signed(
    tasks.map((eid) => ({
      entity: { eid },
      doc: { title: `batch ${kind} ${run} ${i}` },
    })),
    who,
  )), 11)

let [effect] = await g.read(
  '.effect.state=pending .fields=effect.lease_token,effect.attempts .limit=1',
  fresh(),
) as Bundle[]
if (effect) {
  let { token } = await import('@yaks/graph')
  await time('write:effect-claim', async () => {
    let [now] = await g.get([effect.entity.eid])
    let row = now.effect as Record<string, unknown>
    return g.apply([{
      entity: { eid: effect.entity.eid },
      effect: {
        attempts: Number(row.attempts ?? 0) + 1,
        next: null,
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
} else out({ m: 'write:effect-claim', skipped: 'no pending effect' })

// History: one entity as of a transaction before this run's writes.
if (kind == 'history') {
  let at = before!
  let then = await within({ at }, () => g.get([probe]))
  let was = (then[0]?.doc as { title?: string })?.title
  out({
    m: 'answer:as-of',
    then: was,
    prior,
    ok: was == prior,
    now: await titleOf(),
  })
  await time('read:as-of-get', () => within({ at }, () => g.get([probe])))
  await time(
    'read:as-of-open-page',
    () => within({ at }, () => g.read(page, fresh())),
  )
  let count = (m = {}) =>
    within(
      m,
      () =>
        drv!.query(
          {
            t: 'select',
            cols: [raw('count(*) as "n"')],
            from: { t: 'table', name: 'doc' },
          } as never,
        ),
    )
  out({
    m: 'answer:doc-count',
    now: (await count())[0].n,
    then: (await count({ at }))[0].n,
  })
  await time('read:doc-count-now', () => count(), 11)
  await time('read:doc-count-as-of', () => count({ at }), 11)

  // A branch of main at the newest transaction, a write on it, reads of it.
  let b = branch(drv!)
  await time('branch:create', () => branch(drv!))
  await time(
    'branch:title-edit',
    (i) =>
      within(b, () =>
        g.apply(
          signed(
            [{ entity: { eid: probe }, doc: { title: `branch ${i}` } }],
            who,
          ),
        )),
  )
  out({
    m: 'answer:branch',
    branch: ((await within(b, () =>
      g.get([probe])))[0]?.doc as { title?: string })?.title,
    main: ((await g.get([probe]))[0]?.doc as { title?: string })?.title,
  })
  await time('branch:get', () => within(b, () => g.get([probe])))
  await time('branch:open-page', () => within(b, () => g.read(page, fresh())))
}
if (kind == 'journal') {
  let storage = g.storage as unknown as { statements: unknown }
  let j = logFor({ storage } as never)
  let seq = j.latest(probe)
  out({ m: 'journal:latest', seq })
  if (seq) {
    await time('read:journal-before', () => j.before(probe, seq))
    await time('read:journal-history-20', () => j.history(probe, 20))
  }
}
await host.close?.()
Deno.exit(0)
