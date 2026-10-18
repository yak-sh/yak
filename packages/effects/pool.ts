// The pool: effects written down by whoever committed, and run by whoever is
// working. It is optional — a vocabulary that does not declare the `effect`
// component keeps no rows, and a handled effect runs in the process that
// committed (./registry.ts) — and it is what separates effects from writers:
//
//   effect{handler, target, comp, kind, touched, before, state, attempts, at,
//          generation, error, next, lease_owner, lease_token, lease_expiry}
//
// A commit writes one row for each run it owes, inside its own transaction,
// whichever process wrote it: a crash after the commit cannot lose a run,
// because the run was committed with the write. A run reads the target as it
// stands when it runs, except for what the commit removed, which is gone by
// then: a removal's row keeps that, as `before` (./trace.ts). Any number of
// processes work the pool, and a row is run by the one that claims it.
//
// A claim is the row's own lease — owner, token, expiry — written through the
// graph's own `apply()` with its precondition (@yaks/graph `$was`): the claim
// lands only if the token and the attempt count are still the ones the
// claimant read, so two workers reaching for one row settle it there and the
// loser moves on. A worker renews the claims it is running, while it works the
// pool and while it waits for them to finish; one that dies leaves claims that expire,
// and the next pass takes them — at once, where the dead worker is known to
// have ended ({@link PoolOpts.gone}).
//
// A process working the pool claims the rows its own commits owe as it writes
// them, and starts them once the commit is done: nothing another process could
// do with them would be sooner. What another process wrote waits for the next
// pass, at most {@link CAP} away.
//
// A worker shares its thread with whatever hosts it, and a synchronous
// storage (SQLite, on the box or in a Durable Object) never hands the thread
// back on its own: a backlog worked in one go is one turn, and nothing else in
// the process happens until it ends — no request is answered (a Durable
// Object's runtime refuses them as overloaded), no timer fires, no child
// process is reaped and no signal is heard. So a worker gives way between
// passes, a pass examines a bounded window, and no more than `max` runs go at
// once ({@link MAX} unless told): a backlog, a start-up sweep's thousands
// included, is worked a slot at a time, each freed slot filled at once.
//
// Success deletes its run under the same claim guard; it leaves no done row.
// There are two ways a run does not complete, and they are not the same:
//
//   It reported. The handler threw, so the row is marked with the error and
//   `next`, the instant its backoff is up, and a pass runs it again then.
//
//   It was interrupted. The worker died mid-run, or its claim expired: nothing
//   records how far it got. A claimed row with no `next` is one of these, and
//   it is run again too — unless its declaration says `idempotent: false`,
//   where a second run could duplicate something that already reached an
//   external system, and it is left failed instead.
//
// How many attempts a run gets is the declaration's (`tries`), never a
// handler's, so no effect carries retry code of its own. A run that spent them
// is left `failed` with the error it last threw, for a person (the
// `effect_check` tool). An error that asks to be tried again (it carries
// `retry`, as @yaks/model's `ModelError` does for a provider's transient
// failure) is expected: it is kept on the row and reported only once nothing
// will try it again, and where it says when to come back (`retry.after`, a
// provider's Retry-After in milliseconds) it is due no sooner than that.
//
// A handler is told which attempt it is ({@link Attempt}): whether this is its
// last, so the failure it records there is the one that stands; and a way to
// say it got somewhere, so a long run that fails again after succeeding counts
// that failure as its first, not as one more in a row.
//
// A worker winds down by leaving: the moment its signal aborts it claims
// nothing more, and what it started runs to its end, however long that is,
// still under its claim. What its runs commit meanwhile is written down for
// whichever worker comes next. A run failing after its worker left is handed
// back with the tries it has left rather than retried in place: the leaving
// process may run older code than the store it reads, and the next worker
// does not.
//
// A worker that stays up holds a presence lease while it works, one per
// process, so a process that only passes through — a command line — can tell
// whether anyone is working the pool, and leaves the work to them when they
// are. Only a worker with code for every enabled declared effect holds one: a process
// lending one effect its code (a terminal running its own transcripts) works
// that one, and says nothing about the rest.

