/**
 * A keyed write and its receipt: committed once, and every resend told what
 * the first send was told.
 *
 * - A host whose graph is its only storage keeps each receipt in the graph,
 *   as an `apply_receipt` committed in the mutation's transaction
 *   ({@link receipts}, {@link received}). The request token is an in-process
 *   capability, not client input.
 * - A host with SQLite beside its graph keeps them in its write log
 *   (`./log.ts`), with the input it could not commit yet: while its row
 *   ceiling stopped it, while it could not start, or while it failed. Its
 *   door ({@link door}) keeps that input and replays it in order once the
 *   object may write again, and {@link landing} completes each write in the
 *   transaction that commits it.
 *
 * @module
 */
import { decode, stringify } from '@yaks/vocab/wire'
import { after } from '@yaks/fp'
import {
  type Actor,
  type Bundle,
  type Graph,
  type Plugin,
  token,
} from '@yaks/graph'
import type { Driver } from '@yaks/sql'
import { composed } from '@yaks/graph/bundle'
import { derivedEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import { published } from './publish.ts'
import { json, refuse } from './refuse.ts'
import {
  aside,
  dead,
  done,
  durable,
  fingerprinted,
  first,
  fits,
  held,
  IDEMPOTENCY,
  keep,
  type Kept,
  landed,
  next,
  opened,
  parked,
  type Receipt,
  received as logged,
  remembered,
  replayed,
  said,
  type Sent,
  started,
  taken,
  unstarted,
  waiting,
} from './log.ts'

type Stored = { digest: string; answer: string }
type Asked = { eid: string; digest: string; empty: boolean }
let pending = new Map<string, Asked>()
let requestKey = '$apiReceipt'

class Replay extends Error {
  constructor(public answer: Bundle[]) {
    super('committed write replay')
    this.name = 'Refused'
  }
}

/** API-owned graph hooks, also loaded by the box's graph facet. */
export let receipts = (): Plugin => {
  let writes = new WeakMap<object, Asked>()
  return {
    name: '@yaks/api/receipts',
    requests: [requestKey],
    // Mandatory scope applies before predicates/aggregates and to subscriptions.
    // Transaction hooks use tx.get directly, not a caller-scoped graph read.
    scope: () => ({ entity: '!apply_receipt' }),
    authorize: (bundles, tx, _error, context) => {
      if (!context?.trusted && bundles.some((b) => 'apply_receipt' in b)) {
        throw new Refused('apply_receipt is server-owned')
      }
      let deleted = bundles.filter((b) => b.$delete).map((b) => b.entity.eid)
      let protect = deleted.length && !context?.trusted
        ? tx.get(deleted, ['apply_receipt'])
        : []
      return after(protect, (rows) => {
        if (rows.some((b) => b.apply_receipt)) {
          throw new Refused('apply_receipt is server-owned')
        }
        let marked = bundles.find((b) => requestKey in b)
        if (!marked) return bundles
        let key = marked[requestKey]
        let held = typeof key == 'string' ? pending.get(key) : undefined
        if (!held || !context?.transaction) {
          throw new Refused('invalid API receipt capability')
        }
        return after(tx.get([held.eid], ['apply_receipt']), (found) => {
          let receipt = found[0]?.apply_receipt as Stored | undefined
          if (receipt) {
            if (receipt.digest != held.digest) {
              throw new Refused(
                'Idempotency-Key already used with a different body',
              )
            }
            throw new Replay(
              decode(
                (context!.graph as Graph).vocab,
                JSON.parse(receipt.answer),
              ),
            )
          }
          writes.set(context.transaction!, held)
          return bundles.flatMap((b) => {
            if (!(requestKey in b)) return [b]
            let { [requestKey]: _key, ...rest } = b
            return held.empty ? [] : [rest as Bundle]
          })
        })
      })
    },
    hooks: {
      commit: (bundles, tx, _error, context) => {
        let held = context?.transaction && writes.get(context.transaction)
        if (!held) return bundles
        let answer = stringify(
          published((context!.graph as Graph).vocab, composed(bundles)),
        )
        return after(
          tx.patch([{
            entity: { eid: held.eid },
            apply_receipt: { digest: held.digest, answer },
          }]),
          () => bundles,
        )
      },
    },
  }
}

/** Apply with an indefinite, exact-body-bound receipt scoped to the writer.
 * No time expiry: a durable browser outbox may replay after an arbitrary delay. */
export let received = async (
  graph: Graph,
  key: string,
  body: string,
  actor: Actor | null,
  bundles: Bundle[],
  options: Parameters<Graph['apply']>[1],
): Promise<Bundle[]> => {
  if (!graph.vocab.comp('apply_receipt')) {
    throw new Refused('Idempotency-Key needs the @yaks/api receipt vocabulary')
  }
  if (!graph.plugins.some((p) => p.name == '@yaks/api/receipts')) {
    graph.use(receipts())
  }
  if (bundles.some((b) => requestKey in b)) {
    throw new Refused('invalid API receipt capability')
  }
  let capability = crypto.randomUUID()
  pending.set(capability, {
    eid: derivedEid(
      `api receipt|${token([actor?.by ?? null, actor?.via ?? null, key])}`,
    ),
    digest: token(body)!,
    empty: !bundles.length,
  })
  try {
    let marked = bundles.length
      ? bundles.map((b, i) => i ? b : { ...b, [requestKey]: capability })
      : [{
        entity: { eid: crypto.randomUUID() },
        $quiet: true,
        [requestKey]: capability,
      }]
    return await graph.apply(marked, options)
  } catch (error) {
    if (error instanceof Replay) return error.answer
    throw error
  } finally {
    pending.delete(capability)
  }
}

// ---- landing a write in its batch's transaction -----------------------------

/** A host's log and the words its answers are kept in, read as each is
 * needed: an object opens its storage again with each incarnation. */
export type Beside = {
  readonly db: Driver
  readonly vocab: Graph['vocab']
  now: () => number
}

/** What a commit lands: a kept write by its place in the log, a live keyed
 * request by its receipt, or neither. */
export type Mark = number | Receipt | null

/** A host's hook into its graph's commits, and the one apply it names a
 * write for. */
export type Landing = {
  plugin: Plugin
  during: <T>(mark: Mark, apply: () => T) => T
}

/** The hook that completes a write in the transaction that commits its
 * batch: a kept write leaves the log, or stays `applied` with its answer
 * (`landed`), and a live keyed request's receipt is inserted (`received`). A
 * resend cannot see one without the other. `during` names the write for the
 * one synchronous `apply()` it wraps; every other batch (an effect's, a
 * tick's, one applied after an await) finds none named.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * import { open } from '@yaks/sqlite/db'
 * import { keep, next, raise } from './log.ts'
 * import { landing } from './receipts.ts'
 * let vocab = loadVocab({ $defs: { doc: { component: true, type: 'object',
 *   properties: { title: { type: 'string' } } } } })
 * let db = open(':memory:')
 * raise(db)
 * let hook = landing({ db, vocab, now: Date.now })
 * let g = graph({ vocab, storage: ram(vocab), plugins: [hook.plugin] })
 * let sent = new Request('http://store/apply', { method: 'POST', body: '[]' })
 * let seq = keep(db, sent, '[]')
 * await hook.during(seq, () => g.apply([{ entity: { eid: 'a' }, doc: { title: 'A' } }]))
 * equal(next(db), null)
 * ```
 */
export let landing = (log: Beside): Landing => {
  let at: Mark = null
  let plugin: Plugin = {
    name: '@yaks/api/log',
    // Logging follows a successful write and adds no admission refusal.
    admission: () => true,
    hooks: {
      commit: (bundles) => {
        if (at != null) {
          let answer = () => published(log.vocab, bundles)
          if (typeof at == 'number') landed(log.db, at, answer, log.now)
          else logged(log.db, at, answer, log.now)
          at = null
        }
        return bundles
      },
    },
  }
  return {
    plugin,
    during: <T>(mark: Mark, apply: () => T): T => {
      at = mark
      try {
        return apply()
      } finally {
        at = null
      }
    },
  }
}

// ---- the door a kept write comes in at, and its replay ----------------------

/** A refusal that asks to be sent again `retry.after` ms on. */
export type Halt = Error & { retry: { after: number } }

/** What keeps an object from writing for a while, given as data: its row
 * ceiling (@yaks/durable-object `bounded`), whose statements the log's own
 * still take while it is stopped. */
export type Window = {
  /** What a write would be refused with now, if anything. */
  refusal: () => Halt | null
  /** Run statements a stopped object must still take. */
  free: <T>(body: () => T) => T
  /** Whether a failure is the window's refusal. */
  stops: (error: unknown) => error is Halt
}

/** What a host lends its write log's door. */
export type Host = Beside & {
  readonly window: Window
  /** The object brought up for a request: its refusal, if it can't be. */
  ready: (request: Request) => Promise<Response | null>
  /** Every other door, for a write the log does not keep. */
  serve: (request: Request) => Promise<Response>
  /** One batch applied, `mark` naming it to {@link landing}. */
  commit: (request: Request, mark: Mark) => Promise<Response>
  /** Today's authority to write, asked of a durable outbox write before its
   * receipt is told: a cached acceptance is still a write answer. */
  authorize: (request: Request) => Promise<void>
  /** Whether the log may keep a body, as said before decoding: one carrying
   * a secret's value it may not. */
  keeps: (told: string) => boolean
  /** The caller's own view of an answer. */
  answer: (request: Request, response: Response) => Promise<Response>
  /** Why the object could not start, once it could not. */
  refused: () => string | null
  /** The object's alarm at `at`; `why` says what for. */
  arm: (at: number, why?: string) => unknown
  /** A failure, where it happened. */
  report: (error: unknown, request: string) => void
  /** A replay, or a read's wait on one, as a phase of the host's trace. */
  stage?: (
    name: 'replay' | 'settle',
    work: () => Promise<void>,
  ) => Promise<void>
  /** How long until the alarm comes back for a write kept on a failure. */
  retry?: number
}

/** A host's write door over its log ({@link door}). */
export type Door = {
  /** The hook that lands each write in its batch's transaction: last among
   * the graph's, so the answer a keyed write keeps is the batch as every
   * other commit hook left it. */
  plugin: Plugin
  /** A write in at `/apply`. */
  write: (request: Request) => Promise<Response>
  /** The log, from its oldest waiting write, one replay at a time. */
  drain: () => Promise<void>
  /** A durable outbox write as its commit begins: today's authority asked
   * first, then the request bound to its body. Only a matching durable
   * receipt may stand in for a rehearsal (`check`), which is told what the
   * write was told; a fresh rehearsal still runs every guard and never
   * writes a receipt. */
  bound: (
    request: Request,
    text: string,
    check?: boolean,
  ) => Promise<Request | Response>
  /** A batch's commit around the host's one synchronous `apply()`, the
   * write it lands named to `plugin` for exactly that call: a live keyed
   * write is looked for once more right before it, and one already in the
   * log is told what that one was told. */
  applying: <T>(request: Request, mark: Mark, apply: () => T) => T | Response
  /** The log first, for a request that reads: unless the log itself failed,
   * which the alarm owns, or a replay is already running. */
  settle: () => Promise<unknown> | void
  /** A replay asked for anew, by the alarm or a person's retry: the log that
   * failed last time may stand now. */
  mend: () => Promise<void>
}

// A JSON answer's headers, for one the write log kept as text.
let JSONED = { headers: { 'content-type': 'application/json' } }

/**
 * A host's write door over its log. A live keyed write commits its mutation
 * and successful receipt together, with no transient log stages. Input that
 * cannot commit is kept and replayed in order by the one drain that runs at a
 * time. A write that finds the object stopped is kept and told when to look
 * again, and the alarm armed for the window's end replays it. One that finds
 * the object refusing to start, or the log itself failing, is answered 202
 * and waits in the log. A resend (its idempotency key already in the log) is
 * the write it repeats: told what that one was told, or waiting beside it.
 */
export let door = (host: Host): Door => {
  let { now, report } = host
  let retry = host.retry ?? 60_000
  let stage = host.stage ?? ((_name, work) => work())
  // The replay in progress, one at a time; whether the last one stopped
  // because the log itself failed, which the alarm or the next incarnation
  // takes up; and the live callers waiting on a kept write, by its place.
  let draining: Promise<void> | null = null
  let stuck = false
  let callers = new Map<number, (answer: Response) => void>()

  let wait = () => host.window.refusal()?.retry.after ?? 0
  // The alarm, `ms` from now: when this object's window ends.
  let later = (ms: number) => host.arm(now() + ms, 'stopped')
  let tell = (seq: number, answer: Response) => {
    let caller = callers.get(seq)
    callers.delete(seq)
    caller?.(answer)
  }

  /** The answer for a write kept while this object is stopped, `ms` more,
   * and the alarm that comes back for it then. */
  let waits = (seq: number, ms: number): Response => {
    void later(ms)
    let s = Math.ceil(ms / 1000)
    let answer = parked(
      seq,
      `this app is past the rows it may write for ${s} s`,
    )
    answer.headers.set('retry-after', String(s))
    return answer
  }

  /** The caller's answer for a kept write, and the alarm that comes back for
   * it. */
  let park = (seq: number, why: string): Response => {
    void host.arm(now() + retry)
    return parked(seq, why)
  }

  /** A write that arrives while this object may not write: kept in the log,
   * which the window lets through (`free`), as `pending`, and told when to
   * look again. A resend of one kept so is told the same; one of a write the
   * log already settled waits, and hears what it was once the object
   * writes. */
  let hold = (request: Request, body: string, stop: Halt): Response => {
    let key = request.headers.get(IDEMPOTENCY)
    let was = host.window.free(() => key ? first(host.db, key, request) : null)
    if (was && was.state != 'pending' && was.state != 'running') {
      return refuse(stop)
    }
    let seq = was?.seq ??
      host.window.free(() => keep(host.db, request, body, now))
    return waits(seq, stop.retry.after)
  }

  /** One kept write, applied: out of the log when it commits or is refused
   * as asked, and set aside when it fails (`aside`), its failure reported
   * where the host's commit caught it. `live` is a write whose caller is
   * still here to be told its refusal; a replay's refusal has nobody to
   * tell, so it stays in the log with its reason and is reported. */
  let land = async (k: Kept, live: boolean): Promise<Response> => {
    try {
      let r = await host.commit(replayed(k), k.seq)
      // The window's to wait out (`drain`), never the write's refusal.
      if (r.status == 429 && wait()) return r
      if (r.status < 300) done(host.db, k.seq)
      else if (r.status >= 500) aside(host.db, k.seq, await said(r.clone()))
      else if (live) done(host.db, k.seq)
      else {
        let why = await said(r.clone())
        dead(host.db, k.seq, why)
        report(
          new Error(`a kept write no longer applies: ${why}`),
          'write replay',
        )
      }
      return r
    } catch (e) {
      if (host.window.stops(e)) throw e
      report(e, 'write replay')
      if (held(host.db, k.seq)) aside(host.db, k.seq, String(e))
      return refuse(e)
    }
  }

  /** The log from its oldest waiting write to its newest, one at a time. A
   * write that fails is set aside (`land`) and the ones behind it go on;
   * only the log itself failing stops the pass, and then the alarm or the
   * next incarnation starts another. Each write whose caller is still
   * waiting is answered as it lands; the ones left waiting are told they are
   * kept. */
  let drain = (): Promise<void> => {
    if (draining) return draining
    let run = async () => {
      // Yield once, so `draining` is set before the loop can end and clear
      // it: a write that arrives in between must find the loop running.
      await null
      let at: Kept | null = null
      try {
        for (let k = at = next(host.db); k; k = at = next(host.db, k.seq)) {
          let live = callers.has(k.seq)
          started(host.db, k.seq)
          let r = await land(k, live)
          // Stopped before it applied: it waits again as it was, and every
          // write behind it with it, until the window ends.
          let ms = r.status == 429 ? wait() : 0
          if (ms) {
            let seq = k.seq
            host.window.free(() => unstarted(host.db, seq))
            tell(seq, waits(seq, ms))
            break
          }
          let kept = r.status >= 500 && held(host.db, k.seq)
          // A storage failure can escape even the log's error handler. Keep
          // the live caller reachable until every response read is done, so
          // the failure cleanup below can still answer it.
          tell(k.seq, kept ? parked(k.seq, await said(r)) : r)
        }
      } catch (e) {
        if (host.window.stops(e)) {
          let seq = at?.seq
          if (seq != null) host.window.free(() => unstarted(host.db, seq))
        } else {
          stuck = true
          report(e, 'write replay')
        }
      }
      // Synchronously after the last look at the log: nothing can be kept
      // between that look and this line without finding the loop gone.
      draining = null
      let ms = wait()
      for (let [seq, caller] of callers) {
        caller(
          ms
            ? waits(seq, ms)
            : park(seq, 'earlier writes to this app are still waiting'),
        )
      }
      if (ms && !callers.size) void later(ms)
      callers.clear()
    }
    return draining = stage('replay', run)
  }

  /** A write in at `/apply`. */
  let write = async (request: Request): Promise<Response> => {
    // A binary write is kept as it came, since decoding it needs a start
    // that may not run, and is decoded as it lands.
    let { body, told } = await taken(request)
    let sent = () =>
      new Request(request, { body: opened(request.headers, body) })
    let key = request.headers.get(IDEMPOTENCY)
    let seq: number
    let was: Sent | null
    let unkept = async () => {
      let req = sent()
      return await host.ready(req) ?? host.serve(req)
    }
    if (!fits(body) || !host.keeps(told)) {
      // A browser keeps retrying its intent until acceptance. Never apply it
      // without the receipt that makes a later resend safe.
      if (durable(key)) {
        return refuse(
          new Refused(
            'outbox writes must fit in the write log and cannot carry secret values',
          ),
        )
      }
      return unkept()
    }
    // Authority is the replay's to check (the host's commit), as for every
    // kept write.
    let stop = host.window.refusal()
    if (stop) return hold(fingerprinted(request, body), body, stop)
    if (durable(key)) {
      try {
        await host.authorize(request)
        request = fingerprinted(request, body)
      } catch (e) {
        if (host.window.stops(e)) {
          return hold(fingerprinted(request, body), body, e)
        }
        return refuse(e)
      }
    }
    try {
      was = key ? first(host.db, key, request) : null
      // No pending/running row for a successful live write. Readiness may
      // yield, so check the key again afterwards and inside the commit,
      // immediately before synchronous apply. Concurrent same-key requests
      // cannot mutate twice.
      if (!was && key) {
        let no = await host.ready(request)
        was = key ? first(host.db, key, request) : null
        if (!was && !no && !stuck && !draining && !waiting(host.db)) {
          let r = await host.commit(sent(), { request })
          // Its transaction unwound when the window refused it mid-way.
          let stop = r.status == 429 ? host.window.refusal() : null
          if (stop) return hold(request, body, stop)
          if (r.status < 500) return host.answer(request, r)
          // An error after the transaction must not enqueue its mutation
          // again.
          let committed = key ? first(host.db, key, request) : null
          if (committed?.state == 'applied') {
            return host.answer(request, new Response(committed.answer, JSONED))
          }
          seq = keep(host.db, request, body, now)
          aside(host.db, seq, await said(r.clone()))
          return park(seq, await said(r))
        }
      }
      seq = was?.seq ?? keep(host.db, request, body, now)
    } catch (e) {
      if (e instanceof Refused) {
        return (e as Refused & { status?: number }).status == 503
          ? json({ error: e.name, message: e.message }, 503)
          : refuse(e)
      }
      if (host.window.stops(e)) return hold(request, body, e)
      report(e, 'write log')
      // Readiness can throw too. Keep that input if storage still works;
      // never bypass a keyed receipt after an error and risk a second
      // mutation.
      if (key) {
        try {
          let was = first(host.db, key, request)
          if (was?.state == 'applied') {
            return host.answer(request, new Response(was.answer, JSONED))
          }
          let seq = was?.seq ?? keep(host.db, request, body, now)
          aside(host.db, seq, String(e))
          return park(seq, String(e))
        } catch {
          return refuse(e)
        }
      }
      return unkept()
    }
    if (was?.state == 'applied') {
      return host.answer(request, new Response(was.answer, JSONED))
    }
    if (was?.state == 'refused') return refuse(new Refused(was.why))
    if (was?.state == 'failed') return parked(seq, was.why, was.audit)
    if (was?.state == 'interrupted' || was?.state == 'unreviewed') {
      return parked(seq, was.why, true)
    }
    // A startup effect may call this store and drain its log while `ready`
    // waits on another object. Register the live caller before yielding, so
    // that replay delivers its answer and treats refusals as live refusals.
    let answer = new Promise<Response>((r) => {
      let other = callers.get(seq)
      callers.set(seq, other ? (a) => (other(a.clone()), r(a)) : r)
    })
    let no = await host.ready(request)
    if (no || stuck) {
      tell(
        seq,
        park(
          seq,
          no
            ? host.refused() ?? 'this app could not start'
            : 'earlier writes to this app are still waiting',
        ),
      )
    } else void drain()
    return answer.then((response) => host.answer(request, response))
  }

  let { plugin, during } = landing(host)

  return {
    plugin,
    write,
    drain,
    async bound(
      request: Request,
      text: string,
      check = false,
    ): Promise<Request | Response> {
      let key = request.headers.get(IDEMPOTENCY)
      if (!durable(key)) return request
      await host.authorize(request)
      request = fingerprinted(request, text)
      let answer = check ? remembered(host.db, key!, request) : null
      return answer ? host.answer(request, answer) : request
    },
    applying<T>(request: Request, mark: Mark, apply: () => T): T | Response {
      if (mark != null && typeof mark != 'number') {
        let key = mark.request.headers.get(IDEMPOTENCY)
        let was = key ? first(host.db, key, request) : null
        if (was?.state == 'applied') return new Response(was.answer, JSONED)
        if (was) return parked(was.seq, was.why, was.audit)
      }
      return during(mark, apply)
    },
    settle(): Promise<unknown> | void {
      let going = draining
      if (going) return stage('settle', () => going)
      // While stopped, what the log holds waits for the alarm (`hold`).
      if (wait()) return
      if (!stuck && waiting(host.db)) return drain()
    },
    mend(): Promise<void> {
      stuck = false
      return drain()
    },
  }
}
