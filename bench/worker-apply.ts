/** Where a graph write's time goes inside a warm effect worker: the host a
 * config names composed once for the `graph` role, as box-graph.ts composes
 * it (with the trace subscription a worker keeps; `NOTRACE=1` composes without
 * it), and one pool worker staying up over it, as `yak work` runs one, with a
 * no-op handler for every declared effect. Nothing is opened or composed per
 * write.
 *
 *   deno run -A bench/worker-apply.ts <config> [samples] [backlog]
 *
 * Prints, as JSON lines:
 *
 * - `connection`: the SQLite settings the graph's connection runs with.
 * - `wall`: the median owing commit (a comment edit owing one run), claim and
 *   settle, and one run's life from the commit that owes it to its settle,
 *   the writer nudging the worker as a thread beside it does.
 * - `phase`: the same three writes recorded: each phase's own time, with the
 *   SQL statements and rows run directly under it (`SHOW=1` lists them).
 * - `drain`: runs settled a second from `backlog` pending no-op runs written
 *   through the graph, once the worker is woken (`SQLTOP=1` adds the
 *   statements that took the most time).
 *
 * With `samples` 0 it only writes the backlog and exits, so that a second
 * process (under `--cpu-prof`, say) measures the drain by itself: whatever is
 * pending when the worker starts is drained and reported first.
 *
 * The database the config names is written to; run it on a copy. */
import process from 'node:process'
import { compose, facet } from '@yaks/cli/host'
import { read } from '@yaks/cli'
import {
  type Access,
  type Bundle,
  derivedEid,
  type Graph,
  mint,
} from '@yaks/graph'
import { effects } from '@yaks/effects'
import { col, count, eq, lit, select, type Stmt, table } from '@yaks/sql'
import { channel, type Event, record } from '@yaks/trace'

let TARGET = derivedEid('@yaks/bench box target')

type Write = { kind: string; eid?: string; ms: number; spans?: Event[] }

