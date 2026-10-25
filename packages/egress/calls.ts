// The calls that went out through a `uses` link, counted by the month: what
// a link's `cap` (@yaks/connections) is measured against, and what a page
// shows beside the app that made them. A call adds itself as a `called{month}`
// event on its link, and the graph folds it into `calls{month, count}` inside
// that write's own transaction, so two calls at once both count and no writer
// ever sends a sum back. A new month starts the count over.

import type { Bundle, Comp, Eid, Plugin } from '@yaks/graph'
import { USES } from '@yaks/connections'
import { egressDoc } from './vocab.ts'

/** The component a link's month of calls is kept in. */
export let CALLS = 'calls'
/** The event one call out adds to its link. */
export let CALLED = 'called'

/**
 * The UTC month an instant falls in, as YYYY-MM.
 *
 * ```ts
 * import { monthOf } from './calls.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(monthOf(Date.UTC(2026, 9, 31, 23, 59)), '2026-10')
 * ```
 */
export let monthOf = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 7)

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/**
 * A month of calls with one more added: onto the count it holds for that
 * month, and onto a fresh month when it holds an earlier one. A call from a
 * month already over arrives too late to count and leaves it as it was.
 *
 * ```ts
 * import { counted } from './calls.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(counted(undefined, '2026-10'), { month: '2026-10', count: 1 })
 * equal(counted({ month: '2026-10', count: 4 }, '2026-10').count, 5)
 * equal(counted({ month: '2026-10', count: 4 }, '2026-11').count, 1)
 * equal(counted({ month: '2026-11', count: 2 }, '2026-10').count, 2)
 * ```
 */
export let counted = (calls: Comp | undefined, month: string): Comp => {
  let held = typeof calls?.month == 'string' ? calls.month : ''
  if (held > month) return { month: held, count: Number(calls?.count ?? 0) }
  return { month, count: held == month ? Number(calls?.count ?? 0) + 1 : 1 }
}

/** How many calls went out through a link in a month: none for a month it
 * holds no count of. */
export let spent = (link: Bundle | undefined, month: string): number => {
  let c = comp(link, CALLS)
  return c.month == month ? Number(c.count ?? 0) : 0
}

/** The most calls a month a link may make, or `null` for no limit. */
export let capOf = (link: Bundle | undefined): number | null => {
  let cap = comp(link, USES).cap
  return typeof cap == 'number' ? cap : null
}

/** The write that counts one call out through each link, in `month`. */
export let calling = (links: readonly Eid[], month: string): Bundle[] =>
  links.map((eid) => ({ entity: { eid }, [CALLED]: { month } }))

/**
 * The plugin that folds each `called` event into its link's `calls`. Compose
 * it wherever `uses` links are kept, as the `./graph` facet does.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * import { equal } from '@yaks/testing'
 * import { calling, counting, egressDoc } from '@yaks/egress'
 *
 * let vocab = loadVocab([egressDoc])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [counting()] })
 * await g.apply(calling(['link'], '2026-10'), { trusted: true })
 * await g.apply(calling(['link'], '2026-10'), { trusted: true })
 * equal((await g.get(['link']))[0].calls, { month: '2026-10', count: 2 })
 * ```
 */
export let counting = (): Plugin => ({
  name: '@yaks/egress',
  // The fold reads the transaction and rewrites its batch, with no outside
  // effects, so admission can rehearse it.
  admission: () => true,
  vocab: [egressDoc],
  rules: [{
    name: 'calls',
    phase: 'rules',
    match: `+${CALLS}, *${CALLED}`,
    run: (row) => ({
      [CALLS]: counted(row[CALLS] as Comp, String(comp(row, CALLED).month)),
      [CALLED]: null,
    }),
  }],
})
