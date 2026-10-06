// Isolated workerd storage for T-66115; no account, queue or live app.
import { traceCost, type TraceStorage } from './store_trace_fixture.ts'
import type { Namespace } from './door.ts'

export class StoreTrace {
  constructor(private ctx: { storage: TraceStorage }) {}
  alarm(): void {}
  async fetch(): Promise<Response> {
    try {
      return Response.json(await traceCost(this.ctx.storage))
    } catch (error) {
      return Response.json({
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, { status: 500 })
    }
  }
}
export default {
  fetch(req: Request, env: { TRACE: Namespace }): Promise<Response> {
    return env.TRACE.get(env.TRACE.idFromName(crypto.randomUUID())).fetch(req)
  },
}
