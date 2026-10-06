// Own workerd object storage for tracker budget regression; no live traffic.
import { trackerBound } from './tracker_trace_bound_fixture.ts'
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
export default {
  fetch(req: Request, env: { TRACKER_BOUND: Namespace }): Promise<Response> {
    return env.TRACKER_BOUND.get(
      env.TRACKER_BOUND.idFromName(crypto.randomUUID()),
    ).fetch(req)
  },
}