export async function measure(path: string, samples: number, backlog: number) {
  let host = await compose({ ...read(path), duties: false }, ['graph'], facet, {
    process: !Deno.env.get('NOTRACE'),
  })
  let g: Graph = host.graph
  let query = (s: Stmt) => host.storage.statements.query(s)
  let pending = () =>
    Number(
      Object.values(
        query(select({
          cols: [count()],
          from: table('effect'),
          where: eq(col('state'), lit('pending')),
        }))[0],
      )[0],
    )

  let writes: Write[] = []
  let recording = false
  let kindOf = (bundles: Bundle[]) =>
    bundles.length != 1 || !bundles[0].$was
      ? 'apply'
      : bundles[0].$delete
      ? 'settle'
      : (bundles[0].effect as { lease_token?: string })?.lease_token
      ? 'claim'
      : 'apply'
  let timed = async (
    kind: string,
    eid: string | undefined,
    run: () => unknown,
  ) => {
    let start = performance.now()
    if (!recording) {
      let value = await run()
      writes.push({ kind, eid, ms: performance.now() - start })
      heard(kind)
      return value
    }
    let { result, spans } = await record(g, async () => await run())
    writes.push({ kind, eid, ms: performance.now() - start, spans })
    heard(kind)
    return result
  }
  let access: Access = {
    vocab: g.vocab,
    rows: (q, o) => g.rows(q, o),
    get: (eids, comps) => g.get(eids, comps),
    get outside() {
      return g.outside
    },
    read: (q, o) => g.read(q, o),
    apply: (bundles, o) =>
      timed(
        kindOf(bundles),
        bundles[0]?.entity.eid,
        () => g.apply(bundles, o),
      ) as Promise<Bundle[]>,
  }
  let settled = 0
  let waiters: { n: number; done: (at: number) => void }[] = []
  let settledAt = (n: number) =>
    new Promise<number>((done) => waiters.push({ n: settled + n, done }))
  let heard = (kind: string) => {
    if (kind != 'settle') return
    settled++
    let at = performance.now()
    waiters = waiters.filter((w) => w.n > settled || (w.done(at), false))
  }
  let declared = new Set(
    host.fx.slots().filter((s) => s.effect && s.kind != 'started').map((s) =>
      s.id
    ),
  )
  let noop = Object.fromEntries([...declared].map((name) => [name, () => {}]))
  // The worker as `yak work` runs it: joined once, then a pass, a wait, and
  // another, until it is stopped. It joins before any handler is registered,
  // so joining owes no start-up runs and sweeps nothing.
  let stopping = new AbortController()
  let fx = effects(g.vocab, {
    owner: mint(),
    defer: true,
    write: (b) => g.apply(b, { trusted: true }),
    report: (error) => {
      throw error
    },
  })
  let working: Promise<void> = Promise.resolve()

  // A comment on the bench's own target, then its body edited: the edit owes
  // a run, as box-graph.ts measures it.
  let edit = async () => {
    let eid = mint()
    await g.apply([{
      entity: { eid },
      doc: { body: 'worker bench comment' },
      comment: { target: TARGET },
    }])
    return [{ entity: { eid }, doc: { body: 'worker bench comment, edited' } }]
  }
  // One run's life: owed by the edit's commit, picked up by the worker when
  // the writer nudges it (as a thread beside it does), claimed, run, settled.
  let life = async (kind = 'owe') => {
    let bundles = await edit()
    let done = settledAt(1)
    let start = performance.now()
    await timed(kind, bundles[0].entity.eid, () => g.apply(bundles))
    fx.wake()
    return (await done) - start
  }

  // Runs owed for no-op handlers, written through the graph a thousand at a
  // time, as a writer that serves no effects leaves them.
  let prefill = async (n: number) => {
    let at = new Date().toISOString()
    for (let i = 0; i < n; i += 1000) {
      await g.apply(
        Array.from({ length: Math.min(1000, n - i) }, () => ({
          entity: { eid: mint() },
          effect: {
            handler: 'persona_files',
            target: TARGET,
            comp: 'doc',
            kind: 'changed',
            state: 'pending',
            attempts: 0,
            at,
            generation: 0,
          },
        })),
        { trusted: true },
      )
    }
  }
  // Every pending run, settled by the worker once woken.
  let drain = async () => {
    let owed = pending()
    writes = []
    let sqlTop = new Map<string, { n: number; ms: number; rows: number }>()
    let stop = Deno.env.get('SQLTOP')
      ? channel(g).subscribe((e) => {
        if (e.kind != 'sql' || e.stage != 'end') return
        let k = e.sql ?? e.name
        let s = sqlTop.get(k) ?? { n: 0, ms: 0, rows: 0 }
        s.n++
        s.ms += e.duration ?? 0
        s.rows += e.counts?.rows ?? 0
        sqlTop.set(k, s)
      })
      : undefined
    let done = settledAt(owed)
    let cpu = process.cpuUsage()
    let start = performance.now()
    fx.wake()
    let ms = (await done) - start
    let used = process.cpuUsage(cpu)
    let cpuMs = (used.user + used.system) / 1000
    stop?.()
    for (
      let [k, s] of [...sqlTop].sort((a, b) => b[1].ms - a[1].ms).slice(0, 40)
    ) {
      out({
        kind: 'sql',
        ms: +s.ms.toFixed(1),
        n: s.n,
        rows: s.rows,
        sql: k.slice(0, 300),
      })
    }
    out({
      kind: 'drain',
      owed,
      left: pending(),
      ms: +ms.toFixed(1),
      runs_per_s: +(owed / ms * 1000).toFixed(1),
      cpu_ms: +cpuMs.toFixed(1),
      runs_per_cpu_s: +(owed / cpuMs * 1000).toFixed(1),
      claims: writes.filter((w) => w.kind == 'claim').length,
      settles: writes.filter((w) => w.kind == 'settle').length,
    })
  }

  try {
    out({
      kind: 'connection',
      ...Object.fromEntries(
        [
          'journal_mode',
          'synchronous',
          'wal_autocheckpoint',
          'journal_size_limit',
        ]
          .map((
            name,
          ) => [name, Object.values(query({ t: 'pragma', name })[0] ?? {})[0]]),
      ),
    })
    if (!(await g.get([TARGET])).length) {
      await g.apply([{ entity: { eid: TARGET }, doc: { title: 'box bench' } }])
    }
    if (!samples) return await prefill(backlog)
    working = fx.work(access, stopping.signal)
    await new Promise((done) => setTimeout(done, 100))
    fx.handle(noop)
    // Whatever the copy had pending is drained first: a backlog left by
    // `prefill` (samples 0) in an earlier process, measured by itself.
    if (pending()) await drain()
    for (let i = 0; i < 20; i++) await life()

    // Unrecorded.
    writes = []
    let lives: number[] = []
    for (let i = 0; i < samples; i++) lives.push(await life())
    let wall = (kind: string) =>
      median(writes.filter((w) => w.kind == kind).map((w) => w.ms))
    out({
      kind: 'wall',
      owe: wall('owe'),
      claim: wall('claim'),
      settle: wall('settle'),
      owe_to_settle: median(lives),
    })

    // Recorded: every phase's own time, statements and rows.
    writes = []
    recording = true
    for (let i = 0; i < samples; i++) await life()
    recording = false
    for (let kind of ['owe', 'claim', 'settle']) {
      let mine = writes.filter((w) => w.kind == kind && w.spans)
      if (Deno.env.get('SHOW') && mine.length) {
        let spans = mine.at(-1)!.spans!
        let by = new Map(spans.map((e) => [e.id, e]))
        let path = (e: Event) => {
          let parts = []
          for (
            let at = e.parent ? by.get(e.parent) : undefined;
            at;
            at = at.parent ? by.get(at.parent) : undefined
          ) {
            if (at.kind == 'apply') break
            parts.unshift(at.plugin ? `${at.name}:${at.plugin}` : at.name)
          }
          return parts.join('/')
        }
        let sorted = spans.filter((e) =>
          e.kind == 'sql' && !/pragma (schema|data)_version/.test(e.sql ?? '')
        )
          .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
        console.log(
          `--- ${kind}: ${sorted.length} statements besides version pragmas`,
        )
        for (let e of sorted) {
          console.log(
            `${(e.duration ?? 0).toFixed(3)}ms rows=${e.counts?.rows} [${
              path(e)
            }] ${(e.sql ?? e.name).replace(/\s+/g, ' ').slice(0, 400)}`,
          )
        }
      }
      out({
        kind: 'phase',
        write: kind,
        n: mine.length,
        recorded_ms: median(mine.map((w) => w.ms)),
        phases: medianPhases(mine.map((w) => phases(w.spans!))),
      })
    }

    if (backlog) {
      await prefill(backlog)
      await drain()
    }
  } finally {
    stopping.abort()
    await working
    await host.close()
  }
}

