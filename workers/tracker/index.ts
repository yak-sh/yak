// Runtime entrypoints are the only Cloudflare inheritance in this Worker.
// The graph, queue consumer and authenticated doors also run in RAM fixtures.
import { DurableObject, env, waitUntil } from 'cloudflare:workers'
import { faults } from '@yaks/api'
import { type State, Tracker as ObjectStore } from './object.ts'
import { type Env, reporting, type Stub, worker } from './worker.ts'
import { sign } from './auth.ts'
import { system } from '@yaks/fp'
import type { Bundle } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import type { Message } from './queue.ts'
import type { Explanation } from '@yaks/tracker/resolution'

// What @yaks/api catches and answers here, or meets with nobody to answer (a
// socket's message, a subscription's refresh), is reported to this Worker's
// own queue, named by where it was caught, before the invocation ends.
faults((error, where) => waitUntil(reporting(env as Env)(error, where)))

// Every method a caller reaches through the TRACKERS binding (`Stub`) is
// forwarded here, or the runtime answers that it "does not implement" it.
export class Tracker extends DurableObject<Env> implements Stub {
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
  settle(eids: string[], reason?: string, said?: Explanation) {
    return this.tracker.settle(eids, reason, said)
  }
  enroll(scope: string) {
    return this.tracker.enroll(scope)
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
  archive(ticket: string, bug: string, reason: string) {
    return this.tracker.archive(ticket, bug, reason)
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
// What an invocation does behind its answer runs on the runtime's waitUntil.
let entry = (env: Env) => worker(env, sign, system, waitUntil)
export default {
  fetch: (request: Request, env: Env) => entry(env).fetch(request),
  queue: (batch: { messages: Message[] }, env: Env) =>
    entry(env).queue(batch.messages),
  scheduled: (_event: unknown, env: Env) => entry(env).scheduled(),
}
