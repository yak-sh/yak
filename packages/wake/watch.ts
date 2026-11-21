// A wake that watches a query fires only when the query's rows changed. Each
// time it comes due its query is read again (`tick`) and compared with what
// it saw last (`watch.seen`): a row arrived, a row changed, a row left the
// answer. A change fires it, with what changed said in `watch.changes`; a look
// that finds nothing new moves `at` on and fires nothing, so rules matching
// `*fired` (a knock, a turn of a model) run only for a change.
//
// A watch needs no cadence: its host hears each commit to what it reads, and
// `stir` brings the wake due a beat later (`SOON`), so a burst of commits is
// one look. Between commits it rests with no `at`.
//
// What a row "is" for the comparison is its content in a fixed order, its
// read-time marks ($was, $actor) left out, so the same row digests the same
// however it was read. A watch keeps at most ROWS rows, so a broad query
// watches its first ROWS.

import type { Bundle, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { line } from '@yaks/query'
import { WAKE, WATCH, type Watch } from './comp.ts'

/** The most rows a watch keeps track of. */
export let ROWS = 200

/** Each row a look saw, by eid, and a digest of what it held. */
export type Seen = Record<string, string>

/** How a watched query is read for a wake: over the graph the wake is kept
 * in, unless its host reads one that is not `local` more widely. */
export type Watching = (
  wake: Bundle,
  watch: Watch,
) => Bundle[] | Promise<Bundle[]>

/** The query a wake watches, or `undefined`. */
export let watchOf = (b: Bundle): Watch | undefined =>
  (b[WATCH] ?? undefined) as Watch | undefined

let canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v == 'object'
    ? Object.fromEntries(
      Object.keys(v).filter((k) => !k.startsWith('$')).sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    )
    : v

let digest = async (row: Bundle) => {
  let bytes = new TextEncoder().encode(JSON.stringify(canon(row)))
  let hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

let SHOWN = 10
let WIDE = 600
let clipped = (row: Bundle) => {
  let json = JSON.stringify(canon(row))
  return json.length > WIDE ? json.slice(0, WIDE) + '…' : json
}

/**
 * What `rows` say against what a watch saw before (`was`): what it sees now,
 * and what changed in words, `''` when nothing did.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { look } from './watch.ts'
 *
 * let row = { entity: { eid: 'm1' }, meeting: { title: 'Road millage' } }
 * let { seen, changes } = await look({}, [row])
 * assertEquals(changes.split('\n')[0], 'What changed (1 new):')
 * assertEquals((await look(seen, [row])).changes, '')
 * ```
 */
export let look = async (
  was: Seen,
  rows: Bundle[],
): Promise<{ seen: Seen; changes: string }> => {
  let now = new Map<string, { hash: string; row: Bundle }>()
  for (let row of rows.slice(0, ROWS)) {
    now.set(row.entity.eid, { hash: await digest(row), row })
  }
  let seen = Object.fromEntries([...now].map(([eid, n]) => [eid, n.hash]))
  let added = [...now].filter(([eid]) => !(eid in was))
  let edited = [...now].filter(([eid, n]) => eid in was && was[eid] != n.hash)
  let left = Object.keys(was).filter((eid) => !now.has(eid))
  if (!added.length && !edited.length && !left.length) {
    return { seen, changes: '' }
  }
  let lines = [
    ...added.map(([, n]) => `new: ${clipped(n.row)}`),
    ...edited.map(([, n]) => `changed: ${clipped(n.row)}`),
    ...left.map((eid) => `gone: ${eid}`),
  ]
  let counts = [
    added.length && `${added.length} new`,
    edited.length && `${edited.length} changed`,
    left.length && `${left.length} gone`,
  ].filter(Boolean).join(', ')
  let more = lines.length - SHOWN
  return {
    seen,
    changes: [
      `What changed (${counts}):`,
      ...lines.slice(0, SHOWN),
      ...more > 0 ? [`and ${more} more`] : [],
    ].join('\n'),
  }
}

/** How long after a commit a stirred wake looks: commits inside it are one
 * look, and one firing. */
export let SOON = 2_000

// How many times a wake another writer keeps moving is read before it is
// left as that writer put it.
let TRIES = 3

let iso = (t: number) => new Date(t).toISOString()

/**
 * Something the watching wakes of `graph` read committed: each one `which`
 * picks comes due `soon` after `now` (unless it is due sooner already), so
 * the host's next `tick` reads its query again and fires it if its rows
 * changed. Answers the soonest instant a stirred wake is due, in epoch ms,
 * or null when `which` picks none.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { stir } from './watch.ts'
 * import { store, T0, woken } from './testing.ts'
 *
 * let g = woken(store())
 * await g.apply([{ entity: { eid: 'w' }, wake: {}, watch: { query: '.plant' } }])
 * assertEquals(await stir(g, T0), T0 + 2_000)
 * ```
 */
export let stir = async (
  graph: Pick<Graph, 'read' | 'apply'>,
  now: number,
  opts: { which?: (wake: Bundle) => boolean; soon?: number } = {},
): Promise<number | null> => {
  let by = now + (opts.soon ?? SOON)
  let soonest: number | null = null
  let watching = await graph.read(
    '.watch&.wake&.fields=entity.eid,wake.at,watch.local',
  )
  for (let wake of watching) {
    if (opts.which && !opts.which(wake)) continue
    for (let tries = 1;; tries++) {
      let at = (wake[WAKE] as { at?: string | null } | undefined)?.at
      let due = at ? Date.parse(at) : NaN
      if (due <= by) {
        soonest = Math.min(soonest ?? due, due)
        break
      }
      try {
        await graph.apply([{
          entity: wake.entity,
          [WAKE]: { at: iso(by) },
          $was: { [WAKE]: { at: token(at) } },
        }], { now: iso(now) })
        soonest = Math.min(soonest ?? by, by)
        break
      } catch (error) {
        if (!(error instanceof Stale) || tries == TRIES) throw error
      }
      let [fresh] = await graph.read(
        line`.entity.eid=${wake.entity.eid}&.fields=entity.eid,wake.at`,
      )
      if (!fresh) break
      wake = fresh
    }
  }
  return soonest
}
