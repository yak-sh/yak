// The pool: effects written down by whoever committed, and run by whoever is
// working. It is optional — a vocabulary that does not declare the `effect`
// component keeps no rows, and a handled effect runs in the process that
// committed (./registry.ts) — and it is what separates effects from writers:
//
//   effect{handler, target, comp, kind, state, attempts, at, generation,
//          error, next, lease_owner, lease_token, lease_expiry}
//
// A commit writes one row for each run it owes, inside its own transaction,
// whichever process wrote it: a crash after the commit cannot lose a run,
// because the run was committed with the write. Any number of processes work
// the pool, and a row is run by the one that claims it.
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
// storage (a Durable Object's SQLite) never hands the thread back on its own:
// a backlog worked in one go is one turn, and every request to the host waits
// it out, until a Durable Object's runtime refuses them as overloaded. So a
// worker gives way between passes, and a pass starts no more than `max` runs.
//
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
// whichever worker comes next.
//
// A worker that stays up holds a presence lease while it works, one per
// process, so a process that only passes through — a command line — can tell
// whether anyone is working the pool, and leaves the work to them when they
// are. Only a worker with code for every declared effect holds one: a process
// lending one effect its code (a terminal running its own transcripts) works
// that one, and says nothing about the rest.

import type { Bundle, Comp, Eid, Graph, HookContext, Tx } from '@yaks/graph'
import { after } from '@yaks/fp'
import { outcome, parent, peek, type Span, unlink } from '@yaks/trace'
import { derivedEid, detached, Stale, token } from '@yaks/graph'
import { and, eq } from '@yaks/query'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import type { Report, Slot } from './registry.ts'
import type { Event, Kind } from './trace.ts'
import type { Write } from './write.ts'
import { HOLD, LEASE, leaseEid, sleep, take } from './lease.ts'

/**
 * This package's components, to load beside your own when effects should be
 * written down and worked by a pool: `loadVocab([effectDoc, ...mine])`. Three
 * components, one document — `effect`, a run owed, whose every property is
 * server-owned; `lease` (./lease.ts), a duty held by one process at a time;
 * and `provisional` (./provisional.ts), an entity whose step is unfinished.
 */
export let effectDoc: VocabDoc = doc

/** The pool's component, by the name ./vocab.json declares it. */
export let EFFECT = 'effect'

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
export let backoff = (attempts: number): number =>
  Math.min(300_000, 1000 * 2 ** (attempts - 1))

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

/** A run the pool claimed, as its handler sees it. */
export type Attempt = {
  /** Whether this attempt is the run's last: if it fails now, it is left
   * failed, so what the handler records about the failure is what stands. */
  last: () => boolean
  /** The run got somewhere: a failure after this counts as its first attempt,
   * not one more in a row. For a run that does many steps, where one success
   * should give the next failure its full tries back. */
  progressed: () => Promise<void>
}

/** The longest a worker waits between passes (ms): how soon a run another
 * process wrote is picked up. */
export let CAP = 1_000

/** What every worker's presence lease is named under: `@yaks/effects/<eid>`. */
export let POOL = '@yaks/effects'

