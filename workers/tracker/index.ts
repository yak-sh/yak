// Runtime entrypoints are the only Cloudflare inheritance in this Worker.
// The graph, queue consumer and authenticated doors also run in RAM fixtures.
import { DurableObject, env, waitUntil } from 'cloudflare:workers'
import { faults } from '@yaks/api'
import { type State, Tracker as ObjectStore } from './object.ts'
import { type Env, reporting, worker } from './worker.ts'
import type { Bundle } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import type { Message } from './queue.ts'
import type { Explanation } from '@yaks/tracker/resolution'

// What @yaks/api catches and answers here, or meets with nobody to answer (a
// socket's message, a subscription's refresh), is reported to this Worker's
// own queue, named by where it was caught, before the invocation ends.
faults((error, where) => waitUntil(reporting(env as Env)(error, where)))

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
  resolve(ticket: string, bug: string, said: Explanation) {
    return this.tracker.resolve(ticket, bug, said)
  }
  archive(ticket: string, bug: string) {
    return this.tracker.archive(ticket, bug)
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