import type { Access, Bundle, Comp, Eid, HookContext, Tx } from '@yaks/graph'
import { after } from '@yaks/fp'
import {
  during,
  outcome,
  parent,
  peek,
  scope,
  type Span,
  unlink,
} from '@yaks/trace'
import { comps } from '@yaks/graph/bundle'
import { derivedEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import {
  after as cursorAfter,
  type And,
  and,
  eq,
  fields,
  limit as window,
} from '@yaks/query'
import type { Report, Slot } from './registry.ts'
import type { Event, Kind } from './trace.ts'
import type { Write } from './write.ts'
import { HOLD, LEASE, leaseEid, sleep, take } from './lease.ts'
import { DAY, expireDaily } from './expire.ts'
import { finishedRun } from './cleanup.ts'

export { effectDoc } from './docs.ts'

/** The pool's component, by the name ./vocab.json declares it. */
export let EFFECT = 'effect'

// The queries every pass asks, built once: storage keeps what it compiled
// against the tree it was given, so a tree built afresh each pass is compiled
// afresh each pass.
let PENDING = and(
  eq(`${EFFECT}.state`, 'pending'),
  window(1),
  fields('entity.eid'),
)
let HEADS = new Map<string, And>()
// The next pending run of one handler: the first, or the first after `cursor`.
let head = (handler: string, cursor?: Eid) => {
  let q = HEADS.get(handler)
  if (!q) {
    q = and(
      eq(`${EFFECT}.handler`, handler),
      eq(`${EFFECT}.state`, 'pending'),
      window(1),
    )
    HEADS.set(handler, q)
  }
  return cursor ? and(...q.clauses, cursorAfter(cursor)) : q
}

/** The most attempts a run gets where its declaration does not say: the
 * first, and two more. */
export let TRIES = 3

/** How long after the nth attempt the next one falls due: a second, doubling,
 * and never more than five minutes apart.
 *
 * ```ts
 * import { backoff } from '@yaks/effects'
 *
 * [1, 2, 3, 10].map(backoff) // [1000, 2000, 4000, 300000]
 * ```
 */
export { backoff } from '@yaks/fp'
import { backoff } from '@yaks/fp'

// A thrown error that asks to be tried again: it carries `retry`, with the
// wait it asks for as `retry.after` in milliseconds, the shape a provider's
// Retry-After takes (@yaks/model `ModelError`).
let retryOf = (err: unknown) =>
  (err as { retry?: { after?: unknown } } | null)?.retry
let retried = (err: unknown): boolean => {
  let retry = retryOf(err)
  return retry != null && typeof retry == 'object'
}
let asked = (err: unknown): number => {
  let after = retryOf(err)?.after
  return typeof after == 'number' && after > 0 ? after : 0
}

/** A run the pool started, as its handler sees it. */
export type Attempt = {
  /** Whether this attempt is the run's last: if it fails now, it is left
   * failed, so what the handler records about the failure is what stands. */
  last: () => boolean
  /** The run got somewhere: a failure after this counts as its first attempt,
   * not one more in a row. For a run that does many steps, where one success
   * should give the next failure its full tries back. */
  progressed: () => Promise<void>
  /** Retry a local completion without replaying the handler's external work.
   * Uses this run's remaining tries and backoff without releasing the run,
   * until the worker leaves: a failure after that is thrown, and the run goes
   * back to the pool with the tries it has left. */
  retry?: <T>(body: () => Promise<T>) => Promise<T>
}

/** The longest a worker waits between passes (ms): how soon a run another
 * process wrote is picked up. */
export let CAP = 1_000

/** The most runs a worker has going at once where it is not told (`max`). */
export let MAX = 64

/** What every worker's presence lease is named under: `@yaks/effects/<eid>`. */
export let POOL = '@yaks/effects'

/** How a pool is worked. */
export type PoolOpts = {
  /** One process exclusively owns this store (for example a Durable Object).
   * Drain recorded runs without claims, presence leases, sweeps, or expiration
   * duties. Persist attempts and outcomes for crash recovery and retries,
   * but for a start-up run started at once, whose recovery is the host's
   * pass and which writes only a failure. Never enable this for a shared box
   * store. */
  singleOwner?: boolean
  /** When start-up runs are owed: on joining the pool (`join`, the default
   * for shared workers), or only when the host calls startup (`manual`, the
   * default for single-owner stores). Sweeps keep their joining behavior. */
  startup?: 'join' | 'manual'
  /** Effects explicitly disabled by this configuration, whose unclaimed runs owe no work. */
  disabled?: string[]
  /** who this process is: what its claims and its presence lease name. A
   * worker that names nobody claims under a fresh id and holds no presence
   * lease, since a lease's holder is an entity */
  owner: Eid
  /** Maximum handlers this worker runs together (default: {@link MAX}). */
  max?: number
  /** Positive integer maximum candidates examined per pass, including fresh
   * start-up admission (default: 32). */
  page?: number
  /** Leave committed runs for work() instead of starting them on the writer. */
  defer?: boolean
  /** how long a claim holds, in milliseconds (default: 60_000) */
  lease?: number
  /** the most attempts a run gets where its declaration says none (default:
   * {@link TRIES}) */
  tries?: number
  /** how long after the nth attempt the next is due, in milliseconds
   * (default: {@link backoff}) */
  backoff?: (attempts: number) => number
  /** the clock, in milliseconds (default: `Date.now`) */
  now?: () => number
  /** ids for the rows it writes (default: `crypto.randomUUID()`) */
  mint?: () => Eid
  /** whether a process is known to be over (@yaks/process `gone`): its claims
   * and its presence are passed at once rather than waited out (default:
   * nobody is known to be) */
  gone?: (holder: Eid) => boolean | Promise<boolean>
}

// The row a sweep owes `handler`'s run on `target` in: one per pair, so
// workers sweeping at once meet on it. It is never deleted, only owed again.
let sweptEid = (handler: string, target: Eid): Eid =>
  derivedEid(`${EFFECT}|sweep|${handler}|${target}`)

/** A run this process claimed as it wrote it, to start after the commit. */
export type Owed = { eid: Eid; row: Comp }

/** What the pool is given by the registry it serves. */
export type Ctx = {
  /** every registration, declared and observed */
  slots: () => Slot[]
  /** the write callback a run writes through, a generation on */
  writer: (gen: number, context?: HookContext) => Write
  report: Report
}

/** Work requested by one host invocation. */
export type WorkOpts = {
  /** Maximum discovery passes; omitted, drain until nothing is left to start. */
  passes?: number
  /** Owe fresh start-up runs and start those fitting the worker's free slots. */
  startup?: boolean
}

/** The pool over one registry: what a commit owes, and the worker. */
export type Pool = {
  /** Write down the runs a batch owes, inside its transaction — claimed by
   * this process where it works the pool and can run them. Returns those. */
  owe: (
    tx: Tx,
    found: [Slot, Event][],
    gen: number,
  ) => Owed[] | Promise<Owed[]>
  /** Start what this process claimed as it wrote it, once the commit is
   * done. */
  start: (owed: Owed[]) => void
  /** Persist handled start-up runs without joining or draining the pool.
   * Each call owes a fresh run, targeting owner; the host chooses when.
   * A failed write rejects so the host can retry its start-up pass. */
  startup: (g: Access) => Promise<void>
  /** Work the pool: with a live signal, until it aborts; with an aborted
   * one, pass after pass until nothing is left to start, giving way to the
   * host between them — and none at all where a process that stays up is
   * already working it. */
  work: (
    g: Access,
    signal?: AbortSignal,
    options?: number | WorkOpts,
  ) => Promise<void>
  /** Look again now, rather than at the next pass: what a thread beside this
   * one says after it wrote runs down (./registry.ts `nudge`). */
  wake: () => void
  /** Settles once every run started here has, and a worker whose signal
   * aborted has stopped, keeping their claims while it waits. */
  idle: () => Promise<void>
  /** Leave the pool: claim nothing more — what this process commits from
   * now on is left for the others — and settle what was started. */
  stop: () => Promise<void>
  /** The runs going in this process, oldest first. */
  running: () => Run[]
}

/** A run going in this process: its row, what it is, and when it started
 * (ms, the pool's clock). */
export type Run = { eid: Eid; handler: string; target: Eid; since: number }

/** Whether a process that stays up is working the pool over `g`: a presence
 * lease other than `except`'s, still standing, held by a process not known
 * to be gone. */
export let working = async (
  g: Access,
  o: {
    /** the asking process, whose own presence does not count */
    except?: Eid
    /** the clock, in milliseconds (default: `Date.now()`) */
    now?: number
    gone?: PoolOpts['gone']
  } = {},
): Promise<boolean> => {
  if (!g.vocab.comp(LEASE)) return false
  let now = o.now ?? Date.now()
  let rows = (await g.read(`.${LEASE}`)) as Bundle[]
  for (let b of rows) {
    let l = (b[LEASE] ?? {}) as Comp
    let holder = l.holder as Eid | undefined
    if (!holder || holder == o.except || l.name != `${POOL}/${holder}`) {
      continue
    }
    if (Date.parse(String(l.until)) <= now) continue
    if (!await o.gone?.(holder)) return true
  }
  return false
}

// What a handler threw, as the row can keep it.
let said = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

// Whether `p` is still going after `ms`: true when the wait ran out first.
let still = (p: Promise<unknown>, ms: number): Promise<boolean> =>
  new Promise((answer) => {
    let timer = setTimeout(() => answer(true), ms)
    let over = () => {
      clearTimeout(timer)
      answer(false)
    }
    p.then(over, over)
  })

// A run going in this process: what it is, the claim it holds, and the run
// itself.
type Held = Run & {
  token: string
  attempts: number
  expiry: number
  run: Promise<void>
}

/** The pool over one registry: what a commit owes, and the worker. */
export let pool = (ctx: Ctx, opts: Partial<PoolOpts> = {}): Pool => {
  // A pass admits at most this many candidates, even when concurrency is
  // unlimited; any other window than a whole number of them cannot make
  // bounded progress, so it is refused before anything is built.
  let page = opts.page ?? 32
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError('effect page must be a positive integer')
  }
  let me = opts.owner ?? crypto.randomUUID()
  let clock = opts.now ?? (() => Date.now())
  let hold = opts.lease ?? 60_000
  let mint = opts.mint ?? (() => crypto.randomUUID() as Eid)
  let wait = opts.backoff ?? backoff
  let max = opts.max ?? MAX
  let disabled = new Set(opts.disabled)
  let stamp = (ms: number) => new Date(ms).toISOString()
  let limit = (s?: Slot) => s?.effect?.tries ?? opts.tries ?? TRIES
  let safe = (s?: Slot) => s?.effect?.idempotent != false
  // The declared effects this process can run, by name.
  let handled = (id: string) =>
    ctx.slots().find((s) => s.id == id && s.effect && s.run)

  // Whether this process works the pool, and the graph it works it on: until
  // then, what it commits is written down for somebody else.
  let member = false
  let graph: Access | undefined
  let running = new Map<Eid, Held>()
  let admitting = 0
  let loop: { done: Promise<void>; signal: AbortSignal } | undefined

  let claim = () =>
    opts.singleOwner ? {} : ({
      lease_owner: me,
      lease_token: mint(),
      lease_expiry: stamp(clock() + hold),
    })
  // Shared workers release their claims on every ending. A single-owner
  // store never writes claim fields, even when draining a legacy row.
  let free = opts.singleOwner
    ? {}
    : { lease_owner: null, lease_token: null, lease_expiry: null }

  // Compare and set: the patch lands only if the row's claim and attempt count
  // are still the ones read — the graph's own precondition, riding on the
  // write like any other (@yaks/graph `$was`).
  let changing = (
    eid: Eid,
    was: Comp,
    patch: Comp | null,
  ): Bundle => ({
    entity: { eid },
    ...(patch == null ? { $delete: true } : { [EFFECT]: patch }),
    $was: {
      [EFFECT]: {
        ...(opts.singleOwner ? {} : {
          lease_token: token(was.lease_token ?? null),
        }),
        attempts: token(was.attempts ?? null),
      },
    },
  })
  let swap = async (
    g: Access,
    eid: Eid,
    was: Comp,
    patch: Comp | null,
  ): Promise<boolean> => {
    try {
      let applied = await g.apply([changing(eid, was, patch)], {
        trusted: true,
      })
      return applied.some((b) => b.entity.eid == eid)
    } catch (error) {
      if (error instanceof Stale) return false
      throw error
    }
  }

  // One claimed run: the event rebuilt from what the target holds now, the
  // handler, and the outcome written back under the same claim. A run with
  // no row (`kept` false, a single-owner start-up run, `starting`) writes
  // only a failure, as the row a retry reads.
  let start = (
    g: Access,
    eid: Eid,
    row: Comp,
    cause?: string,
    kept = true,
  ) => {
    let s = handled(String(row.handler))
    let c = peek(g)
    let span: Span | undefined
    if (c) {
      span = c.begin({
        kind: 'effect',
        name: s?.id ?? 'unhandled',
        package: '@yaks/effects',
        parent: cause,
      })
    }
    let held: Held = {
      eid,
      handler: String(row.handler),
      target: String(row.target),
      since: clock(),
      token: row.lease_token as string,
      attempts: Number(row.attempts),
      expiry: Date.parse(String(row.lease_expiry)),
      run: Promise.resolve(),
    }
    let tries = held.attempts
    let settle = (patch: Comp) =>
      kept
        ? swap(g, eid, { lease_token: held.token, attempts: held.attempts }, {
          ...patch,
          attempts: tries,
        })
        : g.apply([{
          entity: { eid },
          [EFFECT]: { ...row, ...patch, attempts: tries },
        }], { trusted: true })
    // A success puts the count back at this attempt, the first: only a run
    // that has failed before has anything to write.
    let attempt: Attempt = {
      last: () => tries >= limit(s),
      progressed: async () => {
        tries = 1
        if (held.attempts <= 1) return
        let was = { lease_token: held.token, attempts: held.attempts }
        if (await swap(g, eid, was, { attempts: 1 })) held.attempts = 1
      },
    }
    attempt.retry = async <T>(body: () => Promise<T>): Promise<T> => {
      while (true) {
        try {
          return await body()
        } catch (err) {
          if (attempt.last() || !member) throw err
          ctx.report(err, {
            handler: String(row.handler),
            slot: s,
            event: {
              kind: String(row.kind) as Kind,
              entity: { eid: String(row.target) },
              name: String(row.comp ?? ''),
            },
          })
          let due = Math.max(wait(tries), asked(err))
          await sleep(due)
          tries++
        }
      }
    }
    let go = async () => {
      let tx = g.outside
      let kind = String(row.kind) as Kind
      let name = String(row.comp ?? '')
      let [found] = await tx.get(
        [String(row.target)],
        kind == 'started' ? [] : name ? [name] : undefined,
      )
      let entity = found?.entity ?? { eid: String(row.target) }
      let before = row.before as Comp | undefined
      let event: Event = {
        kind,
        entity,
        name,
        touched: row.touched as string[] | undefined,
        ...(kind != 'removed'
          ? { comp: found?.[name] as Comp }
          : before
          ? { before: { ...before, entity } }
          : {}),
      }
      try {
        if (!s?.run) throw new Error(`no effect is handled as ${row.handler}`)
        await s.run(
          event,
          tx,
          ctx.writer(
            Number(row.generation ?? 0),
            span && peek(g) ? { graph: g, parent: span.id } : undefined,
          ),
          attempt,
        )
        if (peek(g) && span?.active) span.end({ counts: { runs: 1 } })
        // Pool bookkeeping follows the completed handler, not its trace.
        if (kept) {
          await scope(undefined, () =>
            swap(
              g,
              eid,
              { lease_token: held.token, attempts: held.attempts },
              null,
            ))
        }
      } catch (err) {
        if (peek(g) && span?.active) {
          span.end({ outcome: outcome(err), counts: { runs: 1 } })
        }
        // An error that asks to be tried again is the handler waiting on
        // something outside, expected and kept on the row; it is reported
        // only once nothing will try it again.
        let last = attempt.last()
        if (last || !retried(err)) {
          ctx.report(err, { handler: String(row.handler), event, slot: s })
        }
        let due = Math.max(wait(tries), asked(err))
        await scope(undefined, () =>
          settle(
            last
              ? { state: 'failed', error: said(err), next: null, ...free }
              : {
                state: 'pending',
                error: said(err),
                next: stamp(clock() + due),
                ...free,
              },
          ))
      }
    }
    // A host's task-local carrier retains this effect's ancestry across
    // asynchronous reads and handler work. Explicit write parents still work
    // for hosts without one, and the existing success/error boundaries end it.
    held.run = during(span, go)
      .catch((err) => {
        if (peek(g) && span?.active) span.end({ outcome: outcome(err) })
        return ctx.report(err, {
          handler: String(row.handler),
          event: { kind: 'created', entity: { eid }, name: EFFECT },
        })
      })
      .finally(() => {
        running.delete(eid)
        if (full) nap.abort()
      })
    running.set(eid, held)
    return held.run
  }

  // One pass over what is owed: every row this process can run that nobody
  // holds and whose backoff is up, claimed and started. Returns the runs.
  // Separate handler windows keep one backlog from owning the pass.
  let turn = 0
  let cursors = new Map<string, Eid>()
  let exhausted = new Set<string>()
  let scanStarted = false
  // The last pass found every slot taken: the next run to end wakes the
  // worker, rather than leaving its slot empty for a nap.
  let full = false
  // The worker's wait between passes, which a wake cuts short.
  let nap = new AbortController()
  type Pass = { started: Promise<void>[]; more: boolean }
  let due = async (g: Access, budget = page): Promise<Pass> => {
    let now = clock()
    let started: Promise<void>[] = []
    let claims: { eid: Eid; row: Comp; mine: Comp }[] = []
    let reserved = 0
    full = false
    // Asked once a pass per owner: a process that ended without letting go
    // holds nothing, whatever its claims' expiry says.
    let asked = new Map<string, Promise<boolean>>()
    let gone = (owner: string) => {
      if (owner == me) return Promise.resolve(false)
      let known = asked.get(owner)
      if (!known) {
        asked.set(owner, known = Promise.resolve(opts.gone?.(owner) ?? false))
      }
      return known
    }
    let names = [
      ...new Set([
        ...ctx.slots().filter((s) => s.effect && s.run).map((s) => s.id),
        ...disabled,
      ]),
    ]
    if (!member || running.size + admitting >= max || !names.length) {
      full = member && running.size + admitting >= max
      return { started, more: false }
    }
    if (!budget) return { started, more: true }
    // An empty pool needs one bounded identity seek, regardless of how many
    // handlers this host serves. Pending work still uses its fair windows.
    if (
      !(await g.read(PENDING, { storageOrder: true })).length
    ) {
      cursors.clear()
      exhausted.clear()
      scanStarted = false
      return { started, more: false }
    }
    let examine = async (b: Bundle) => {
      let eid = b.entity.eid
      let row = (b[EFFECT] ?? {}) as Comp
      // An older writer can still owe an opt-in this config disables. Settle
      // that obsolete errand without inventing a handler or spending an attempt.
      if (disabled.has(String(row.handler)) && !row.lease_owner) {
        try {
          let [whole] = await g.get([eid])
          let current = whole?.[EFFECT] as Comp | undefined
          if (current?.state == 'pending' && !current.lease_owner) {
            await g.apply(finishedRun(whole), { trusted: true })
          }
        } catch (e) {
          if (!(e instanceof Stale)) throw e
        }
        return
      }
      let s = handled(String(row.handler))
      if (!s || running.has(eid)) return
      let expiry = row.lease_expiry ? Date.parse(String(row.lease_expiry)) : 0
      if (
        !opts.singleOwner && row.lease_owner && expiry > now &&
        !await gone(String(row.lease_owner))
      ) return
      if (row.next && Date.parse(String(row.next)) > now) return
      let attempts = Number(row.attempts ?? 0)
      // Every attempt spent: left failed, with the last error beside it.
      if (attempts >= limit(s)) {
        await swap(g, eid, row, { state: 'failed', next: null, ...free })
        return
      }
      // Claimed and no `next`: interrupted, not reported, so how far it got
      // is unknown — and a second run is not the same as a first.
      if (attempts && !row.next && !safe(s)) {
        let error = `interrupted, and ${row.handler} is not idempotent`
        await swap(g, eid, row, { state: 'failed', error, ...free })
        return
      }
      // Reads and owner checks can yield to a writer that fills a slot.
      // Reserve against the current admission count, not the scan's earlier one.
      if (!member || running.size + admitting >= max) return
      let mine = { attempts: attempts + 1, next: null, ...claim() }
      claims.push({ eid, row, mine })
      admitting++
      reserved++
    }
    let drained = new Set<string>()
    try {
      while (
        member && running.size + admitting < max && budget > 0 &&
        drained.size < names.length
      ) {
        let name = names[turn % names.length]
        turn = (turn + 1) % names.length
        if (drained.has(name)) continue
        // One candidate, then the next handler's, not the rest of this backlog.
        let cursor = cursors.get(name)
        let [b] = await g.read(head(name, cursor), { storageOrder: true })
        // Revisit a drained handler's head next pass: a writer can owe it a
        // new run while another handler still has thousands left to examine.
        // Finding it empty spends no budget, so idle handlers cannot crowd a
        // backlog out of the pass.
        if (!b) {
          exhausted.add(name)
          cursors.delete(name)
          drained.add(name)
          continue
        }
        budget--
        exhausted.delete(name)
        cursors.set(name, b.entity.eid)
        await examine(b)
      }
      if (!member) {
        cursors.clear()
        exhausted.clear()
        return { started, more: false }
      }
      let begin = ({ eid, row, mine }: typeof claims[number]) => {
        admitting--
        reserved--
        started.push(start(g, eid, { ...row, ...mine }))
      }
      if (claims.length == 1) {
        let c = claims[0]
        if (await swap(g, c.eid, c.row, c.mine)) begin(c)
      } else if (claims.length) {
        let committed: Set<Eid> | undefined
        try {
          let applied = await g.apply(
            claims.map(({ eid, row, mine }) => changing(eid, row, mine)),
            { trusted: true },
          )
          committed = new Set(applied.map((b) => b.entity.eid))
        } catch (error) {
          if (!(error instanceof Stale)) throw error
        }
        if (committed) {
          for (let c of claims) if (committed.has(c.eid)) begin(c)
        } else {
          // Another worker may have taken just one row. Its stale guard
          // rolls back the batch; the remaining claims can still proceed.
          for (let c of claims) {
            if (await swap(g, c.eid, c.row, c.mine)) begin(c)
          }
        }
      }
    } finally {
      admitting -= reserved
    }
    full = member && running.size >= max
    scanStarted ||= started.length > 0
    let more = names.some((name) => !exhausted.has(name))
    if (!more) {
      // A drain revisits the head once after starts: those runs may have
      // written more work. An entirely blocked traversal ends, not spins.
      more = scanStarted
      scanStarted = false
      cursors.clear()
      exhausted.clear()
    }
    return { started, more }
  }

  // Drains may overlap on the same registry. Serialize selection
  // through attempt persistence and local admission: another pass must see the
  // running set before reading an attempt just written by this pass.
  let passing: Promise<unknown> = Promise.resolve()
  let pass = (g: Access, budget = page): Promise<Pass> => {
    let next = passing.then(() => due(g, budget))
    passing = next.catch(() => {})
    return next
  }

  // The claims this process is running, pushed out before they lapse.
  let renew = async (g: Access) => {
    if (opts.singleOwner) return
    let now = clock()
    for (let [eid, held] of running) {
      if (held.expiry - now > hold / 2) continue
      let expiry = now + hold
      let was = { lease_token: held.token, attempts: held.attempts }
      if (await swap(g, eid, was, { lease_expiry: stamp(expiry) })) {
        held.expiry = expiry
      }
    }
  }

  // What a declaration's `sweep` selects, owed a run again unless one is
  // already owed: how a worker coming up finds what nobody wrote down. A swept
  // run is one row per effect and target (`sweptEid`), owed again by
  // each sweep that finds it settled, and every write is guarded on the state
  // it was read in — so two workers coming up at once owe one run, not two:
  // the second finds its precondition moved, reads again, and has nothing
  // left to owe.
  let swept = async (
    g: Access,
    s: Slot,
    query: string,
    tries = 3,
  ): Promise<void> => {
    // A sweep owes runs to identities. Projecting targets here evaluates
    // computed properties (session status/cost) again for every match, though
    // only the eid is used; the handler reads its current target when it runs.
    let found = (await g.rows(query)) as { eid: Eid }[]
    if (!found.length) return
    let held = await g.read(and(
      eq(`${EFFECT}.handler`, s.id),
      eq(`${EFFECT}.state`, 'pending'),
    ))
    let owed = new Set(held.map((b) => String((b[EFFECT] as Comp).target)))
    let due = found.filter((b) => !owed.has(b.eid))
    let eids = due.map((b) => sweptEid(s.id, b.eid))
    let was = new Map(
      (await g.get(eids)).map((b) => [b.entity.eid, b[EFFECT] as Comp]),
    )
    let at = stamp(clock())
    let rows: Bundle[] = due.map((b, i) => ({
      entity: { eid: eids[i] },
      [EFFECT]: {
        handler: s.id,
        target: b.eid,
        comp: s.effect!.created![0],
        kind: 'created',
        state: 'pending',
        attempts: 0,
        at,
        generation: 0,
        error: null,
        next: null,
        ...free,
      },
      $was: { [EFFECT]: { state: token(was.get(eids[i])?.state ?? null) } },
    }))
    if (!rows.length) return
    try {
      await g.apply(rows, { trusted: true })
    } catch (error) {
      if (!(error instanceof Stale) || tries <= 1) throw error
      return swept(g, s, query, tries - 1)
    }
  }
  let sweep = async (g: Access) => {
    let seen = new Set<string>()
    for (let s of ctx.slots()) {
      let query = s.effect?.sweep
      if (!query || !s.run || seen.has(s.id)) continue
      seen.add(s.id)
      try {
        await swept(g, s, query)
      } catch (err) {
        ctx.report(err, {
          handler: s.id,
          slot: s,
        })
      }
    }
  }

  // The worker that stays up: present, a pass, the claims renewed, a wait.
  // Its presence lease goes with it, so nobody waits out its expiry.
  let stay = async (g: Access, signal: AbortSignal, budget = page) => {
    let seat = `${POOL}/${me}`
    let present = !opts.singleOwner && !!opts.owner && !!g.vocab.comp(LEASE) &&
      ctx.slots().every((s) => !s.effect || disabled.has(s.id) || !!s.run)
    let until = 0
    let expires = 0
    try {
      while (!signal.aborted) {
        // A traversal the last pass left unfinished goes on at once; the
        // worker waits for the next pass only once one finds nothing more.
        let more = false
        try {
          if (present && until - clock() < HOLD / 2) {
            if (await take(g, seat, { holder: me, now: clock })) {
              until = clock() + HOLD
            }
          }
          more = (await pass(g, budget)).more
          budget = page
          await renew(g)
          if (!opts.singleOwner && clock() >= expires) {
            await expireDaily(g, { owner: me, now: clock, signal })
            expires = clock() + (g.vocab.comp(LEASE) ? HOLD : DAY)
          }
        } catch (err) {
          if (signal.aborted) break
          ctx.report(err, {
            handler: POOL,
            event: { kind: 'created', entity: { eid: me }, name: EFFECT },
          })
        }
        await sleep(more ? 0 : CAP, AbortSignal.any([signal, nap.signal]))
        // A wake ends the nap at once, never the turn: what the pass started,
        // and a signal to stop, are heard before the next pass.
        if (nap.signal.aborted) {
          nap = new AbortController()
          await sleep(0)
        }
      }
    } finally {
      if (present) {
        try {
          await g.apply([{ entity: { eid: leaseEid(seat) }, $delete: true }])
        } catch { /* already gone, or the graph is closing */ }
      }
    }
  }

  // Start-up work: a run of each `start` effect this process has the code
  // for, its target this process. The host may owe these explicitly rather
  // than on joining, so a store waking need not be a store starting.
  //
  // A single-owner host owes its start-up pass until the runs it started
  // there have ended, so a run it starts at once keeps no row: the pass is
  // its crash recovery, and only a failure is written down, for the retry.
  // What waits for a slot is a row, like any run owed for later.
  let starting = async (
    g: Access,
    immediate = false,
  ): Promise<Promise<void>[]> => {
    let at = stamp(clock())
    let mine: Owed[] = []
    let rows: Bundle[] = []
    for (let s of ctx.slots()) {
      if (s.kind != 'started' || !s.run) continue
      let ours = immediate && member && !disabled.has(s.id) && limit(s) > 0 &&
        mine.length < page &&
        running.size + admitting + mine.length < max
      let eid = mint()
      let row: Comp = {
        handler: s.id,
        target: me,
        kind: 'started',
        state: 'pending',
        attempts: ours ? 1 : 0,
        at,
        generation: 0,
        ...(ours ? claim() : {}),
      }
      if (ours) mine.push({ eid, row })
      if (!ours || !opts.singleOwner) {
        rows.push({ entity: { eid }, [EFFECT]: row })
      }
    }
    let reserved = mine.length
    admitting += reserved
    try {
      let applied = rows.length ? await g.apply(rows, { trusted: true }) : []
      let committed = new Set(applied.map((b) => b.entity.eid))
      return mine.flatMap(({ eid, row }) => {
        let kept = !opts.singleOwner
        if (kept && !committed.has(eid)) return []
        admitting--
        reserved--
        return [start(g, eid, row, undefined, kept)]
      })
    } finally {
      admitting -= reserved
    }
  }
  let startup = async (g: Access): Promise<void> => {
    await starting(g)
  }

  // Joining the pool, once: this process claims what it writes from now on,
  // it owes start-up work where the host chose joining, and what the declared
  // sweeps select is owed a run in a shared store.
  let joined = false
  let join = async (
    g: Access,
    requested = false,
    immediate = true,
  ): Promise<Promise<void>[]> => {
    member = true
    if (joined) return requested ? starting(g, immediate) : []
    joined = true
    if (
      !requested &&
      (opts.startup ?? (opts.singleOwner ? 'manual' : 'join')) == 'join'
    ) {
      try {
        await startup(g)
      } catch (err) {
        ctx.report(err, {
          handler: POOL,
          event: { kind: 'started', entity: { eid: me }, name: EFFECT },
        })
      }
    }
    if (!opts.singleOwner) await sweep(g)
    return requested ? starting(g, immediate) : []
  }

  // Waiting on what it started, a worker keeps its claims: renewed as they
  // near expiry whether or not its loop still runs, so a run that outlasts
  // its lease is never taken by another worker while it is going.
  let beat = Math.max(1, Math.min(CAP, Math.floor(hold / 4)))
  let idle = async () => {
    for (;;) {
      // Discovery and claim persistence precede running.set. Wait for the
      // current admission pass before deciding whether anything is running.
      let pending = passing
      await pending
      if (pending !== passing) continue
      if (!running.size && !(loop?.signal.aborted && loop.done)) return
      let stopping = loop?.signal.aborted ? loop.done : undefined
      if (stopping) loop = undefined
      let settled = Promise.allSettled([
        stopping,
        ...[...running.values()].map((h) => h.run),
      ])
      if (opts.singleOwner) {
        await settled
        continue
      }
      while (await still(settled, beat)) {
        if (!graph) continue
        await renew(graph).catch((err) =>
          ctx.report(err, {
            handler: POOL,
            event: { kind: 'created', entity: { eid: me }, name: EFFECT },
          })
        )
      }
    }
  }

  return {
    owe: (tx, found, gen) => {
      let at = stamp(clock())
      let seen = new Set<string>()
      let rows: Bundle[] = []
      let mine: Owed[] = []
      for (let [s, e] of found) {
        let key = [s.id, e.entity.eid, e.name, e.kind].join('|')
        if (seen.has(key)) continue
        seen.add(key)
        let ours = member && !opts.defer && !!s.run &&
          running.size + admitting + mine.length < max
        let row: Comp = {
          handler: s.id,
          target: e.entity.eid,
          comp: e.name,
          kind: e.kind,
          touched: e.touched,
          ...e.before ? { before: Object.fromEntries(comps(e.before)) } : {},
          state: 'pending',
          attempts: ours ? 1 : 0,
          at,
          generation: gen,
          ...(ours ? claim() : {}),
        }
        let eid = mint()
        rows.push({ entity: { eid }, [EFFECT]: row })
        if (ours) mine.push({ eid, row })
      }
      return after(tx.patch(rows), () => mine)
    },
    start: (owed) => {
      for (let run of owed) {
        let cause = peek(graph!) ? parent(graph!, run) : undefined
        start(graph!, run.eid, run.row, cause)
        unlink(graph!, run)
      }
    },
    startup,
    // Without a signal, one pass, then out. Each call makes its own: on
    // workerd a signal belongs to the Durable Object that made it, and one
    // made as the module loads stops the Worker starting at all.
    work: async (g, signal = AbortSignal.abort(), options = Infinity) => {
      let requested = typeof options == 'number' ? { passes: options } : options
      let passes = requested.passes ?? Infinity
      graph = g
      exhausted.clear()
      scanStarted = false
      if (signal.aborted) {
        if (
          !opts.singleOwner &&
          await working(g, { except: me, now: clock(), gone: opts.gone })
        ) {
          if (requested.startup) await startup(g)
          return
        }
        let opening = await join(g, requested.startup, passes > 0)
        for (let n = 0; n < passes; n++) {
          let { started, more } = await pass(
            g,
            n ? page : page - opening.length,
          )
          if (!n && opening.length) started = [...opening, ...started]
          if (!started.length && !more && !running.size) break
          // A drain refills a slot as soon as its run ends, even while a
          // slower run still holds another. A finite pass settles its batch
          // and leaves newly owed work for the next wake.
          let pending = passes == Infinity
            ? [...started, ...[...running.values()].map((h) => h.run)]
            : started
          if (pending.length) {
            let settled = passes == Infinity
              ? Promise.race(pending)
              : Promise.all(pending)
            if (opts.singleOwner) await settled
            else while (await still(settled, beat)) await renew(g)
          }
          // A turn for timers and I/O between passes, never after the last.
          if (n + 1 < passes) await sleep(0)
        }
        return
      }
      // Leaving is the moment the signal aborts, not the end of the pass in
      // flight: what this process commits from then on is the others'.
      let joining = join(g, requested.startup)
      signal.addEventListener('abort', () => member = false, { once: true })
      let opening = await joining
      let done = stay(g, signal, page - opening.length)
      loop = { done, signal }
      await done
    },
    wake: () => nap.abort(),
    idle,
    stop: () => {
      member = false
      return idle()
    },
    running: () =>
      [...running.values()]
        .map(({ eid, handler, target, since }) => ({
          eid,
          handler,
          target,
          since,
        }))
        .sort((a, b) => a.since - b.since),
  }
}
