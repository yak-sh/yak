// One Durable Object is one tracker graph. Boot is retried on each wake; a
// failed installation never leaves a permanently rejected constructor promise.

import {
  driver,
  type DurableStorage,
  type Hibernation,
  moved,
  replaced,
  reserved,
  type Sockets,
  sockets,
  storage,
  type Wire,
} from '@yaks/durable-object'
import { subscriptions } from '@yaks/api'
import { caught, origin, queue, type Sink } from '@yaks/tracker/report'
import {
  type Config,
  options,
  platform,
  store,
  type TrackerStore,
  vocab,
} from './core.ts'
import { batch } from './queue.ts'
import { door, json } from './door.ts'
import { authorize } from './auth.ts'
import { monitor } from './monitor.ts'
import { activate } from './mail.ts'
import type { Bundle } from '@yaks/graph'
import { sha256 } from '@yaks/graph/sha256'
import type { Explanation } from '@yaks/tracker/resolution'
import {
  FIT,
  follow,
  forget,
  meta,
  printed,
  printFor,
  printOf,
  schema,
} from '@yaks/sqlite'
import { col, type Driver, eq, render, select, table, val } from '@yaks/sql'
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
  BUNDLE_HASH?: string
  CF_VERSION_METADATA?: { id: string }
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
let ddl = schema(vocab, options.derived)
// The tracker follows its vocabulary through its print, as the box and every
// yaks.app store do (@yaks/sqlite `follow`): its storage's own, with nothing
// beside it. The stamp and `trace-ready` are the markers the release before
// prints reads, which a rollback can still run.
let PRINT = printOf(printFor(vocab, options.derived), [])
let SCHEMA_READY = sha256([FIT, ...ddl.map((s) => render(s).sql)].join('\n'))
// Reserve both installations on every capture, including warm/redeliveries.
// Only empty storage may be installed by tracing; standing data never gets
// schema fitting, archetype backfill or mail writes under this fixed bound.
export let TRACE_SETUP_BOUND = 256
export let TRACE_ADMISSION_SETUP = 2 * TRACE_SETUP_BOUND
let metaDdl = ddl.find((stmt) =>
  stmt.t == 'create table' && stmt.name == 'server_meta'
)!

