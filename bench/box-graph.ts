/** The box bench's in-process half (./box.ts): `apply()` and the effect pool
 * on the graph a config names, composed for the `graph` role the way a
 * writing command composes it. Only no-op handlers run, so nothing owed is
 * ever acted on. Started by box.ts without network permission:
 *
 *   deno run <PERMS> bench/box-graph.ts <config> <target eid> <out.json>
 *
 * It writes, as JSON, the samples of every in-process bench (box-lib.ts
 * `GRAPH`). */
import { compose, facet } from '@yaks/cli/host'
import { read } from '@yaks/cli'
import { type Access, type Bundle, type Graph, mint } from '@yaks/graph'
import { effects } from '@yaks/effects'
import {
  among,
  col,
  count,
  desc,
  eq,
  lit,
  select,
  type Stmt,
  table,
} from '@yaks/sql'
import { type Event, record } from '@yaks/trace'
import type { Sample } from '@yaks/benchmark'
import {
  BACKLOGS,
  BATCHES,
  GRAPH as NAMES,
  split,
  statements,
} from './box-lib.ts'

/** Single comments whose owed runs are stepped through one at a time. */
let STEPS = 6
/** Comments, in one batch, whose owed runs one unbounded pass drains. */
let DRAINED = 25

class Rollback extends Error {}

if (import.meta.main) {
  let [path, target, out] = Deno.args
  if (!path || !target || !out) {
    throw new Error('usage: box-graph.ts <config> <target eid> <out.json>')
  }
  await Deno.writeTextFile(out, JSON.stringify(await measure(path, target)))
}

