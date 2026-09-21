// A BACKGROUND JOB, and the one process running it.
//
// Some work is not about a batch at all: picking back up the agents a restart
// left running, freeing the locks a dead session held, firing the wakes that
// came due while nobody was looking. Every process that opens the graph could
// do it, and if they all did, an agent would be tailed twice and a wake fired
// twice. So each such job is a row, and taking it is a contest:
//
//   lease{name, holder, until}
//
// The eid is derived from the NAME, the way an edge's eid is derived from its
// endpoints and relation, so one job is one row in every graph and two
// processes reaching for it address the same row. Taking it is a write with a
// `$was` precondition — the holder and the expiry as the taker READ them — so
// the loser is refused inside the transaction rather than overwriting the
// winner a moment later. Nothing here polls a lock table; the graph's own
// precondition is the lock.
//
// `until` is what makes a lease a lease. A holder that is still doing the work
// takes it again on a timer and pushes the expiry out; one that was killed
// leaves a row that expires, and the next process to ask gets it. Nothing has
// to clean up after it, which is the whole reason the job is held under a
// lease rather than a claim.
//
// A graph whose vocabulary does not declare `lease` has no other process to
// contend with — one process, one graph — so every take succeeds and nothing
// is written.

import {
  type Bundle,
  derivedEid,
  type Eid,
  type Graph,
  Stale,
  then,
  token,
} from '@yaks/graph'

/** The name of the component a lease is stored as. */
export let LEASE = 'lease'

/** How long a take stands before another process may have it (ms). */
export let HOLD = 30_000

/** A lease row, as it is held. */
export type Lease = {
  /** the job being held — the eid is derived from it */
  name?: string | null
  /** the process holding it */
  holder?: Eid | null
  /** when it expires, ISO-8601 */
  until?: string | null
}

/**
 * The eid a lease is stored at: `sha256("lease|<name>")` formatted as a uuid,
 * the same derivation an edge's eid gets.
 *
 * ```ts
 * leaseEid('@yaks/wake') == leaseEid('@yaks/wake') // true
 * ```
 */
export let leaseEid = (name: string): Eid => derivedEid(`${LEASE}|${name}`)

/** The arguments to a take: who is asking, and for how long. */
export type HoldOpts = {
  /** the process asking — what `holder` names */
  holder: Eid
  /** how long the take stands (default {@link HOLD}) */
  hold?: number
  /** the clock, in milliseconds (default `Date.now`) */
  now?: () => number
}

let leaseOf = (g: Graph, eid: Eid): Promise<Lease | undefined> =>
  Promise.resolve(g.storage.tx((tx) => tx.get([eid])))
    .then(([row]) => row?.[LEASE] as Lease | undefined)

/** Whether this graph contends at all: a component its vocabulary does not
 * declare cannot be stored on anything in it, so there is one process and the
 * job is its own. */
let contested = (g: Graph): boolean => !!g.vocab.comp(LEASE)

/**
 * Take a lease, or find out somebody else holds it. Returns whether it is now
 * ours — a holder taking its own again is a renewal, and pushes `until` out.
 *
 * ```ts
 * import { take } from '@yaks/effects'
 *
 * // if (await take(graph, '@yaks/wake', { holder: me })) …
 * ```
 */
export let take = async (
  g: Graph,
  name: string,
  o: HoldOpts,
): Promise<boolean> => {
  if (!contested(g)) return true
  let eid = leaseEid(name)
  let now = (o.now ?? Date.now)()
  let held = await leaseOf(g, eid)
  let until = held?.until ? Date.parse(String(held.until)) : 0
  // Somebody else's, and their take still stands.
  if (held?.holder && held.holder != o.holder && until > now) return false
  try {
    await g.apply([{
      entity: { eid },
      [LEASE]: {
        name,
        holder: o.holder,
        until: new Date(now + (o.hold ?? HOLD)).toISOString(),
      },
      // Both columns, because both move: a rival taking an expired lease moves
      // `holder`, and the holder renewing it moves only `until`. Guarding one
      // would let the other slip past.
      $was: {
        [LEASE]: {
          holder: token(held?.holder ?? null),
          until: token(held?.until ?? null),
        },
      },
    } as Bundle])
    return true
  } catch (error) {
    // Another process got there first, inside the transaction. That is the
    // answer, not a failure.
    if (error instanceof Stale) return false
    throw error
  }
}

/**
 * Release a lease, if we are the one holding it. The row stays — the job
 * outlives whoever was doing it — and the next process to ask gets it without
 * waiting for the expiry.
 */
