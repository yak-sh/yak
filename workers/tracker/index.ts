// Runtime entrypoints are the only Cloudflare inheritance in this Worker.
// The graph, queue consumer and authenticated doors also run in RAM fixtures.
import { DurableObject } from 'cloudflare:workers'
import { Tracker as ObjectStore } from './object.ts'
import { worker, type Env } from './worker.ts'
import type { Bundle } from '@yaks/graph'

export class Tracker extends DurableObject<Env> {
  tracker: ObjectStore
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.tracker = new ObjectStore(ctx, env)
  }
  fetch(request: Request) { return this.tracker.fetch(request) }
  ingest(rows: Bundle[]) { return this.tracker.ingest(rows) }
  monitor() { return this.tracker.monitor() }
  alarm() { return this.tracker.alarm() }
  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    return this.tracker.webSocketMessage(ws, data)
  }
  webSocketClose(ws: WebSocket) { return this.tracker.webSocketClose(ws) }
}
export default {
  fetch: (request: Request, env: Env) => worker(env).fetch(request),
  queue: (batch: MessageBatch, env: Env) => worker(env).queue(batch.messages),
  scheduled: (_event: ScheduledEvent, env: Env) => worker(env).scheduled(),
}