export async function measure(path: string, target: string) {
  let host = await compose({ ...read(path), duties: false }, ['graph'], facet)
  let g: Graph = host.graph
  let samples: Record<string, Sample[]> = Object.fromEntries(
    NAMES.map((n) => [n, []]),
  )
  let now = () => performance.now()
  let driver = host.storage.statements
  let query = (s: Stmt) => driver.query(s)

  /** A comment on the bench's own target, shaped as `comment new` writes one. */
  let comments = (n: number): Bundle[] =>
    Array.from({ length: n }, (_, i) => ({
      entity: { eid: mint() },
      doc: { body: `box bench comment ${i}` },
      comment: { target },
    }))
  let applied = async (bundles: Bundle[]) => {
    let start = now()
    let { spans } = await record(g, () => g.apply(bundles))
    return { ms: now() - start, spans }
  }

  // The pool as a worker serving `effects` runs it, over an Access that times
  // each read and write the pool makes, with a no-op for every declared
  // effect: a run is claimed, its target read, nothing done, and the row
  // settled. The workers join before they handle anything, so joining owes no
  // start-up runs and sweeps nothing.
  type Timing = {
    kind: string
    eid?: string
    start: number
    end: number
    spans?: Event[]
  }
  let timings: Timing[] = []
  let recording = false
  let timed = async (
    kind: string,
    eid: string | undefined,
    run: () => Promise<unknown> | unknown,
  ) => {
    let start = now()
    let spans: Event[] | undefined
    let value = recording
      ? await record(g, async () => await run()).then((r) => (
        spans = r.spans, r.result
      ))
      : await run()
    timings.push({ kind, eid, start, end: now(), spans })
    return value
  }
  let kindOf = (bundles: Bundle[]) =>
    bundles.length != 1 || !bundles[0].$was
      ? 'apply'
      : bundles[0].$delete
      ? 'settle'
      : (bundles[0].effect as { lease_token?: string })?.lease_token
      ? 'claim'
      : 'apply'
  let access: Access = {
    vocab: g.vocab,
    rows: (q, o) => g.rows(q, o),
    get: (eids, comps) => g.get(eids, comps),
    get outside() {
      return g.outside
    },
    read: ((q: unknown, o?: unknown) =>
      timed(
        typeof q == 'string' ? 'lease read' : 'due read',
        undefined,
        () => g.read(q as never, o as never),
      )) as Access['read'],
    apply: (bundles, o) =>
      timed(
        kindOf(bundles),
        bundles[0]?.entity.eid,
        () => g.apply(bundles, o),
      ) as Promise<Bundle[]>,
  }
  let worker = (max: number) =>
    effects(g.vocab, {
      owner: mint(),
      max,
      defer: true,
      write: (b) => g.apply(b, { trusted: true }),
      report: (error) => {
        throw error
      },
    })
  let declared = new Set(
    host.fx.slots().filter((s) => s.effect && s.kind != 'started').map((s) =>
      s.id
    ),
  )
  let noop = Object.fromEntries([...declared].map((name) => [name, () => {}]))
  let drainer = worker(Infinity)
  let stepper = worker(1)
  let pass = (fx: typeof drainer, passes: number) =>
    fx.work(access, AbortSignal.abort(), passes)

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
  // Work done inside a transaction that is always rolled back, starting with
  // nothing pending: what the commands box.ts ran owed is set aside (marked
  // settled), so every pool measurement sees only its own runs, and the copy
  // is the same afterwards. Writes inside it are savepoints, so their commit
  // is not in what it times; `apply/1`'s `sql commit` is.
  let aside = async (body: () => Promise<void>) => {
    try {
      await host.storage.tx(async () => {
        query({
          t: 'update',
          table: 'effect',
          set: { state: lit('done') },
          where: eq(col('state'), lit('pending')),
        })
        await body()
        throw new Rollback()
      })
    } catch (error) {
      if (!(error instanceof Rollback)) throw error
    }
  }
  let claims = () => timings.filter((t) => t.kind == 'claim')

  try {
    if (!(await g.get([target])).length) {
      await g.apply([{ entity: { eid: target }, doc: { title: 'box bench' } }])
    }
    // Warm statement caches and plugin state before anything is timed.
    await g.apply(comments(10))
    await pass(drainer, 1)
    await pass(stepper, 1)
    drainer.handle(noop)
    stepper.handle(noop)

    for (let [n, count] of BATCHES) {
      for (let i = 0; i < count; i++) {
        let { ms, spans } = await applied(comments(n))
        samples[`apply/${n}`].push({
          value: ms,
          counts: { bundles: n, statements: spans.filter(sql).length },
          details: {
            split: rounded(split(spans)),
            sql: top(statements(spans)),
          },
        })
      }
    }

    // What one unbounded pass, the pool's own default, takes per run.
    await aside(async () => {
      await g.apply(comments(DRAINED))
      let owed = pending()
      timings = []
      let start = now()
      await pass(drainer, Infinity)
      let ms = now() - start
      let runs = timings.filter((t) => t.kind == 'settle').length
      samples['pool/drain'].push({
        value: runs ? ms / runs : 0,
        counts: { runs, owed },
        details: { ms },
      })
    })

    // A run's life, one at a time: owed inside its comment's own commit (the
    // effects registry's share of that commit, per run it owed), then claimed,
    // run and settled by a pass that starts one run.
    await aside(async () => {
      recording = true
      for (let i = 0; i < STEPS; i++) {
        let { spans } = await applied(comments(1))
        let owed = spans.filter((e) =>
          e.kind == 'effect' && e.package == '@yaks/effects'
        ).length
        let ms = spans.filter((e) =>
          e.kind == 'phase' && e.plugin == '@yaks/effects'
        ).reduce((sum, e) =>
          sum + (e.duration ?? 0), 0)
        samples['pool/owe'].push({
          value: owed ? ms / owed : 0,
          counts: { owed },
        })
        timings = []
        while (pending()) {
          let before = claims().length
          await pass(stepper, 1)
          if (claims().length == before) break
        }
        for (let claim of claims()) {
          let settle = timings.find((t) =>
            t.kind == 'settle' && t.eid == claim.eid
          )
          if (!settle) continue
          samples['pool/claim'].push(stepped(claim))
          samples['pool/run'].push({ value: settle.start - claim.end })
          samples['pool/settle'].push(stepped(settle))
        }
      }
      recording = false
    })

    // One pass over a backlog with no run due: settled rows marked pending
    // again, with a `next` far away.
    for (let [name, n] of BACKLOGS) {
      await aside(async () => {
        if (n) {
          query({
            t: 'update',
            table: 'effect',
            set: {
              state: lit('pending'),
              next: lit('2100-01-01T00:00:00.000Z'),
              lease_owner: lit(null),
              lease_token: lit(null),
              lease_expiry: lit(null),
            },
            where: among(
              col('entity'),
              select({
                cols: [col('entity')],
                from: table('effect'),
                where: eq(col('state'), lit('done')),
                order: [desc(col('entity'))],
                limit: lit(n),
              }),
            ),
          })
        }
        let backlog = pending()
        timings = []
        let start = now()
        await pass(stepper, 1)
        let ms = now() - start
        // An unbounded worker passes without asking first whether another
        // is working the pool; this drain asks (a `lease read`), so that is
        // taken out of the pass.
        let took = (kind: string) =>
          timings.filter((t) => t.kind == kind)
            .reduce((sum, t) => sum + t.end - t.start, 0)
        samples[`pool/due ${name}`].push({
          value: ms - took('lease read'),
          counts: { pending: backlog },
          details: { read: took('due read'), lease: took('lease read'), ms },
        })
      })
    }
    return samples
  } finally {
    await host.close()
  }
}

function stepped(t: { start: number; end: number; spans?: Event[] }): Sample {
  return {
    value: t.end - t.start,
    ...(t.spans
      ? {
        counts: { statements: t.spans.filter(sql).length },
        details: {
          split: rounded(split(t.spans)),
          sql: top(statements(t.spans)),
        },
      }
      : {}),
  }
}

function sql(e: Event) {
  return e.kind == 'sql'
}

function rounded(by: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(by).sort((a, b) => b[1] - a[1]).map((
      [k, v],
    ) => [k, +v.toFixed(3)]),
  )
}

function top(by: Record<string, { n: number; ms: number }>) {
  return Object.fromEntries(
    Object.entries(by).sort((a, b) => b[1].ms - a[1].ms).slice(0, 12)
      .map(([k, v]) => [k, { n: v.n, ms: +v.ms.toFixed(3) }]),
  )
}
