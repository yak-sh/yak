// Profile graph.apply on the box's plugin composition or the apply-benchmark
// fixture. Optional wrappers observe the public driver, storage and tracker
// interfaces; spans-only modes use the ordinary recording.
import { compose, facet } from '@yaks/cli/host'
import { configPath, read } from '@yaks/cli'
import { type Bundle, type Graph, signed, type Storage } from '@yaks/graph'
import type { Expr, Stmt } from '@yaks/sql'
import { record as capture } from '@yaks/trace'
import { applyBundles, applyFixture } from './apply-fixture.ts'

const config = read(configPath()!)
const parent = config.db!.slice(0, config.db!.lastIndexOf('/'))
const dir = Deno.makeTempDirSync({ dir: parent, prefix: 'apply-profile-' })
const rounds = Number(Deno.args[0] ?? 5)
const only = Deno.args[1]
const countScans = Deno.args[2] == 'counts'
const traceBench = Deno.args[2] == 'bench'
const traceOnly = Deno.args[2] == 'spans' || traceBench
let attribution: {
  transaction_us: number
  children_us: number
  coverage_percent: number
  sql_outside_phases: ReturnType<typeof summary>
} | undefined
const actor = traceBench
  ? applyBundles('edit', 1)[0].$actor!.by!
  : 'f6465700-0000-4000-8000-000000000001'
let serial = 1
const eid = () =>
  `f6465700-0000-4000-8000-${String(++serial).padStart(12, '0')}`
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
type Cost = { ms: number; calls: number }
let costs = new Map<string, Cost>()
let active = false
let location = 'body'
let sql = new Map<string, Cost>()
let scans = { calls: 0, visits: 0 }
let presence = 0
const hasPresence = (e: Expr): boolean =>
  e.t == 'exists' || e.t == 'op' && e.parts.some(hasPresence)
const record = (map: Map<string, Cost>, key: string, ms: number) => {
  const old = map.get(key) ?? { ms: 0, calls: 0 }
  map.set(key, { ms: old.ms + ms, calls: old.calls + 1 })
}
const timed = <T>(key: string, run: () => T): T => {
  if (!active) return run()
  const before = performance.now()
  const result = run()
  if (result instanceof Promise) {
    return result.finally(() =>
      record(costs, key, performance.now() - before)
    ) as T
  }
  record(costs, key, performance.now() - before)
  return result
}
const at = <T>(name: string, run: () => T): T => {
  const old = location
  location = name
  try {
    return run()
  } finally {
    location = old
  }
}
const summary = (map: Map<string, Cost>, n: number) =>
  Object.fromEntries([...map].map(([key, c]) => [key, {
    us_per_bundle: +(c.ms * 1000 / n).toFixed(3),
    calls_per_apply: c.calls,
  }]))

