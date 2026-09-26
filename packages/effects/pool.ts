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
// loser moves on. A worker renews the claims it is running; one that dies
// leaves claims that expire, and the next pass takes them — at once, where the
// dead worker is known to have ended ({@link PoolOpts.gone}).
//
// A process working the pool claims the rows its own commits owe as it writes
// them, and starts them once the commit is done: nothing another process could
// do with them would be sooner. What another process wrote waits for the next
// pass, at most {@link CAP} away.
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
// `effect_check` tool).
//
// A worker that stays up holds a presence lease while it works, one per
// process, so a process that only passes through — a command line — can tell
// whether anyone is working the pool, and leaves the work to them when they
// are. Only a worker with code for every declared effect holds one: a process
// lending one effect its code (a terminal running its own transcripts) works
// that one, and says nothing about the rest.

import type { Bundle, Comp, Eid, Graph, Tx } from '@yaks/graph'
import { derivedEid, detached, Stale, then, token } from '@yaks/graph'
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
 * and never more than five minutes apart. */
export let backoff = (attempts: number): number =>
  Math.min(300_000, 1000 * 2 ** (attempts - 1))

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
  /** whether a process is known to have ended without letting go (@yaks/process
   * `vanishedOne`): its claims and its presence are passed at once rather
   * than waited out (default: nobody is known to be) */
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
  writer: (gen: number) => Write
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
   * one, a single pass — and none at all where a process that stays up is
   * already working it. */
  work: (g: Graph, signal?: AbortSignal) => Promise<void>
  /** Look again now, rather than at the next pass: what a thread beside this
   * one says after it wrote runs down (./registry.ts `nudge`). */
  wake: () => void
  /** Settles once every run started here has, and a worker whose signal
   * aborted has stopped. */
  idle: () => Promise<void>
  /** Leave the pool: claim nothing more — what this process commits from
   * now on is left for the others — and settle what was started. */
  stop: () => Promise<void>
}

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

// A run going in this process: the claim it holds, and the run itself.
type Held = {
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
  let start = (g: Graph, eid: Eid, row: Comp) => {
    let s = handled(String(row.handler))
    let attempts = Number(row.attempts)
    let held: Held = {
      token: String(row.lease_token),
      attempts,
      expiry: Date.parse(String(row.lease_expiry)),
      run: Promise.resolve(),
    }
    let settle = (patch: Comp) =>
      swap(g, eid, { lease_token: held.token, attempts }, patch)
    let go = async () => {
      let tx = detached(g.storage)
      let kind = String(row.kind) as Kind
      let name = String(row.comp)
      let [found] = await tx.get([String(row.target)])
      let event: Event = {
        kind,
        entity: found?.entity ?? { eid: String(row.target) },
        name,
        ...(kind == 'removed' ? {} : { comp: found?.[name] as Comp }),
      }
      try {
        if (!s?.run) throw new Error(`no effect is handled as ${row.handler}`)
        await s.run(event, tx, ctx.writer(Number(row.generation ?? 0)))
        await settle({ state: 'done', error: null, next: null, ...free })
      } catch (err) {
        ctx.report(err, { handler: String(row.handler), event, slot: s })
        await settle(
          attempts < limit(s)
            ? {
              state: 'pending',
              error: said(err),
              next: stamp(clock() + wait(attempts)),
              ...free,
            }
            : { state: 'failed', error: said(err), next: null, ...free },
        )
      }
    }
    held.run = go()
      .catch((err) =>
        ctx.report(err, {
          handler: String(row.handler),
          event: { kind: 'created', entity: { eid }, name: EFFECT },
        })
      )
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

  // Joining the pool, once: this process claims what it writes from now on,
  // and what the declared sweeps select is owed a run — how a worker coming
  // up finds what nobody wrote down.
  let joined = false
  let join = async (g: Graph) => {
    member = true
    if (joined) return
    joined = true
    await sweep(g)
  }

  let idle = async () => {
    while (running.size || (loop?.signal.aborted && loop.done)) {
      let stopping = loop?.signal.aborted ? loop.done : undefined
      if (stopping) loop = undefined
      await Promise.all([stopping, ...[...running.values()].map((h) => h.run)])
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
        let ours = member && !!s.run
        let row: Comp = {
          handler: s.id,
          target: e.entity.eid,
          comp: e.name,
          kind: e.kind,
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
      return then(tx.patch(rows), () => mine)
    },
    start: (owed) => {
      for (let { eid, row } of owed) start(graph!, eid, row)
    },
    work: async (g, signal = AbortSignal.abort()) => {
      graph = g
      if (signal.aborted) {
        if (await working(g, { except: me, now: clock(), gone: opts.gone })) {
          return
        }
        await join(g)
        await Promise.all(await pass(g))
        return
      }
      await join(g)
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
  }
}
