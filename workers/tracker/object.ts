// One Durable Object is one tracker graph. Boot is retried on each wake; a
// failed installation never leaves a permanently rejected constructor promise.

import {
  driver,
  type DurableStorage,
  type Hibernation,
  reserved,
  type Sockets,
  sockets,
  storage,
  type Wire,
} from '@yaks/durable-object'
import { subscriptions } from '@yaks/api'
import { caught, queue, type Sink } from '@yaks/tracker/report'
import { options, platform, store, type TrackerStore, vocab } from './core.ts'
import { batch } from './queue.ts'
import { door, json } from './door.ts'
import { authorize } from './auth.ts'
import { monitor } from './monitor.ts'
import type { Bundle } from '@yaks/graph'
import { meta, schema } from '@yaks/sqlite'
import { col, eq, select, table, val } from '@yaks/sql'
import {
  reserveTrace,
  TRACE_CEILING,
  traceBatch,
  type TraceBudget,
  traceBudget,
} from '@yaks/tracker/intake'

export type State = Hibernation & {
  id: { name?: string }
  storage: DurableStorage & {
    setAlarm: (at: number) => Promise<void>
    get: <T>(key: string) => Promise<T | undefined>
    put: (key: string, value: unknown) => Promise<void>
  }
}
export type TraceAdmission = {
  accepted: boolean
  dropped: number
  reserved: number
  reason?: string
}
export type Settings = {
  TRACKERS?: {
    getByName: (
      scope: string,
    ) => { ingestTrace: (rows: Bundle[]) => Promise<boolean> }
  }
  TRACKER_SECRET?: string
  ERRORS?: { send: (rows: Bundle[]) => Promise<void> }
  MAIL?: {
    send: (
      letter: {
        from: string
        to: string
        subject: string
        text: string
        html: string
      },
    ) => Promise<{ messageId?: string }>
  }
  MAIL_FROM?: string
  MAIL_TO?: string
}
let TRACE_READY = 'trace-ceiling-v1'
// Reserve both installations on every capture, including warm/redeliveries.
// Only empty storage may be installed by tracing; standing data never gets
// schema fitting, archetype backfill or mail writes under this fixed bound.
export let TRACE_SETUP_BOUND = 256
export let TRACE_ADMISSION_SETUP = 2 * TRACE_SETUP_BOUND
let metaDdl = schema(vocab, options.derived).find((stmt) =>
  stmt.t == 'create table' && stmt.name == 'server_meta'
)!