let out = (o: unknown) => console.log(JSON.stringify(o))

let median = (values: number[]) => {
  if (!values.length) return 0
  let sorted = [...values].sort((a, b) => a - b)
  return +sorted[Math.floor(sorted.length / 2)].toFixed(3)
}

type Cost = {
  ms: number
  statements: number
  rows: number
  sql: Record<string, number>
}

/** Each phase's own share of one recorded write, keyed by its path from the
 * apply (`transaction/commit/@yaks/effects`): its time less its child phases',
 * and the SQL statements, with their rows, whose nearest phase it is. */
export let phases = (spans: Event[]): Record<string, Cost> => {
  let by = new Map(spans.map((e) => [e.id, e]))
  let key = (e: Event): string => {
    let parts: string[] = []
    for (
      let at: Event | undefined = e;
      at;
      at = at.parent ? by.get(at.parent) : undefined
    ) {
      if (at.kind == 'apply') break
      if (at.kind == 'sql') continue
      parts.unshift(
        at.plugin
          ? `${at.name}:${at.plugin}`
          : at.kind == 'phase'
          ? at.name
          : `${at.kind}:${at.name}`,
      )
    }
    return parts.join('/') || '(apply)'
  }
  let below = new Map<string, number>()
  for (let e of spans) {
    if (e.parent && e.kind != 'sql') {
      below.set(e.parent, (below.get(e.parent) ?? 0) + (e.duration ?? 0))
    }
  }
  let out: Record<string, Cost> = {}
  let cost = (k: string) =>
    out[k] ??= { ms: 0, statements: 0, rows: 0, sql: {} }
  for (let e of spans) {
    if (e.duration == null) continue
    if (e.kind == 'sql') {
      let parent = e.parent ? by.get(e.parent) : undefined
      let c = cost(parent ? key(parent) : '(apply)')
      c.statements++
      c.rows += e.counts?.rows ?? 0
      c.sql[e.name] = (c.sql[e.name] ?? 0) + 1
      continue
    }
    let c = cost(key(e))
    c.ms += Math.max(0, e.duration - (below.get(e.id) ?? 0))
  }
  return out
}

let medianPhases = (all: Record<string, Cost>[]) => {
  let keys = [...new Set(all.flatMap((p) => Object.keys(p)))]
  let total = (p: Record<string, Cost>) =>
    Object.values(p).reduce((s, c) => s + c.ms, 0)
  let at = (k: string, f: (c: Cost) => number) =>
    median(all.map((p) => p[k] ? f(p[k]) : 0))
  return {
    total_ms: median(all.map(total)),
    statements: median(
      all.map((p) => Object.values(p).reduce((s, c) => s + c.statements, 0)),
    ),
    rows: median(
      all.map((p) => Object.values(p).reduce((s, c) => s + c.rows, 0)),
    ),
    by: Object.fromEntries(
      keys.map((k) => [k, {
        ms: at(k, (c) => c.ms),
        statements: at(k, (c) => c.statements),
        rows: at(k, (c) => c.rows),
        sql: all.find((p) => p[k]?.statements)?.[k].sql,
      }]).sort((a, b) =>
        (b[1] as { ms: number }).ms - (a[1] as { ms: number }).ms
      ),
    ),
  }
}

if (import.meta.main) {
  let [path, samples = '25', backlog = '20000'] = Deno.args
  if (!path) throw new Error('usage: worker-apply.ts <config> [samples]')
  await measure(path, Number(samples), Number(backlog))
}
