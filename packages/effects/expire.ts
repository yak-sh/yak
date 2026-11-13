// One sweep over the composed vocabulary's expire declarations, then over the
// tombstones old enough that no write racing their delete can still arrive.
// Removal goes through apply, so references, provenance-only deaths, journal
// and subscribers see the same transaction as an ordinary component removal;
// a tombstone goes as a `$prune` (@yaks/graph prune.ts), which erases an
// identity only while nothing refers to it.
import { expireOf } from '@yaks/vocab'
import {
  after as past,
  and,
  type Clause,
  fields,
  limit,
  parse,
  present,
} from '@yaks/query'
import type { Access, Bundle, Comp } from '@yaks/graph'
import { comps } from '@yaks/graph/bundle'
import { Refused, Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { HOLD, LEASE, leaseEid, sleep, take } from './lease.ts'

/** The daily expiration duty shared by every effects worker. */
export let EXPIRE = '@yaks/effects/expire'
/** A day in milliseconds between successful expiration passes. */
export let DAY = 86_400_000
/** How long a tombstone outlives its delete: a write that raced the delete
 * has arrived long before, and after it nothing reads the tombstone. */
export let TOMBSTONES = 30 * DAY

/** Remove matching component rows in bounded transactions, then prune the
 * tombstones older than `tombstones` milliseconds. The returned count is
 * component rows and pruned identities, not entities: another component keeps
 * its owner alive. Query grammar is checked here, with no free-text terms.
 * Each declaration is constrained to its own component even when its query
 * contains an OR. */
export let expire = async (
  g: Access,
  opts: {
    batch?: number
    now?: number
    page?: number
    signal?: AbortSignal
    tombstones?: number
  } = {},
): Promise<number> => {
  let batch = opts.batch ?? 100
  let page = opts.page ?? PAGE
  for (let [name, n] of [['batch', batch], ['page', page]] as const) {
    if (!Number.isInteger(n) || n < 1) {
      throw Error(`expire ${name} must be a positive integer`)
    }
  }
  let paced = pacer(opts.signal)
  let removed = 0
  for (let comp of g.vocab.all) {
    let text = expireOf(g.vocab, comp)
    if (!text) continue
    let query = parse(text, { text: false })
    // Expiration selects a set, not a projected/aggregated/windowed answer.
    let filters = (c: Clause): boolean =>
      c.kind == 'pred' ||
      ((c.kind == 'and' || c.kind == 'or') && c.clauses.every(filters))
    if (!query.clauses.every(filters)) {
      throw Error(`${comp} expire must be a filter query`)
    }
    for await (let eids of owners(g, comp, page, paced, opts.signal)) {
      // A refusal reselects the page: what it refused may still expire.
      for (let left = eids; left.length && !opts.signal?.aborted;) {
        let rows = await paced(() =>
          g.read(and(present(comp), query), { now: opts.now, eids: left })
        )
        if (!rows.length) break
        let some = rows.slice(0, batch)
        try {
          let applied = await paced(() =>
            g.apply(some.map((b) => removal(g, comp, b)), {
              trusted: true,
              expiring: true,
            })
          )
          let selected = new Set(some.map((b) => b.entity.eid))
          removed += applied.filter((b) =>
            selected.has(b.entity.eid) &&
            (b[comp] === null || b.tombstone != null)
          ).length
          left = rows.slice(batch).map((b) => b.entity.eid)
        } catch (err) {
          if (!(err instanceof Stale)) throw err
        }
      }
    }
  }
  return removed + await bury(g, paced, {
    batch,
    before: new Date((opts.now ?? Date.now()) - (opts.tombstones ?? TOMBSTONES))
      .toISOString(),
    signal: opts.signal,
  })
}

// A row's removal, guarded by the values the selection read, not just the age
// of the expiring row: a concurrent completion or revival is not expired on
// the strength of a stale read.
let removal = (g: Access, comp: string, b: Bundle): Bundle => {
  let was: NonNullable<Bundle['$was']> = {}
  for (let [c, v] of comps(b)) {
    if (v == null) continue
    let props = g.vocab.props(c).filter((p) => !g.vocab.prop(c, p)?.computed)
    if (props.length) {
      was[c] = Object.fromEntries(
        props.map((p) => [p, token((v as Comp)[p] ?? null)]),
      )
    }
  }
  return { entity: b.entity, [comp]: null, $was: was }
}

/** How many of a component's owners one read of a sweep walks past. */
export let PAGE = 1000

// A component's owners, a page at a time in the order its rows were stored.
// A declaration's query is tested against one page's owners at a time, so a
// read costs a page however large the table and however few of its rows
// expire: one read of the whole test walks every row in a single statement,
// and holds a read lane for as long as that takes on a cold disk. The cursor
// is the page's last owner, which a removal leaves standing (its tombstone
// outlives the pass), so the walk never loses its place.
async function* owners(
  g: Access,
  comp: string,
  page: number,
  paced: ReturnType<typeof pacer>,
  signal?: AbortSignal,
): AsyncGenerator<string[]> {
  let after: string | undefined
  while (!signal?.aborted) {
    let rows = await paced(() =>
      g.read(
        and(
          present(comp),
          fields('entity.eid'),
          limit(page),
          ...after ? [past(after)] : [],
        ),
        { storageOrder: true },
      )
    )
    if (!rows.length) return
    let eids = rows.map((b) => b.entity.eid)
    after = eids.at(-1)
    yield eids
    if (rows.length < page) return
  }
}

// A pass's batches each hold the write lock while they apply, and its pages of
// graves each hold the thread while they are read. Before the next one the
// pass rests as long as the last one held: writers waiting on the file get in,
// where a sweep that took the lock straight back would starve them in their
// busy handlers, and lease renewals and the worker's other runs get their
// turn.
let pacer = (signal?: AbortSignal) => {
  let held = 0
  return async <T>(step: () => T | Promise<T>): Promise<T> => {
    if (held) await sleep(held, signal)
    let since = performance.now()
    try {
      return await step()
    } finally {
      held = performance.now() - since
    }
  }
}

// Prune the tombstones deleted before `before`, a page at a time in the
// store's order. A page may hold none to prune and still lead on. A page
// refused because something reached a grave between reading and pruning is
// passed over until the next pass. A store that keeps no deletion time offers
// no graves.
let bury = async (
  g: Access,
  paced: ReturnType<typeof pacer>,
  opts: { batch: number; before: string; signal?: AbortSignal },
): Promise<number> => {
  let pruned = 0
  let after: string | undefined
  while (!opts.signal?.aborted && g.outside.buried) {
    let read = g.outside.buried
    let page = await paced(() =>
      read(opts.before, { after, limit: opts.batch })
    )
    if (page.eids.length) {
      try {
        let applied = await paced(() =>
          g.apply(
            page.eids.map((eid) => ({ entity: { eid }, $prune: true })),
            { trusted: true },
          )
        )
        pruned += applied.length
      } catch (err) {
        if (!(err instanceof Stale || err instanceof Refused)) throw err
      }
    }
    if (page.next == null) break
    after = page.next
  }
  return pruned
}

/** One due daily pass, contended by the workers' existing lease mechanism.
 * Leave the lease standing for a day after success. A crash or failure leaves
 * only a short hold, so another worker can recover rather than skip the day. */
export let expireDaily = async (
  g: Access,
  opts: { owner: string; now?: () => number; signal?: AbortSignal },
): Promise<void> => {
  let now = opts.now ?? Date.now
  if (opts.signal?.aborted) return
  let [lease] = await g.get([leaseEid(EXPIRE)], [LEASE])
  let held = lease?.[LEASE] as Comp | undefined
  // A completed pass's day-long hold applies to its own worker too.
  if (held?.until && Date.parse(String(held.until)) > now()) return
  if (!await take(g, EXPIRE, { holder: opts.owner, now })) return
  let lost = new AbortController()
  let error: unknown
  let renewing: Promise<void> | undefined
  let beat = setInterval(() => {
    if (renewing) return
    renewing = take(g, EXPIRE, { holder: opts.owner, now }).then((ours) => {
      if (!ours) lost.abort()
    }).catch((err) => {
      error = err
      lost.abort()
    }).finally(() => {
      renewing = undefined
    })
  }, HOLD / 3)
  try {
    await expire(g, {
      now: now(),
      signal: opts.signal
        ? AbortSignal.any([opts.signal, lost.signal])
        : lost.signal,
    })
  } finally {
    clearInterval(beat)
    await renewing
  }
  if (error) throw error
  if (!opts.signal?.aborted && !lost.signal.aborted && g.vocab.comp(LEASE)) {
    let [row] = await g.get([leaseEid(EXPIRE)], [LEASE])
    let held = row?.[LEASE] as Comp | undefined
    if (held?.holder != opts.owner) return
    try {
      await g.apply([{
        entity: { eid: leaseEid(EXPIRE) },
        [LEASE]: { holder: null, until: new Date(now() + DAY).toISOString() },
        $was: {
          [LEASE]: { holder: token(held.holder), until: token(held.until) },
        },
      }], { trusted: true })
    } catch (error) {
      if (!(error instanceof Stale)) throw error
    }
  }
}

/** Expiration's upkeep duty, independent of the pool's work selection. */
export let expiration = async (
  g: Access,
  opts: {
    owner: string
    signal: AbortSignal
    now?: () => number
    report: (error: unknown) => void
  },
): Promise<void> => {
  while (!opts.signal.aborted) {
    try {
      await expireDaily(g, opts)
    } catch (error) {
      opts.report(error)
    }
    await sleep(g.vocab.comp(LEASE) ? HOLD : DAY, opts.signal)
  }
}
