// Actual workerd cursor writes from both the global reservation and target
// graphs. Installation is explicit setup; rejected floods install nothing.
import { type Bundle, derivedEid } from '@yaks/graph'
import type { Cost, TraceStorage } from './store_trace_fixture.ts'
import { type State, Tracker } from '../tracker/object.ts'
import { platform } from '../tracker/core.ts'
import { sampleRequest } from '@yaks/timing'
import { during, peek, record } from '@yaks/trace'
import { driver } from '@yaks/durable-object'
import { select, table } from '@yaks/sql'

let empty = (): Cost => ({ read: 0, written: 0, statements: 0 })
let space = derivedEid('T-66171|space')
export let tinyTrace = (n: number, spans = 1): Bundle[] => {
  let root = derivedEid(`T-66171|${n}|trace`)
  let first = derivedEid(`T-66171|${n}|span0`)
  let during = {
    space,
    app: derivedEid(`T-66171|${n}|app`),
    entity: derivedEid(`T-66171|${n}|entity`),
    process: derivedEid(`T-66171|${n}|process`),
    request: derivedEid(`T-66171|${n}|request`),
    kind: 'fixture',
  }
  return [
    {
      entity: { eid: root },
      trace: {
        op: 'request',
        name: 'query',
        at: '2026-10-06T16:00:00Z',
      },
      during,
    },
    ...Array.from({ length: spans }, (_, i) => ({
      entity: { eid: derivedEid(`T-66171|${n}|span${i}`) },
      span: {
        trace: root,
        ...i ? { parent: first } : {},
        op: i ? 'sql' : 'request',
        name: i ? 'recipe select' : 'query',
        package: '@yaks/fixture',
        plugin: 'fixture',
        outcome: 'ok',
      },
      during: {
        ...during,
        // Force all allowed external reference spines to be fresh per entity.
        app: derivedEid(`T-66171|${n}|${i}|app`),
        entity: derivedEid(`T-66171|${n}|${i}|entity`),
        process: derivedEid(`T-66171|${n}|${i}|process`),
        request: derivedEid(`T-66171|${n}|${i}|request`),
      },
      elapsed: { start: i, ms: 0 },
      rows_read: { n: 10001 },
      rows_written: { n: 3 },
      statements: { n: 1 },
      repeats: { n: 99 },
    })),
  ]
}