try {
  const fixture = traceBench ? applyFixture('file') : undefined
  const host = fixture
    ? { graph: fixture.g, close: fixture.close, sql: undefined }
    : await compose(
      {
        ...config,
        db: `${dir}/graph.sqlite`,
        tracker: undefined,
        duties: false,
      },
      ['graph'],
      facet,
      { process: false },
    )
  const g: Graph = host.graph
  const driver = host.sql
  if (!traceOnly && driver) {
    const query = driver.query
    driver.query = (stmt: Stmt) => {
      if (!active) return query(stmt)
      const start = performance.now()
      const rows = query(stmt)
      const ms = performance.now() - start
      if (
        stmt.t == 'select' && stmt.where && hasPresence(stmt.where) &&
        stmt.cols?.length == 1 && stmt.cols[0].t == 'col' &&
        stmt.cols[0].name == 'eid'
      ) presence++
      const label = stmt.t == 'insert'
        ? stmt.into
        : stmt.t == 'update'
        ? stmt.table
        : stmt.t == 'pragma'
        ? stmt.name
        : stmt.t == 'select' && stmt.from && !Array.isArray(stmt.from) &&
            stmt.from.t == 'table'
        ? stmt.from.name
        : ''
      record(sql, `${location}/${stmt.t}/${label}`, ms)
      return rows
    }
    const transaction = g.storage.tx
    g.storage.tx = (<T>(body: Parameters<Storage['tx']>[0]): T => {
      const start = performance.now()
      let begin = start, end = start
      return at('storage-head', () => {
        const result = transaction((tx) => {
          begin = performance.now()
          location = 'body'
          const result = body(tx)
          if (result instanceof Promise) {
            throw new Error('profile expects sync storage')
          }
          end = performance.now()
          location = 'storage-tail'
          return result
        })
        if (active) {
          record(costs, 'storage-head', begin - start)
          record(costs, 'storage-tail', performance.now() - end)
        }
        return result as T
      })
    }) as Storage['tx']
    for (const plugin of g.plugins) {
      if (
        countScans && plugin.name == '@yaks/effects' && plugin.hooks?.commit
      ) {
        const hook = plugin.hooks.commit
        plugin.hooks.commit = (bundles, ...args) => {
          if (!active) return hook(bundles, ...args)
          const counted = new Proxy(bundles, {
            get: (target, key, receiver) =>
              key == 'some'
                ? (
                  predicate: (
                    b: Bundle,
                    i: number,
                    values: Bundle[],
                  ) => unknown,
                ) => {
                  scans.calls++
                  return target.some((b, i) => {
                    scans.visits++
                    return predicate(b, i, counted)
                  })
                }
                : Reflect.get(target, key, receiver),
          })
          return hook(counted, ...args)
        }
      }
      if (!plugin.track) continue
      const track = plugin.track
      plugin.track = (tx, found) => {
        const tracker = timed(
          `tracker/${plugin.name}/make`,
          () => track(tx, found),
        )
        const flush = tracker.flush
        tracker.flush = (bundles) =>
          at(
            `flush/${plugin.name}`,
            () => timed(`tracker/${plugin.name}/flush`, () => flush(bundles)),
          )
        return tracker
      }
    }
  }
  console.log(JSON.stringify({
    kind: 'environment',
    deno: Deno.version.deno,
    load: Deno.readTextFileSync('/proc/loadavg').trim(),
    plugins: g.plugins.map((p) => p.name),
    scratch: traceBench
      ? 'file in apply-benchmark fixture'
      : 'file on same filesystem as configured box database',
  }))
  const apply = async (bundles: Bundle[]) => {
    const captured = await capture(
      g,
      () => g.apply(signed(bundles, { by: actor })),
    )
    if (active) {
      const transaction = captured.spans.find((s) =>
        s.name == 'transaction' && s.kind == 'phase'
      )!
      const children = captured.spans.filter((s) => s.parent == transaction.id)
      const intervals = children.map((s) => [s.start!, s.time]).sort((a, b) =>
        a[0] - b[0]
      )
      let covered = 0, end = transaction.start!
      for (const [start, stop] of intervals) {
        covered += Math.max(0, stop - Math.max(start, end))
        end = Math.max(end, stop)
      }
      const outside = new Map<string, Cost>()
      for (const s of children.filter((s) => s.kind == 'sql')) {
        record(outside, s.name, s.duration!)
      }
      attribution = {
        transaction_us: transaction.duration! * 1000,
        children_us: covered * 1000,
        coverage_percent: covered / transaction.duration! * 100,
        sql_outside_phases: summary(outside, bundles.length),
      }
      for (const span of captured.spans) {
        if (
          span.kind == 'phase' && span.stage == 'end' &&
          span.package == '@yaks/graph' && !span.plugin
        ) record(costs, `phase/${span.name}`, span.duration!)
      }
    }
    return captured.result
  }
  const fresh = (n: number): Bundle[] =>
    Array.from({ length: n }, () => ({
      entity: { eid: eid() },
      doc: { title: 'Profile create' },
      task: {},
    }))
  // Prime plugin caches, descriptors and statement shapes before measuring.
  await apply(fresh(100))
  for (const n of [1, 200, 1000]) {
    for (const work of ['create', 'edit']) {
      if (only && only != `${work}-${n}`) continue
      const held = traceBench && work == 'edit'
        ? applyBundles('edit', n)
        : fresh(n)
      await apply(held)
      const reports: {
        wall: number
        phases: ReturnType<typeof summary>
        sql: ReturnType<typeof summary>
        presence_statements_per_apply?: number
        trace: typeof attribution
      }[] = []
      for (let round = 0; round < rounds; round++) {
        const bundles = work == 'create' ? fresh(n) : held.map((b) => ({
          entity: b.entity,
          doc: { title: `Profile edit ${round}` },
        }))
        costs = new Map()
        sql = new Map()
        scans = { calls: 0, visits: 0 }
        presence = 0
        active = true
        const start = performance.now()
        await apply(bundles)
        const wall = (performance.now() - start) * 1000 / n
        active = false
        reports.push({
          wall,
          phases: summary(costs, n),
          sql: summary(sql, n),
          presence_statements_per_apply: traceOnly ? undefined : presence,
          trace: attribution,
        })
      }
      const middle = median(reports.map((r) => r.wall))
      console.log(JSON.stringify({
        kind: 'sample',
        work,
        n,
        rounds,
        wall_us_per_bundle: middle,
        samples_us_per_bundle: reports.map((r) => r.wall),
        ...reports.find((r) => r.wall == middle),
        ...(countScans ? { effects_bundle_scans: scans } : {}),
        load: Deno.readTextFileSync('/proc/loadavg').trim(),
      }))
    }
  }
  await host.close()
} finally {
  active = false
  Deno.removeSync(dir, { recursive: true })
}