export let drop = async (
  g: Graph,
  name: string,
  o: { holder: Eid },
): Promise<void> => {
  if (!contested(g)) return
  let eid = leaseEid(name)
  let held = await leaseOf(g, eid)
  if (!held?.holder || held.holder != o.holder) return
  try {
    await g.apply([{
      entity: { eid },
      [LEASE]: { holder: null, until: null },
      $was: { [LEASE]: { holder: token(held.holder) } },
    } as Bundle])
  } catch (error) {
    // Somebody took it over while we were finishing. Releasing a lease we no
    // longer hold is a no-op, not an error.
    if (!(error instanceof Stale)) throw error
  }
}

/**
 * Every lease a holder has, as the bundles that release them — to be applied
 * in the same batch that records the holder's ending, because they are one
 * fact: a process that is over is not doing anything, and the next one to ask
 * should not have to wait out an expiry nobody is using.
 */
export let released = (
  g: Graph,
  holder: Eid,
): Bundle[] | Promise<Bundle[]> =>
  !contested(g) ? [] : then(
    g.read(`.${LEASE}.holder=${holder}`),
    (rows: Bundle[]): Bundle[] =>
      rows.map((b) => ({
        entity: b.entity,
        [LEASE]: { holder: null, until: null },
      })),
  )

/** Who holds a lease right now, if anybody — the read a check makes. */
export let held = (g: Graph, name: string): Promise<Lease | undefined> =>
  contested(g) ? leaseOf(g, leaseEid(name)) : Promise.resolve(undefined)

/** Wait, unless we are done waiting: a sleep the signal cuts short, so a pass
 * between renewals releases the lease the moment it is asked to. */
export let sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((wake) => {
    let done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      wake()
    }
    let timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
    if (signal?.aborted) done()
  })

/** How a lease is held for a while: {@link HoldOpts}, plus what signals that
 * we are done and how often to retry while somebody else holds it. */
export type HoldingOpts = HoldOpts & {
  /** abort to release the lease. ALREADY ABORTED means one pass and out — a
   * CLI command does what nobody else is doing and never queues for what
   * somebody else is. */
  signal?: AbortSignal
  /** how often to ask again while somebody else holds it (default a tenth of
   * the hold) */
  poll?: number
}

/**
 * Run a background job for as long as this process is up: take the lease,
 * renew it while the work runs, and release it at the end.
 *
 * The same call serves a process of either shape, which is the point — nothing
 * here assumes a separate one. A server or a TUI passes a live signal and
 * holds the lease until that aborts, waiting for the holder ahead of it to
 * expire; a one-shot CLI command passes a signal that has already aborted,
 * does the pass if nobody else is, and releases on the way out.
 *
 * ```ts
 * import { holding } from '@yaks/effects'
 *
 * // await holding(graph, '@yaks/wake', { holder: me, signal }, (s) => loop(g, { signal: s }))
 * ```
 */
export let holding = async (
  g: Graph,
  name: string,
  o: HoldingOpts,
  work: (signal: AbortSignal) => void | Promise<void>,
): Promise<void> => {
  let signal = o.signal ?? AbortSignal.abort()
  let hold = o.hold ?? HOLD
  let ask = { ...o, hold }
  while (!await take(g, name, ask)) {
    // Somebody is doing it. A process that is staying up waits them out — a
    // holder that was killed expires and this is what takes over — and one
    // that is only passing through leaves it to them.
    if (signal.aborted) return
    await sleep(o.poll ?? Math.max(250, Math.floor(hold / 10)), signal)
    if (signal.aborted) return
  }
  // Renewed on a timer while the work runs: a holder still at it never
  // expires, and one that stops existing does. A refused renewal is not worth
  // throwing about — either we still hold it, or somebody has taken over.
  let beat = signal.aborted ? undefined : setInterval(() => {
    take(g, name, ask).catch(() => {})
  }, Math.max(50, Math.floor(hold / 3)))
  try {
    await work(signal)
  } finally {
    if (beat != null) clearInterval(beat)
    await drop(g, name, { holder: o.holder })
  }
}

/** A promise that keeps a lease held and does nothing else, until the signal
 * reports that we are done — what a pass that has ALREADY finished its work
 * waits on, so the lease stays this process's while it is up. */
export let until = (signal: AbortSignal): Promise<void> =>
  signal.aborted
    ? Promise.resolve()
    : new Promise((done) =>
      signal.addEventListener('abort', () => done(), {
        once: true,
      })
    )
