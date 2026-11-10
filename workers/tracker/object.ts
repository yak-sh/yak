// One Durable Object is one tracker graph. Boot is retried on each wake; a
// failed installation never leaves a permanently rejected constructor promise.

import {
  bounded,
  type Ceiling,
  driver,
  type DurableStorage,
  type Hibernation,
  moved,
  replaced,
  reserved,
  type Sockets,
  sockets,
  stopped,
  storage,
  type Window,
  type Wire,
} from '@yaks/durable-object'
import { refuse, subscriptions } from '@yaks/api'
import { caught, origin, queue, report, type Sink } from '@yaks/tracker/report'
import {
  type Config,
  options,
  platform,
  store,
  type TrackerStore,
  vocab,
} from './core.ts'
import { batch } from './queue.ts'
import { billing } from './bill.ts'
import { door, json } from './door.ts'
import { authorize } from './auth.ts'
import { monitor } from './monitor.ts'
import { activate, type Mailbox, sender } from './mail.ts'
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
    getAlarm: () => Promise<number | null>
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
    ) => {
      ingestTrace: (rows: Bundle[]) => Promise<boolean>
      settle: (
        eids: string[],
        reason?: string,
        said?: Explanation,
      ) => Promise<number>
    }
  }
  TRACKER_SECRET?: string
  ERRORS?: {
    send: (rows: Bundle[], options?: { delaySeconds?: number }) => Promise<void>
  }
} & Mailbox

let TRACE_READY = 'trace-archetypes-v2'
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

// The platform's call archiving a space's reports (`bug_settle`). During a
// deploy the space's object can still run the release before `settle`, and the
// runtime answers that it "does not implement the method": the call asks to be
// tried again once the object restarts on this release (@yaks/effects `retry`),
// and only a receiver still without it after every try is reported.
export let settling =
  (trackers: NonNullable<Settings['TRACKERS']>) =>
  async (scope: string, eids: string[], reason: string, said?: Explanation) => {
    try {
      return await trackers.getByName(scope).settle(eids, reason, said)
    } catch (error) {
      if (!/does not implement the method/.test(String(error))) throw error
      throw Object.assign(Error(String(error), { cause: error }), {
        retry: { after: BEHIND },
      })
    }
  }