/** How a pool is worked. */
export type PoolOpts = {
  /** who this process is: what its claims and its presence lease name. A
   * worker that names nobody claims under a fresh id and holds no presence
   * lease, since a lease's holder is an entity */
  owner: Eid
  /** Maximum handlers this worker runs together. */
  max?: number
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
  /** Work the pool: with a live signal, until it aborts; with an aborted
   * one, pass after pass until nothing is left to start, giving way to the
   * host between them — and none at all where a process that stays up is
   * already working it. */
  work: (g: Graph, signal?: AbortSignal) => Promise<void>
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
  g: Graph,
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
    if (!holder || holder == o.except || l.name != `${POOL}/${holder}`) continue
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
  let me = opts.owner ?? crypto.randomUUID()
  let clock = opts.now ?? (() => Date.now())
  let hold = opts.lease ?? 60_000
  let mint = opts.mint ?? (() => crypto.randomUUID() as Eid)
  let wait = opts.backoff ?? backoff
  let max = opts.max ?? Infinity
  let stamp = (ms: number) => new Date(ms).toISOString()
  let limit = (s?: Slot) => s?.effect?.tries ?? opts.tries ?? TRIES
  let safe = (s?: Slot) => s?.effect?.idempotent != false
  // The declared effects this process can run, by name.
  let handled = (id: string) =>
    ctx.slots().find((s) => s.id == id && s.effect && s.run)

  // Whether this process works the pool, and the graph it works it on: until
  // then, what it commits is written down for somebody else.
  let member = false
  let graph: Graph | undefined
  let running = new Map<Eid, Held>()
  let loop: { done: Promise<void>; signal: AbortSignal } | undefined

  let claim = () => ({
    lease_owner: me,
    lease_token: mint(),
    lease_expiry: stamp(clock() + hold),
  })
  // A released claim. Every ending writes it, because a row nobody is running
  // must not look like a row somebody is.
  let free = { lease_owner: null, lease_token: null, lease_expiry: null }

  // Compare and set: the patch lands only if the row's claim and attempt count
  // are still the ones read — the graph's own precondition, riding on the
  // write like any other (@yaks/graph `$was`).
  let swap = async (
    g: Graph,
    eid: Eid,
    was: Comp,
    patch: Comp,
  ): Promise<boolean> => {
    try {
      await g.apply([{
        entity: { eid },
        [EFFECT]: patch,
        $was: {
          [EFFECT]: {
            lease_token: token(was.lease_token ?? null),
            attempts: token(was.attempts ?? null),
          },
        },
      }], { trusted: true })
      return true
    } catch (error) {
      if (error instanceof Stale) return false
      throw error
    }
  }

  // One claimed run: the event rebuilt from what the target holds now, the
  // handler, and the outcome written back under the same claim.
  let start = (g: Graph, eid: Eid, row: Comp, cause?: string) => {
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
      token: String(row.lease_token),
      attempts: Number(row.attempts),
      expiry: Date.parse(String(row.lease_expiry)),
      run: Promise.resolve(),
    }
    let settle = (patch: Comp) =>
      swap(g, eid, { lease_token: held.token, attempts: held.attempts }, patch)
    // A success puts the count back at this attempt, the first: only a run
    // that has failed before has anything to write.
    let attempt: Attempt = {
      last: () => held.attempts >= limit(s),
      progressed: async () => {
        if (held.attempts <= 1) return
        let was = { lease_token: held.token, attempts: held.attempts }
        if (await swap(g, eid, was, { attempts: 1 })) held.attempts = 1
      },
    }
    let go = async () => {
      let tx = detached(g.storage)
      let kind = String(row.kind) as Kind
      let name = String(row.comp ?? '')
      let [found] = await tx.get([String(row.target)])
      let event: Event = {
        kind,
        entity: found?.entity ?? { eid: String(row.target) },
        name,
        touched: row.touched as string[] | undefined,
        ...(kind == 'removed' ? {} : { comp: found?.[name] as Comp }),
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
        await settle({ state: 'done', error: null, next: null, ...free })
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
        let due = Math.max(wait(held.attempts), asked(err))
        await settle(
          last ? { state: 'failed', error: said(err), next: null, ...free } : {
            state: 'pending',
            error: said(err),
            next: stamp(clock() + due),
            ...free,
          },
        )
      }
    }
    held.run = go()
      .catch((err) => {
        if (peek(g) && span?.active) span.end({ outcome: outcome(err) })
        return ctx.report(err, {
          handler: String(row.handler),
          event: { kind: 'created', entity: { eid }, name: EFFECT },
        })
      })
      .finally(() => running.delete(eid))
    running.set(eid, held)
    return held.run
  }

  // One pass over what is owed: every row this process can run that nobody
  // holds and whose backoff is up, claimed and started. Returns the runs.
  let pass = async (g: Graph): Promise<Promise<void>[]> => {
    let now = clock()
    let started: Promise<void>[] = []
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
    let rows = await g.read(and(eq(`${EFFECT}.state`, 'pending')))
    for (let b of rows) {
      // A worker that left while this pass was going claims no more.
      if (!member || running.size >= max) break
      let eid = b.entity.eid
      let row = (b[EFFECT] ?? {}) as Comp
      let s = handled(String(row.handler))
      if (!s || running.has(eid)) continue
      let expiry = row.lease_expiry ? Date.parse(String(row.lease_expiry)) : 0
      if (
        row.lease_owner && expiry > now && !await gone(String(row.lease_owner))
      ) continue
      if (row.next && Date.parse(String(row.next)) > now) continue
      let attempts = Number(row.attempts ?? 0)
      // Every attempt spent: left failed, with the last error beside it.
      if (attempts >= limit(s)) {
        await swap(g, eid, row, { state: 'failed', next: null, ...free })
        continue
      }
      // Claimed and no `next`: interrupted, not reported, so how far it got
      // is unknown — and a second run is not the same as a first.
      if (attempts && !row.next && !safe(s)) {
        let error = `interrupted, and ${row.handler} is not idempotent`
        await swap(g, eid, row, { state: 'failed', error, ...free })
        continue
      }
      let mine = { attempts: attempts + 1, next: null, ...claim() }
      if (await swap(g, eid, row, mine)) {
        started.push(start(g, eid, { ...row, ...mine }))
      }
    }
    return started
  }

  // The claims this process is running, pushed out before they lapse.
  let renew = async (g: Graph) => {
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
    g: Graph,
    s: Slot,
    query: string,
    tries = 3,
  ): Promise<void> => {
    let found = (await g.read(query)) as Bundle[]
    if (!found.length) return
    let held = await g.read(and(
      eq(`${EFFECT}.handler`, s.id),
      eq(`${EFFECT}.state`, 'pending'),
    ))
    let owed = new Set(held.map((b) => String((b[EFFECT] as Comp).target)))
    let due = found.filter((b) => !owed.has(b.entity.eid))
    let eids = due.map((b) => sweptEid(s.id, b.entity.eid))
    let was = new Map(
      (await g.get(eids)).map((b) => [b.entity.eid, b[EFFECT] as Comp]),
    )
    let at = stamp(clock())
    let rows: Bundle[] = due.map((b, i) => ({
      entity: { eid: eids[i] },
      [EFFECT]: {
        handler: s.id,
        target: b.entity.eid,
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
  let sweep = async (g: Graph) => {
    let seen = new Set<string>()
    for (let s of ctx.slots()) {
      let query = s.effect?.sweep
      if (!query || !s.run || seen.has(s.id)) continue
      seen.add(s.id)
      let comp = s.effect!.created![0]
      try {
        await swept(g, s, query)
      } catch (err) {
        ctx.report(err, {
          handler: s.id,
          slot: s,
          event: { kind: 'created', entity: { eid: '' }, name: comp },
        })
      }
    }
  }

  // The worker's wait between passes, which a wake cuts short.
  let nap = new AbortController()

  // The worker that stays up: present, a pass, the claims renewed, a wait.
  // Its presence lease goes with it, so nobody waits out its expiry.
  let stay = async (g: Graph, signal: AbortSignal) => {
    let seat = `${POOL}/${me}`
    let present = !!opts.owner && !!g.vocab.comp(LEASE) &&
      ctx.slots().every((s) => !s.effect || !!s.run)
    let until = 0
    try {
      while (!signal.aborted) {
        try {
          if (present && until - clock() < HOLD / 2) {
            if (await take(g, seat, { holder: me, now: clock })) {
              until = clock() + HOLD
            }
          }
          await pass(g)
          await renew(g)
        } catch (err) {
          if (signal.aborted) break
          ctx.report(err, {
            handler: POOL,
            event: { kind: 'created', entity: { eid: me }, name: EFFECT },
          })
        }
        await sleep(CAP, AbortSignal.any([signal, nap.signal]))
        if (nap.signal.aborted) nap = new AbortController()
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
  // for, its target this process. Owed here, when a process starts working
  // the effects, and never by a commit, so a command passing through, which
  // never joins, owes none.
  let begin = async (g: Graph) => {
    let at = stamp(clock())
    let rows: Bundle[] = ctx.slots()
      .filter((s) => s.kind == 'started' && s.run)
      .map((s) => ({
        entity: { eid: mint() },
        [EFFECT]: {
          handler: s.id,
          target: me,
          kind: 'started',
          state: 'pending',
          attempts: 0,
          at,
          generation: 0,
        },
      }))
    try {
      if (rows.length) await g.apply(rows, { trusted: true })
    } catch (err) {
      ctx.report(err, {
        handler: POOL,
        event: { kind: 'started', entity: { eid: me }, name: EFFECT },
      })
    }
  }

  // Joining the pool, once: this process claims what it writes from now on,
  // it owes its start-up work, and what the declared sweeps select is owed a
  // run — how a worker coming up finds what nobody wrote down.
  let joined = false
  let join = async (g: Graph) => {
    member = true
    if (joined) return
    joined = true
    await begin(g)
    await sweep(g)
  }

  // Waiting on what it started, a worker keeps its claims: renewed as they
  // near expiry whether or not its loop still runs, so a run that outlasts
  // its lease is never taken by another worker while it is going.
  let beat = Math.max(1, Math.min(CAP, Math.floor(hold / 4)))
  let idle = async () => {
    while (running.size || (loop?.signal.aborted && loop.done)) {
      let stopping = loop?.signal.aborted ? loop.done : undefined
      if (stopping) loop = undefined
      let settled = Promise.allSettled([
        stopping,
        ...[...running.values()].map((h) => h.run),
      ])
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
          running.size + mine.length < max
        let row: Comp = {
          handler: s.id,
          target: e.entity.eid,
          comp: e.name,
          kind: e.kind,
          touched: e.touched,
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
    work: async (g, signal = AbortSignal.abort()) => {
      graph = g
      if (signal.aborted) {
        if (await working(g, { except: me, now: clock(), gone: opts.gone })) {
          return
        }
        await join(g)
        for (;;) {
          let started = await pass(g)
          if (!started.length) break
          await Promise.all(started)
          await sleep(0)
        }
        return
      }
      // Leaving is the moment the signal aborts, not the end of the pass in
      // flight: what this process commits from then on is the others'.
      let joining = join(g)
      signal.addEventListener('abort', () => member = false, { once: true })
      await joining
      let done = stay(g, signal)
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
