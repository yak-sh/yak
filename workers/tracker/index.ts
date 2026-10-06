// Runtime entrypoints are the only Cloudflare inheritance in this Worker.
// The graph, queue consumer and authenticated doors also run in RAM fixtures.
import { DurableObject } from 'cloudflare:workers'
import { type State, Tracker as ObjectStore } from './object.ts'
import { type Env, worker } from './worker.ts'
import type { Bundle } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import type { Message } from './queue.ts'

export class Tracker extends DurableObject<Env> {
  tracker: ObjectStore
  constructor(ctx: State, env: Env) {
    super(ctx, env)
    this.tracker = new ObjectStore(ctx, env)
  }
  fetch(request: Request) {
    return this.tracker.fetch(request)
  }
  ingest(rows: Bundle[]) {
    return this.tracker.ingest(rows)
  }
  ingestTrace(rows: Bundle[]) {
    return this.tracker.ingestTrace(rows)
  }
  admitTrace(scope: string, rows: Bundle[]) {
    return this.tracker.admitTrace(scope, rows)
  }
  bugs(ticket: string, app: string) {
    return this.tracker.bugs(ticket, app)
  }
  resolve(ticket: string, bug: string) {
    return this.tracker.resolve(ticket, bug)
  }
  archive(ticket: string, bug: string) {
    return this.tracker.archive(ticket, bug)
  }
  deployed(ticket: string, app: string, version?: number) {
    return this.tracker.deployed(ticket, app, version)
  }
  unseen(ticket: string, app: string) {
    return this.tracker.unseen(ticket, app)
  }
  monitor() {
    return this.tracker.monitor()
  }
  alarm() {
    return this.tracker.alarm()
  }
  webSocketMessage(ws: Wire, data: string | ArrayBuffer) {
    return this.tracker.webSocketMessage(ws, data)
  }
  webSocketClose(ws: Wire) {
    return this.tracker.webSocketClose(ws)
  }
}
export default {
  fetch: (request: Request, env: Env) => worker(env).fetch(request),
  queue: (batch: { messages: Message[] }, env: Env) =>
    worker(env).queue(batch.messages),
  scheduled: (_event: unknown, env: Env) => worker(env).scheduled(),
}
