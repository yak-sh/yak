// Own workerd object storage for source quota regression; no live traffic.
import { traceSourceBound } from './store_trace_bound_fixture.ts'
import type { TraceStorage } from './store_trace_fixture.ts'
import type { Namespace } from './door.ts'

export class StoreTraceBound {
  constructor(private ctx: { storage: TraceStorage }) {}
  alarm(): void {}
  async fetch(): Promise<Response> {
    try {
      return Response.json(await traceSourceBound(this.ctx.storage))
    } catch (error) {
      return Response.json({
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, { status: 500 })
    }
  }
}
export default {
  fetch(req: Request, env: { BOUND: Namespace }): Promise<Response> {
    return env.BOUND.get(env.BOUND.idFromName(crypto.randomUUID())).fetch(req)
  },
}