export class Tracker {
  tracker?: TrackerStore
  live?: Sockets
  scope: string
  sink: Sink
  #traceTail = Promise.resolve()
  #traceDropped = 0
  #traceMeta = () => meta(driver(this.ctx.storage))
  constructor(
    public ctx: State,
    public env: Settings = {},
    private now: () => number = Date.now,
  ) {
    this.scope = ctx.id.name ?? platform
    this.sink = env.ERRORS
      ? queue(env.ERRORS)
      : (rows) => console.error(JSON.stringify(rows))
  }
  #mailReady = false
  #traceStorage = () => {
    let sql = driver(this.ctx.storage), kept = meta(sql)
    let tables = sql.query(select({
      cols: [col('name')],
      from: table('sqlite_schema'),
      where: eq(col('type'), val('table')),
    })).map((row) => String(row.name))
      .filter((name) => !reserved(name) && name != '__miniflare_do_name')
    let marked = tables.includes('server_meta') &&
      kept.get('trace-ready') == TRACE_READY
    if (!marked && tables.some((name) => name != 'server_meta')) {
      throw Error('tracker trace schema requires ordinary installation')
    }
    let saved = storage(this.ctx.storage, vocab, {
      ...options,
      schemaReady: () => true,
    })
    if (!marked) {
      this.ctx.storage.transactionSync(() => {
        saved.install()
        kept.set('trace-ready', TRACE_READY)
      })
    }
    return saved
  }
  boot = async (install = true) => {
    if (this.tracker) {
      if (install) await this.#mail()
      return this.tracker
    }
    let saved = install
      ? storage(this.ctx.storage, vocab, options)
      : this.#traceStorage()
    if (install) {
      saved.install()
      this.#traceMeta().set('trace-ready', TRACE_READY)
    }
    let tracker = store(saved, {
      sink: this.sink,
      store: this.scope,
      ...this.scope == platform && this.env.MAIL_TO
        ? {
          to: platform,
          from: this.env.MAIL_FROM,
        }
        : {},
      ...this.env.MAIL
        ? {
          sender: {
            send: async (m) => {
              let sent = await this.env.MAIL!.send(m)
              return { id: sent.messageId }
            },
          },
        }
        : {},
    })
    this.live = sockets(subscriptions(tracker.graph), this.ctx)
    this.tracker = tracker
    if (install) await this.#mail()
    return tracker
  }
  #mail = async () => {
    if (this.#mailReady) return
    if (this.scope == platform && this.env.MAIL_TO) {
      await this.tracker!.graph.apply([{
        entity: { eid: platform },
        email: { address: this.env.MAIL_TO },
      }], { trusted: true })
    }
    this.#mailReady = true
  }
  recover = async (error: unknown) => {
    await caught(error, { sink: this.sink })
    try {
      await this.ctx.storage.setAlarm(Date.now() + 1000)
    } catch { /* next queue delivery retries */ }
  }
  ingest = async (rows: Bundle[]): Promise<void> => {
    if (rows.some((row) => row.trace || row.span)) {
      throw Error('trace intake requires platform admission')
    }
    if (batch(rows).scope != this.scope) {
      throw Error('tracker intake scope mismatch')
    }
    try {
      let tracker = await this.boot()
      await this.live?.wake()
      await tracker.ingest(rows)
      await this.ctx.storage.setAlarm(Date.now() + 1000)
    } catch (error) {
      await this.recover(error)
      throw error
    }
  }
  // This RPC is reached only by the queue's platform authority, never HTTP.
  // Empty storage is installed inside the reserved setup bound; marked storage
  // reopens without installation writes. Notification setup is ordinary work.
  ingestTrace = async (rows: Bundle[]): Promise<boolean> => {
    let capture = traceBatch(rows)
    if (!capture || capture.scope != this.scope) return false
    let tracker: TrackerStore
    try {
      tracker = await this.boot(false)
    } catch {
      return false
    }
    await tracker.ingest(rows)
    return true
  }
  traceBudget = () => {
    let budget: TraceBudget | undefined
    try {
      budget = traceBudget(this.#traceMeta().get('trace-budget'))
      if (!budget) throw Error('invalid trace reservations')
    } catch {
      return {
        ceiling: TRACE_CEILING,
        reserved: TRACE_CEILING,
        pending: true,
        dropped: this.#traceDropped,
        initialized: false,
      }
    }
    let slots = budget!.slots.filter((slot) =>
      slot.until == null || slot.until > this.now()
    )
    return {
      ceiling: TRACE_CEILING,
      reserved: slots.reduce((n, slot) => n + slot.reserved, 0),
      pending: slots.some((slot) => slot.until == null),
      dropped: this.#traceDropped,
      initialized: true,
    }
  }
  admitTrace = (scope: string, rows: Bundle[]): Promise<TraceAdmission> => {
    let work = async (): Promise<TraceAdmission> => {
      let drop = (reason: string): TraceAdmission => {
        this.#traceDropped++
        return {
          accepted: false,
          dropped: this.#traceDropped,
          reserved: this.traceBudget().reserved,
          reason,
        }
      }
      if (this.scope != platform) return drop('platform authority required')
      let capture = traceBatch(rows)
      if (!capture || capture.scope != scope) {
        return drop('incomplete or oversized trace')
      }
      let kept = this.#traceMeta(), next: TraceBudget | undefined
      try {
        // Bootstrap only the authority's metadata table and pending charge
        // atomically. Schema setup follows that durable reservation: even a
        // failed installation may have billed writes and cannot refund it.
        this.ctx.storage.transactionSync(() => {
          let sql = driver(this.ctx.storage)
          let exists = sql.query(select({
            cols: [col('name')],
            from: table('sqlite_schema'),
            where: eq(col('name'), val('server_meta')),
          })).length
          if (!exists) sql.query(metaDdl)
          let held = traceBudget(kept.get('trace-budget'))
          if (!held) throw Error('invalid trace reservations')
          next = reserveTrace(
            held,
            this.now(),
            capture.cost + TRACE_ADMISSION_SETUP,
          )
          if (next) kept.set('trace-budget', JSON.stringify(next))
        })
      } catch {
        return drop('trace reservation unavailable')
      }
      if (!next) return drop('trace ceiling')
      try {
        if (!this.tracker) this.#traceStorage()
      } catch {
        return drop('trace setup unavailable')
      }
      let accepted = false
      try {
        accepted = scope == platform
          ? await this.ingestTrace(rows)
          : await this.env.TRACKERS!.getByName(scope).ingestTrace(rows)
      } catch {
        return drop('trace delivery failed')
      }
      if (!accepted) return drop('trace target unavailable')
      next.slots[next.slots.length - 1].until = this.now() + 3_600_000
      try {
        kept.set('trace-budget', JSON.stringify(next))
      } catch {
        return drop('trace completion unavailable')
      }
      return {
        accepted: true,
        dropped: this.#traceDropped,
        reserved: this.traceBudget().reserved,
      }
    }
    let ran = this.#traceTail.then(work)
    this.#traceTail = ran.then(() => {}, () => {})
    return ran
  }
  fetch = async (request: Request): Promise<Response> => {
    try {
      let access = await authorize(request, this.env.TRACKER_SECRET, this.scope)
      if (!access) return json({ error: 'tracker scope denied' }, 403)
      if (
        new URL(request.url).pathname == '/heartbeat' &&
        request.method == 'POST'
      ) {
        if (this.scope != platform || !access.admin) {
          return json({ error: 'platform only' }, 403)
        }
        await this.ctx.storage.put('heartbeat', Date.now())
        return json({ ok: true })
      }
      if (new URL(request.url).pathname == '/trace-budget') {
        if (this.scope != platform || !access.admin) {
          return json({ error: 'platform only' }, 403)
        }
        return json(this.traceBudget())
      }
      let tracker = await this.boot()
      await this.live?.wake()
      return await door(
        tracker,
        this.scope,
        this.env.TRACKER_SECRET,
        (request) => this.live!.accept(request),
      )(request)
    } catch (error) {
      await this.recover(error)
      return json({ error: 'tracker temporarily unavailable' }, 503)
    }
  }
  rpc = async (ticket: string, path: string, body?: unknown) => {
    let request = new Request(`https://tracker.internal${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${ticket}` },
      ...body ? { body: JSON.stringify(body) } : {},
    })
    let response = await this.fetch(request)
    if (!response.ok) throw Error(`tracker RPC refused: ${response.status}`)
    return await response.json()
  }
  bugs = (ticket: string, app: string) =>
    this.rpc(ticket, `/bugs?app=${encodeURIComponent(app)}`)
  resolve = (ticket: string, bug: string) =>
    this.rpc(ticket, '/resolve', { bug })
  archive = (ticket: string, bug: string) =>
    this.rpc(ticket, '/archive', { bug })
  deployed = (ticket: string, app: string, version?: number) =>
    this.rpc(ticket, '/deployed', { app, version })
  unseen = (ticket: string, app: string) =>
    this.rpc(ticket, `/unseen?app=${encodeURIComponent(app)}`)
  monitor = async () => {
    try {
      let tracker = await this.boot()
      await monitor(tracker, await this.ctx.storage.get<number>('heartbeat'))
      await this.ctx.storage.setAlarm(Date.now() + 1000)
    } catch (error) {
      await this.recover(error)
    }
  }
  alarm = async () => {
    try {
      let tracker = await this.boot()
      await this.live?.wake()
      await tracker.drain()
      // Wakes and retryable effects must progress even without new reports.
      let pending = await tracker.graph.read('.effect.state=pending .limit=1')
      let wakes = await tracker.graph.read(
        '.wake.at>=1970-01-01T00:00:00Z .limit=1',
      )
      if (pending.length || wakes.length) {
        await this.ctx.storage.setAlarm(Date.now() + 1000)
      }
    } catch (error) {
      await this.recover(error)
    }
  }
  webSocketMessage = async (ws: Wire, data: string | ArrayBuffer) => {
    try {
      await this.boot()
      let frame = JSON.parse(
        typeof data == 'string' ? data : new TextDecoder().decode(data),
      )
      // The box subscribes here; arbitrary graph writes are not a tracker RPC.
      if (
        !frame || typeof frame != 'object' ||
        Object.keys(frame).some((key) =>
          !['subscribe', 'unsubscribe', 'ack', 'id'].includes(key)
        )
      ) {
        ws.send(
          JSON.stringify({
            id: frame.id,
            error: 'tracker sockets are read only',
          }),
        )
        return
      }
      await this.live?.message(ws, data)
    } catch (error) {
      await this.recover(error)
    }
  }
  webSocketClose = (ws: Wire) => this.live?.close(ws)
}