let BEHIND = 60_000

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
  // What each entry point's SQL read and wrote, said in the Worker's logs
  // when a costly one ends (./bill.ts).
  #rows = billing((bill) =>
    console.log('tracker rows', JSON.stringify({ scope: this.scope, ...bill }))
  )
  #run = <T>(kind: string, work: () => Promise<T>): Promise<T> =>
    this.#rows.run(kind, work)
  #sql = () => this.#driver ??= driver(this.ctx.storage, this.#rows.observe)
  #traceMeta = () => meta(this.#sql())
  #ceiling: Ceiling
  constructor(
    public ctx: State,
    public env: Settings = {},
    private now: () => number = Date.now,
    windows?: Window[],
  ) {
    this.scope = ctx.id.name ?? platform
    this.sink = env.ERRORS
      ? queue(env.ERRORS)
      : (rows) => console.error(JSON.stringify(rows))
    // A statement of this tracker's that scans, and the tracker past the rows
    // it may read or write, told where the statement ran: a scan is one bug
    // for its statement, a runaway one for its scope. Past a window it takes
    // no statement until the window ends: a door answers how long to wait,
    // intake is delivered again then (./queue.ts), and the alarm comes back
    // then for the work it owes.
    this.#ceiling = bounded(ctx.storage, {
      now: this.now,
      windows,
      refuse: true,
      report: (error, { fault, tags }) => {
        let from = this.#origin('Tracker.sql')
        void report(error, {
          ...from,
          sink: this.sink,
          fault: fault.startsWith('scan|') ? fault : `${fault}|${this.scope}`,
          tags: { ...from.tags, ...tags, scope: this.scope },
        })
      },
    })
    this.#config = {
      sink: this.sink,
      report: (error) => this.#report(error, 'Tracker.effect'),
      // How a run ended is written while this object is stopped too, so a
      // run that finished never runs again.
      free: (write) => this.#ceiling.free(write),
      store: this.scope,
      // The box's tracker web reads platform bugs through. The box tracker
      // writes the letters for the box's own bugs, and a space's tracker for
      // its apps' failures the platform also records (`source: app`).
      url: 'https://tracker.yak.sh',
      repo: 'https://github.com/yak-sh/yak',
      side: 'yaks.app',
      forwarded: ['box', 'app'],
      // The object hibernates ten seconds after its last request, so the
      // bugs' tag is kept in its storage, not its memory.
      kept: {
        get: (k) => this.#traceMeta().get(k),
        set: (k, v) => this.#traceMeta().set(k, v),
      },
      sender: sender(env, this.scope),
      // The platform resolves the bugs of breaks in people's apps; each
      // space's tracker archives its own record of them.
      ...this.scope == platform && env.TRACKERS
        ? { settle: settling(env.TRACKERS) }
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
      report: this.#stored,
      schemaReady: () => true,
    }, this.#rows.observe)
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
        report: this.#stored,
        schemaReady: () => printed(sql, PRINT),
      }, this.#rows.observe)
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
  // What the store outlives and repairs (@yaks/sqlite `report`).
  #stored = (error: Error) => void this.#report(error, 'Tracker.store')
  recover = async (error: unknown, entrypoint: string, request?: Request) => {
    console.error(entrypoint, error)
    await this.#report(error, entrypoint, request)
    await this.#soon()
  }
  // A second from now, or once a stopped tracker's window ends.
  #soon = async () => {
    try {
      await this.ctx.storage.setAlarm(
        this.now() + Math.max(1000, this.#ceiling.stopped(true)),
      )
    } catch { /* next queue delivery retries */ }
  }
  ingest = (rows: Bundle[]): Promise<void> =>
    this.#run('ingest', () => this.#ingest(rows))
  #ingest = async (rows: Bundle[]): Promise<void> => {
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
      // The caller hears this failure and reports it: the queue's consumer
      // once a batch, the door for its request. Reported here as well, every
      // failed intake sent a second report back through intake.
      console.error('Tracker.ingest', error)
      await this.#soon()
      throw error
    }
  }
  #scopes = async () => await this.ctx.storage.get<string[]>('scopes') ?? []
  // Reached only by the Worker, never HTTP: a space tracker it routed to
  // joins the platform's list of them (`/scopes`), once.
  enroll = async (scope: string): Promise<void> => {
    if (this.scope != platform || scope == platform) return
    let scopes = await this.#scopes()
    if (!scopes.includes(scope)) {
      await this.ctx.storage.put('scopes', [...scopes, scope])
    }
  }
  // Reached only by the platform tracker's `bug_settle`, never HTTP.
  settle = (
    eids: string[],
    reason?: string,
    said?: Explanation,
  ): Promise<number> =>
    this.#run('settle', async () => {
      try {
        let tracker = await this.boot()
        await this.live?.wake()
        return await tracker.settle(eids, reason, said)
      } catch (error) {
        await this.recover(error, 'Tracker.settle')
        throw error
      }
    })
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
  fetch = (request: Request): Promise<Response> =>
    this.#run(
      `${request.method} ${new URL(request.url).pathname}`,
      () => this.#fetch(request),
    )
  #fetch = async (request: Request): Promise<Response> => {
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
      // The space trackers this one has routed to, which every bug door
      // reads beside it.
      if (new URL(request.url).pathname == '/scopes') {
        if (this.scope != platform || !access.admin) {
          return json({ error: 'platform only' }, 403)
        }
        return json({ scopes: await this.#scopes() })
      }
      if (new URL(request.url).pathname == '/trace-budget') {
        if (this.scope != platform || !access.admin) {
          return json({ error: 'platform only' }, 403)
        }
        return json(this.traceBudget())
      }
      let tracker = await this.boot()
      await this.live?.wake()
      let answer = await door(
        tracker,
        this.scope,
        this.env.TRACKER_SECRET,
        (request) => this.live!.accept(request),
        this.ingest,
      )(request)
      // A mark or a retry owes runs the pool works on its alarm, not a
      // minute later on the monitor's.
      if (request.method == 'POST' && answer.ok) await this.#arm()
      return answer
    } catch (error) {
      // A stopped tracker's answer says how long to wait.
      if (stopped(error)) return refuse(error)
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
  archive = (ticket: string, bug: string, reason: string) =>
    this.rpc(ticket, '/archive', { bug, reason })
  unseen = (ticket: string, app: string) =>
    this.rpc(ticket, `/unseen?app=${encodeURIComponent(app)}`)
  monitor = () => this.#run('monitor', this.#monitor)
  #monitor = async () => {
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
  alarm = () => this.#run('alarm', this.#alarm)
  #alarm = async () => {
    try {
      // A stopped tracker's alarm owes nothing until its window ends.
      if (this.#ceiling.stopped(true)) return await this.#soon()
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
    // Intake may owe the same work again. Keep its earlier return instead of
    // moving grouping a second away on every delivery. A second from now is
    // the soonest next() answers, so an alarm due by then has nothing to
    // bring forward and the read is spared: behind a backlog it is every
    // intake's, and it reads the backlog.
    let alarm = await this.ctx.storage.getAlarm()
    if (alarm != null && alarm <= this.now() + 1000) return
    let next = await this.tracker!.next(this.now())
    if (next == null) return
    if (alarm == null || next < alarm) await this.ctx.storage.setAlarm(next)
  }
  webSocketMessage = (ws: Wire, data: string | ArrayBuffer) =>
    this.#run('socket', () => this.#message(ws, data))
  #message = async (ws: Wire, data: string | ArrayBuffer) => {
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
