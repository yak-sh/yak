// Own workerd object storage for tracker budget regression; no live traffic.
import { DurableObject } from 'cloudflare:workers'
import { type Bundle } from '@yaks/graph'
import { type State, Tracker } from '../tracker/object.ts'
import { platform } from '../tracker/core.ts'
import { traceBatch } from '@yaks/tracker/intake'
import { tinyTrace, trackerBound } from './tracker_trace_bound_fixture.ts'
import type { TraceStorage } from './store_trace_fixture.ts'
import type { Namespace } from './door.ts'

export class TrackerTraceBound {
  constructor(private ctx: { storage: TraceStorage }) {}
  alarm(): void {}
  async fetch(): Promise<Response> {
    try {
      return Response.json(await trackerBound(this.ctx.storage))
    } catch (error) {
      return Response.json({
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, { status: 500 })
    }
  }
}
// Each logical tracker has separate, untouched workerd storage. No tracker
// fetch runs: only the production admission/intake RPCs precede inspection.
export class TrackerTraceFresh extends DurableObject {
  object?: Tracker
  written = 0
  setupWritten = 0
  constructor(private ctx: State, private env: { FRESH: FreshNamespace }) {
    super(ctx, env)
    let exec = ctx.storage.sql.exec.bind(ctx.storage.sql)
    ctx.storage.sql.exec = (sql, ...args) => {
      let c = exec(sql, ...args), rows = c.toArray()
      this.written += c.rowsWritten ?? 0
      if (args.includes('trace-ready')) this.setupWritten = this.written
      return {
        rowsRead: c.rowsRead,
        rowsWritten: c.rowsWritten,
        toArray: () => rows,
        [Symbol.iterator]: () => rows.values(),
      }
    }
  }
  open(scope: string): Tracker {
    return this.object ??= new Tracker({
      ...this.ctx,
      id: { name: scope },
      storage: this.ctx.storage,
      getWebSockets: () => [],
      acceptWebSocket: () => {},
    }, { TRACKERS: this.env.FRESH })
  }
  ingestTrace(rows: Bundle[]): Promise<boolean> {
    return this.open(traceBatch(rows)!.scope).ingestTrace(rows)
  }
  admitTrace(scope: string, rows: Bundle[]) {
    return this.open(platform).admitTrace(scope, rows)
  }
  reset() {
    this.written = 0
    this.setupWritten = 0
  }
  reopen() {
    this.object = undefined
  }
  async report() {
    let written = this.written, setupWritten = this.setupWritten
    if (!this.object?.tracker) {
      return { written, setupWritten, traces: 0, spans: 0 }
    }
    let traces = (await this.object!.tracker!.graph.read('.trace')).length
    let spans = (await this.object!.tracker!.graph.read('.span')).length
    return { written, setupWritten, traces, spans }
  }
}
type FreshNamespace = { getByName: (name: string) => TrackerTraceFresh }
let firstTrace = async (env: { FRESH: FreshNamespace }, own: boolean) => {
  let scope = crypto.randomUUID(),
    authority = env.FRESH.getByName(crypto.randomUUID())
  let body = tinyTrace(Math.random()).map((r) => ({
    ...r,
    during: { ...(r.during as object), space: own ? platform : scope },
  }))
  let target = own ? authority : env.FRESH.getByName(scope)
  // Miniflare writes its private name table on the first RPC. Establish only
  // that harness bookkeeping, not a tracker, before measuring product work.
  await authority.reset()
  if (!own) await target.reset()
  await authority.admitTrace(own ? platform : scope, body.slice(1))
  let invalidFreshWritten = (await authority.report()).written +
    (own ? 0 : (await target.report()).written)
  let admitted = await authority.admitTrace(own ? platform : scope, body)
  if (!admitted.accepted) return { admitted }
  let a = await authority.report(), t = own ? a : await target.report()
  let written = own ? a.written : a.written + t.written
  // Setup includes the durable pending reservation made before installation;
  // subtract it so the setup measurement is distinct from trace metadata.
  let setupWritten = (own ? a.setupWritten : a.setupWritten + t.setupWritten) -
    1
  await authority.reset()
  if (!own) await target.reset()
  await authority.admitTrace(own ? platform : scope, body.slice(1))
  let rejectedWritten = (await authority.report()).written +
    (own ? 0 : (await target.report()).written)
  await authority.reset()
  if (!own) await target.reset()
  let duplicate = await authority.admitTrace(own ? platform : scope, body)
  let duplicateWritten = (await authority.report()).written +
    (own ? 0 : (await target.report()).written)
  await authority.reopen()
  if (!own) await target.reopen()
  await authority.reset()
  if (!own) await target.reset()
  let next = tinyTrace(Math.random()).map((r) => ({
    ...r,
    during: { ...(r.during as object), space: own ? platform : scope },
  }))
  let reopened = await authority.admitTrace(own ? platform : scope, next)
  let reopenedWritten = (await authority.report()).written +
    (own ? 0 : (await target.report()).written)
  return {
    admitted,
    invalidFreshWritten,
    authoritySetupWritten: a.setupWritten - 1,
    targetSetupWritten: own ? 0 : t.setupWritten,
    ...t,
    written,
    setupWritten,
    rejectedWritten,
    duplicate,
    duplicateWritten,
    reopened,
    reopenedWritten,
  }
}
export default {
  async fetch(
    req: Request,
    env: { TRACKER_BOUND: Namespace; FRESH: FreshNamespace },
  ): Promise<Response> {
    if (new URL(req.url).searchParams.has('fresh')) {
      return Response.json({
        space: await firstTrace(env, false),
        platform: await firstTrace(env, true),
      })
    }
    return env.TRACKER_BOUND.get(
      env.TRACKER_BOUND.idFromName(crypto.randomUUID()),
    ).fetch(req)
  },
}
