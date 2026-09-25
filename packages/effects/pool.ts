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
// A claim is the row's own lease — owner, token, expiry — taken with the
// graph's precondition (@yaks/graph `guard`): the claim lands only if the
// token and the attempt count are still the ones the claimant read, inside one
// transaction, so two workers reaching for one row settle it there and the
// loser moves on. A worker renews the claims it is running; one that dies
// leaves claims that expire, and the next pass takes them.
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
// are.

import type { Bundle, Comp, Eid, Graph, Tx } from '@yaks/graph'
import { detached, guard, Stale, then, token } from '@yaks/graph'
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
}

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
 * lease other than `except`'s, still standing. */
export let working = async (
  g: Graph,
  except?: Eid,
  now: number = Date.now(),
): Promise<boolean> => {
  if (!g.vocab.comp(LEASE)) return false
  let rows = (await g.read(`.${LEASE}`)) as Bundle[]
  return rows.some((b) => {
    let l = b[LEASE] as Comp | undefined
    return String(l?.name ?? '').startsWith(`${POOL}/`) && !!l?.holder &&
      l.holder != except && Date.parse(String(l.until)) > now
  })
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
  // are still the ones read — the graph's own precondition, in one
  // transaction.
  let swap = async (
    g: Graph,
    eid: Eid,
    was: Comp,
    patch: Comp,
  ): Promise<boolean> => {
    let guarded: Bundle = {
      entity: { eid },
      $was: {
        [EFFECT]: {
          lease_token: token(was.lease_token ?? null),
          attempts: token(was.attempts ?? null),
        },
      },
    }
    try {
      await g.storage.tx((tx) =>
        then(
          guard([guarded], tx, g.vocab),
          () => tx.patch([{ entity: { eid }, [EFFECT]: patch }]),
        )
      )
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
    let rows = await detached(g.storage)
      .read(and(eq(`${EFFECT}.state`, 'pending')))
    for (let b of rows) {
      let eid = b.entity.eid
      let row = (b[EFFECT] ?? {}) as Comp
      let s = handled(String(row.handler))
      if (!s || running.has(eid)) continue
      let expiry = row.lease_expiry ? Date.parse(String(row.lease_expiry)) : 0
      if (row.lease_owner && expiry > now) continue
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
  // already owed: how a worker coming up finds what nobody wrote down. The
  // check and the write are one transaction, so two workers coming up at once
  // owe one run, not two.
  let sweep = async (g: Graph) => {
    let seen = new Set<string>()
    for (let s of ctx.slots()) {
      let query = s.effect?.sweep
      if (!query || !s.run || seen.has(s.id)) continue
      seen.add(s.id)
      let comp = s.effect!.created![0]
      try {
        let found = (await g.read(query)) as Bundle[]
        if (!found.length) continue
        await g.storage.tx((tx) =>
          then(
            tx.read(and(
              eq(`${EFFECT}.handler`, s.id),
              eq(`${EFFECT}.state`, 'pending'),
            )),
            (held) => {
              let owed = new Set(
                held.map((b) => String((b[EFFECT] as Comp).target)),
              )
              let at = stamp(clock())
              let rows = found
                .filter((b) => !owed.has(b.entity.eid))
                .map((b) => ({
                  entity: { eid: mint() },
                  [EFFECT]: {
                    handler: s.id,
                    target: b.entity.eid,
                    comp,
                    kind: 'created',
                    state: 'pending',
                    attempts: 0,
                    at,
                    generation: 0,
                  },
                }))
              return rows.length ? tx.patch(rows) : undefined
            },
          )
        )
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
    let present = !!opts.owner && !!g.vocab.comp(LEASE)
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
        if (await working(g, me, clock())) return
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