export class Tracker {
  tracker?: TrackerStore
  live?: Sockets
  scope: string
  sink: Sink
  #config: Config
  #traceTail = Promise.resolve()
  #traceDropped = 0
  // One driver over this instance's storage: making one runs its pragma, so
  // a boot or a trace admission made three or four for nothing.
  #driver?: Driver
  #sql = () => this.#driver ??= driver(this.ctx.storage)
  #traceMeta = () => meta(this.#sql())
  constructor(
    public ctx: State,
    public env: Settings = {},
    private now: () => number = Date.now,
  ) {
    this.scope = ctx.id.name ?? platform
    this.sink = env.ERRORS
      ? queue(env.ERRORS)
      : (rows) => console.error(JSON.stringify(rows))
    this.#config = {
      sink: this.sink,
      report: (error) => this.#report(error, 'Tracker.effect'),
      store: this.scope,
      // The box's tracker web reads platform bugs through. The box tracker
      // writes the letters for the box's own bugs, and a space's tracker for
      // its apps' failures the platform also records (`source: app`).
      url: 'https://tracker.yak.sh',
      repo: 'https://github.com/yak-sh/yak',
      side: 'yaks.app',
      forwarded: ['box', 'app'],
      ...env.MAIL
        ? {
          sender: {
            send: async (m) => {
              let sent = await env.MAIL!.send(m)
              return { id: sent.messageId }
            },
          },
        }
        : {},
    }
  }
  #mailReady = false
  #traceStorage = () => {
    let sql = this.#sql(), kept = meta(sql)
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
    let sql = this.#sql()
    let saved = install
      ? storage(this.ctx.storage, vocab, {
        ...options,
        schemaReady: () => printed(sql, PRINT),
      })
      : this.#traceStorage()
    if (install) {
      // Until the release before prints can no longer run, its stamp decides
      // when the pass runs, since it installs over whatever a print stands
      // for; a print the tracker lacks at this stamp is recorded with no pass.
      let held = await this.ctx.storage.get<string>('schema')
      if (held && held != SCHEMA_READY) forget(sql, PRINT)
      let ran = false
      follow(sql, PRINT, () => {
        if (held == SCHEMA_READY) return
        // What the install leaves undone (a unique index the rows break) is
        // reported; the tracker serves the shape it holds, and the next boot
        // tries again.
        let left = saved.install()
        this.#traceMeta().set('trace-ready', TRACE_READY)
        for (let e of left) void this.#report(e, 'Tracker.schema')
        if (left.length) return false
        ran = true
      })
      if (ran) await this.ctx.storage.put('schema', SCHEMA_READY)
    }
    let tracker = store(saved, this.#config)
    this.live = sockets(subscriptions(tracker.graph), this.ctx)
    this.tracker = tracker
    if (install) await this.#mail()
    return tracker
  }
  #mail = async () => {
    if (this.#mailReady) return
    let config = await activate(
      this.tracker!.graph,
      this.env,
      this.#traceMeta,
      this.now,
    )
    Object.assign(this.#config, config)
    this.#mailReady = true
  }
  #origin = (entrypoint: string, request?: Request) =>
    origin(
      'yak-tracker',
      this.env.CF_VERSION_METADATA?.id,
      entrypoint,
      request,
    )
  // What an instance the runtime moved meets is its replacement's to redo
  // (@yaks/durable-object `replaced`).
  #report = (error: unknown, entrypoint: string, request?: Request) =>
    moved(error) && replaced(this.ctx.storage)
      ? Promise.resolve()
      : caught(error, { sink: this.sink, ...this.#origin(entrypoint, request) })
  recover = async (error: unknown, entrypoint: string, request?: Request) => {
    console.error(entrypoint, error)
    await this.#report(error, entrypoint, request)
    try {
      await this.ctx.storage.setAlarm(this.now() + 1000)
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
      await this.#arm()
    } catch (error) {
      await this.recover(error, 'Tracker.ingest')
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
          let sql = this.#sql()
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
      let access = await authorize(
        request,
        this.env.TRACKER_SECRET,
        this.scope,
      )
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
      // The bundle this object runs, which a deploy waits on: objects move to
      // a new version eventually, minutes after the Worker in front of them.
      if (new URL(request.url).pathname == '/bundle') {
        if (this.scope != platform || !access.admin) {
          return json({ error: 'platform only' }, 403)
        }
        return json({
          hash: this.env.BUNDLE_HASH ?? null,
          version: this.env.CF_VERSION_METADATA?.id ?? null,
        })
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
        this.ingest,
      )(request)
    } catch (error) {
      await this.recover(error, 'Tracker.fetch', request)
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
  resolve = (ticket: string, bug: string, said: Explanation) =>
    this.rpc(ticket, '/resolve', { bug, ...said })
  archive = (ticket: string, bug: string) =>
    this.rpc(ticket, '/archive', { bug })
  deployed = (ticket: string, app: string, version?: number) =>
    this.rpc(ticket, '/deployed', { app, version })
  unseen = (ticket: string, app: string) =>
    this.rpc(ticket, `/unseen?app=${encodeURIComponent(app)}`)
  monitor = async () => {
    try {
      let tracker = await this.boot()
      await monitor(
        tracker,
        await this.ctx.storage.get<number>('heartbeat'),
        undefined,
        this.now(),
        this.#origin('Tracker.monitor'),
      )
      await this.#arm()
    } catch (error) {
      await this.recover(error, 'Tracker.monitor')
    }
  }
  alarm = async () => {
    try {
      let tracker = await this.boot()
      await this.live?.wake()
      await tracker.drain(this.now())
      await this.#arm()
    } catch (error) {
      await this.recover(error, 'Tracker.alarm')
    }
  }
  // Sleep until durable work is due. A healthy monitor and an empty alarm owe
  // no storage writes; future wakes and retry backoff do not poll each second.
  #arm = async () => {
    let next = await this.tracker!.next(this.now())
    if (next != null) await this.ctx.storage.setAlarm(next)
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
      await this.recover(error, 'Tracker.webSocketMessage')
    }
  }
  webSocketClose = (ws: Wire) => this.live?.close(ws)
}
