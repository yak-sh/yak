// A DUTY, and the one process doing it.
//
// Some work is not about a batch at all: picking the agents a restart left
// running back up, freeing the locks a dead session held, firing the wakes
// that came due while nobody was looking. Every process that opens the graph
// could do it, and if they all did, an agent would be tailed twice and a wake
// fired twice. So the duty is a row, and taking it is a contest:
//
//   lease{name, holder, until}
//
// The id is derived from the NAME, the way an edge's is derived from its
// sentence, so one duty is one row in every graph and two processes reaching
// for it reach for the same one. The take is a `$was` write — the holder and
// the moment it lapses, as the taker READ them — so the loser is refused
// inside the transaction rather than overwriting the winner a moment later.
// Nothing here polls a lock table; the graph's own precondition is the lock.
//
// `until` is what makes a lease a lease. A holder that is still doing the work
// takes it again on a beat and pushes the moment out; one that was killed
// leaves a row that lapses, and the next process to ask gets it. Nothing has
// to reap it, which is the whole reason the duty is not a claim.
//
// A graph whose vocabulary has no `lease` word has nobody to contend with —
// one process, one graph — so every take succeeds and nothing is written.

import {
  type Bundle,
  derivedEid,
  type Eid,
  type Graph,
  Stale,
  then,
  token,
} from '@yaks/graph'

/** The component a duty wears. */
export let LEASE = 'lease'

/** How long a take stands before another process may have it (ms). */
export let HOLD = 30_000

/** A duty, as it is held. */
export type Lease = {
  /** what is held — the id is derived from it */
  name?: string | null
  /** the process holding it */
  holder?: Eid | null
  /** when it lapses, ISO-8601 */
  until?: string | null
}

/**
 * The id a duty is held at: `sha256("lease|<name>")` worn as a uuid, the same
 * derivation an edge's sentence gets.
 *
 * ```ts
 * leaseEid('@yaks/wake') == leaseEid('@yaks/wake') // true
 * ```
 */
export let leaseEid = (name: string): Eid => derivedEid(`${LEASE}|${name}`)

/** What a take says: who is asking, and for how long. */
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

/** Whether this graph contends at all: a word it has no entry for cannot be
 * worn by anything in it, so there is one process and the duty is its own. */
let contested = (g: Graph): boolean => !!g.vocab.comp(LEASE)

/**
 * Take a duty, or find out somebody else has it. Answers whether it is now
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
      // Both columns, because both move: a rival taking a lapsed lease moves
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
 * Let a duty go, if we are the one holding it. The row stays — what the duty
 * IS outlives who was doing it — and the next process to ask gets it without
 * waiting out the lapse.
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
    // Somebody took it over while we were finishing. Letting go of a lease we
    // no longer hold is a no-op, not an error.
    if (!(error instanceof Stale)) throw error
  }
}

/**
 * Every duty a holder has, as the bundles that let them go — to ride the batch
 * its ending rides, because they are one fact: a process that is over is not
 * doing anything, and the next one to ask should not have to wait out a lapse
 * nobody is using.
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

/** Who holds a duty right now, if anybody — the read a check makes. */
export let held = (g: Graph, name: string): Promise<Lease | undefined> =>
  contested(g) ? leaseOf(g, leaseEid(name)) : Promise.resolve(undefined)

let sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
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

/** How a duty is held for a while: {@link HoldOpts}, plus what says when we
 * are done and how often a holder is asked again. */
export type HoldingOpts = HoldOpts & {
  /** abort to give the duty up. ALREADY ABORTED means one pass and out — the
   * line does what nobody is doing and never queues for what somebody is. */
  signal?: AbortSignal
  /** how often to ask again while somebody else holds it (default a tenth of
   * the hold) */
  poll?: number
}

/**
 * Do a duty for as long as this process is up: take it, renew it while the
 * work runs, and let it go at the end.
 *
 * The same call serves a process of either shape, which is the point — nothing
 * here assumes a separate one. A door or a TUI hands it a live signal and
 * holds the duty until that aborts, waiting for a holder ahead of it to lapse;
 * a one-shot line hands it a signal that has already aborted, does the pass if
 * nobody else is, and releases on the way out.
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
    // Somebody is doing it. A process that is staying waits them out — a
    // holder that was killed lapses and this is what takes over — and one
    // that is only passing through leaves it to them.
    if (signal.aborted) return
    await sleep(o.poll ?? Math.max(250, Math.floor(hold / 10)), signal)
    if (signal.aborted) return
  }
  // Renewed on a beat while the work runs: a holder still at it never lapses,
  // and one that stops existing does. A refused renewal is not worth throwing
  // about — either we still hold it, or somebody has already taken over.
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

/** A promise that keeps a duty held and does nothing else, until the signal
 * says we are done — what a pass that is ALREADY complete waits on so the
 * duty stays this process's while it is up. */
export let until = (signal: AbortSignal): Promise<void> =>
  signal.aborted
    ? Promise.resolve()
    : new Promise((done) =>
      signal.addEventListener('abort', () => done(), {
        once: true,
      })
    )