export let trackerBound = async (db: TraceStorage) => {
  let exec = db.sql.exec.bind(db.sql), cost = empty(), measuring = false
  db.sql.exec = (sql, ...args) => {
    let c = exec(sql, ...args), rows = c.toArray()
    if (c.rowsRead == null || c.rowsWritten == null) {
      throw Error('workerd counters required')
    }
    if (measuring) {
      cost.read += c.rowsRead
      cost.written += c.rowsWritten
      cost.statements++
    }
    return {
      rowsRead: c.rowsRead,
      rowsWritten: c.rowsWritten,
      toArray: () => rows,
      [Symbol.iterator]: () => rows.values(),
    }
  }
  let state = (scope: string): State => ({
    id: { name: scope },
    storage: {
      sql: db.sql,
      transactionSync: (body) => db.transactionSync(body),
      get: () => Promise.resolve(undefined),
      put: () => Promise.resolve(),
      setAlarm: () => Promise.resolve(),
    },
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  })
  try {
    await db.deleteAll()
    let target = new Tracker(state(space))
    let authority = new Tracker(state(platform))
    // Explicit activation, never charged to trace intake.
    await target.boot()
    await authority.boot()
    let now = 1_791_300_000_000
    let shapes: { entities: number; cost: Cost }[] = []
    for (let spans of [1, 2, 9, 72]) {
      cost = empty()
      measuring = true
      await target.tracker!.ingest(tinyTrace(spans, spans))
      measuring = false
      shapes.push({ entities: spans + 1, cost: { ...cost } })
    }
    // A shared physical database here counts every authority/target statement;
    // the logical objects still have independent admission and tenant scopes.
    let otherSpace = derivedEid('T-66171|other-space')
    let otherTarget = new Tracker(state(otherSpace))
    await otherTarget.boot()
    let scopes = [space, otherSpace]
    let targets = new Map([[space, target], [otherSpace, otherTarget]])
    let settings = {
      TRACKERS: {
        getByName: (scope: string) => {
          let destination = targets.get(scope)
          if (!destination) throw Error('uninitialized fixture scope')
          return {
            ingestTrace: (rows: Bundle[]) => destination.ingestTrace(rows),
          }
        },
      },
    }
    authority = new Tracker(state(platform), settings, () => now)
    let trace = (n: number, scope = space, spans = 1) =>
      tinyTrace(n, spans).map((row) => ({
        ...row,
        during: { ...(row.during as Record<string, unknown>), space: scope },
      }))
    // Both useful ordinary captures and huge statement trees pass the same
    // authority as queue intake. Projection bounds the latter before delivery.
    let sql = driver(db), statement = select({ from: table('server_meta') })
    let capture = (n: number) => {
      let target = {}
      cost = empty()
      measuring = true
      let captured = record(target, () => {
        let c = peek(target)!
        during(c.begin({ kind: 'request', name: 'query' }), () => {
          for (let i = 0; i < n; i++) sql.query(statement)
        })
      }, { history: false })
      measuring = false
      return { captured, totals: { ...cost } }
    }
    let ordinaryRequest = capture(72), largeRequest = capture(5000)
    let projectRequest = (n: number, request: ReturnType<typeof capture>) =>
      sampleRequest(request.captured.spans, {
        requested: true,
        rowsRead: request.totals.read,
        rowsWritten: request.totals.written,
        eid: derivedEid(`T-66207|${n}`),
        origin: 0,
        during: { space },
      })!
    let ordinary = projectRequest(4000, ordinaryRequest)
    let capped = projectRequest(4001, largeRequest)
    cost = empty()
    measuring = true
    let useful = [
      await authority.admitTrace(space, ordinary),
      await authority.admitTrace(space, capped),
    ]
    measuring = false
    let usefulCost = { ...cost }
    let stored = await target.tracker!.graph.get(
      capped.map((r) => r.entity.eid),
    )
    // Expire the successful reservations, not their metrics, before the flood.
    now += 3_600_000
    cost = empty()
    measuring = true
    let flood = await Promise.all(Array.from({ length: 20 }, (_, i) => {
      let scope = scopes[i % 2]
      return authority.admitTrace(scope, trace(1000 + i, scope, 200))
    }))
    measuring = false
    let floodCost = { ...cost }, budget = authority.traceBudget()
    let complete = []
    for (let i = 0; i < 20; i++) {
      let rows = await target.tracker!.graph.get(
        trace(1000 + i, space, 200).map((row) => row.entity.eid),
      )
      complete.push(rows.filter((row) => row.trace || row.span).length)
    }
    // Reincarnation is not a free allowance, and late target completion cannot
    // cross into a new calendar hour and borrow that minute's ceiling.
    authority = new Tracker(state(platform), settings, () => now)
    now += 3_599_999
    cost = empty()
    measuring = true
    let before = await authority.admitTrace(space, trace(2000, space, 200))
    measuring = false
    let beforeCost = { ...cost }
    now += 1
    cost = empty()
    measuring = true
    let after = await authority.admitTrace(space, trace(2001))
    measuring = false
    let afterCost = { ...cost }
    // A marked target can be recreated and admit without fitting schema.
    now += 3_600_000
    let reopened = new Tracker(state(space))
    targets.set(space, reopened)
    cost = empty()
    measuring = true
    let cold = await authority.admitTrace(space, trace(2200))
    measuring = false
    let coldCost = { ...cost }
    // Entire oversized traces and later rootless chunks are dropped before SQL.
    cost = empty()
    measuring = true
    let large = trace(3000, space, 201)
    let oversized = await authority.admitTrace(space, large)
    let orphan = await authority.admitTrace(space, large.slice(10, 20))
    measuring = false
    let droppedCost = { ...cost }
    return {
      shapes,
      useful,
      usefulCost,
      ordinarySize: ordinary.length,
      cappedSize: capped.length,
      stored,
      ordinaryStored: await target.tracker!.graph.get(
        ordinary.map((r) => r.entity.eid),
      ),
      ordinaryTotals: ordinaryRequest.totals,
      cappedTotals: largeRequest.totals,
      flood,
      floodCost,
      budget,
      complete,
      before,
      beforeCost,
      after,
      afterCost,
      cold,
      coldCost,
      oversized,
      orphan,
      droppedCost,
    }
  } finally {
    db.sql.exec = exec
  }
}
