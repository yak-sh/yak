// One sweep over the composed vocabulary's expire declarations. Removal goes
// through apply, so references, provenance-only deaths, journal and subscribers
// see the same transaction as an ordinary component removal.
import { expireOf } from '@yaks/vocab'
import { and, type Clause, parse, present } from '@yaks/query'
import {
  type Access,
  type Bundle,
  type Comp,
  comps,
  Stale,
  token,
} from '@yaks/graph'
import { HOLD, LEASE, leaseEid, take } from './lease.ts'

/** The daily expiration duty shared by every effects worker. */
export let EXPIRE = '@yaks/effects/expire'
/** A day in milliseconds; the first pass is owed as soon as a worker joins. */
export let DAY = 86_400_000

/** Remove matching component rows in bounded transactions. The returned count
 * is component rows, not entities: another component keeps its owner alive.
 * Query grammar is checked here, with no free-text terms. Each declaration is
 * constrained to its own component even when its query contains an OR. */
export let expire = async (
  g: Access,
  opts: { batch?: number; now?: number; signal?: AbortSignal } = {},
): Promise<number> => {
  let batch = opts.batch ?? 100
  if (!Number.isInteger(batch) || batch < 1) {
    throw Error('expire batch must be a positive integer')
  }
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
    while (!opts.signal?.aborted) {
      let rows = await g.read(
        and(
          present(comp),
          query,
          { kind: 'limit', n: batch },
        ),
        { now: opts.now },
      )
      if (!rows.length) break
      let bundles: Bundle[] = rows.map((b) => {
        // Guard the values the selection read, not just the age of the
        // expiring row. A concurrent completion/revival is not expired on
        // the strength of a stale read. A refusal reselects the batch.
        let was: NonNullable<Bundle['$was']> = {}
        for (let [c, v] of comps(b)) {
          if (v == null) continue
          let props = g.vocab.props(c).filter((p) =>
            !g.vocab.prop(c, p)?.computed
          )
          if (props.length) {
            was[c] = Object.fromEntries(
              props.map((p) => [p, token((v as Comp)[p] ?? null)]),
            )
          }
        }
        return { entity: b.entity, [comp]: null, $was: was }
      })
      try {
        let applied = await g.apply(bundles, { trusted: true })
        let selected = new Set(rows.map((b) => b.entity.eid))
        removed += applied.filter((b) =>
          selected.has(b.entity.eid) &&
          (b[comp] === null || b.tombstone != null)
        ).length
      } catch (err) {
        if (!(err instanceof Stale)) throw err
      }
    }
  }
  return removed
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
  if (!opts.signal?.aborted && !lost.signal.aborted) {
    await take(g, EXPIRE, { holder: opts.owner, now, hold: DAY })
  }
}
