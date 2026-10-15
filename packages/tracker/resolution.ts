// Every resolved bug says why it stopped. Whoever resolves one (a fixer, a
// person, or the tracker itself when a bug stops recurring) explains it on the
// `resolved` mark: what broke, why, the commits that introduced and fixed it,
// and whether it can come back. The graph refuses a bug's resolution without
// its cause and recur at every door, so a letter or a page never meets a bare
// one, except on a bug resolved before explanations were kept.

import { after } from '@yaks/fp'
import type { Bundle, Comp, Plugin } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { hook } from '@yaks/graph/plugin'
import { headline, sha } from './brief.ts'
import { comp, str } from './model.ts'
import { said } from './reading.ts'

/** What a resolver says about a bug: the part of `resolved` it writes. */
export type Explanation = {
  /** what broke and whom it reached, in plain words */
  broke?: string
  /** why it broke */
  cause: string
  /** the full sha of the commit that introduced it, when known */
  since?: string
  /** the full sha of the commit that fixed it; absent when nothing changed */
  fix?: string
  /** whether it can happen again, and why */
  recur: string
}

let KEYS = ['broke', 'cause', 'since', 'fix', 'recur'] as const
let SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/

/// explanation({ bug: 'b', cause: 'a race', recur: 'no', fix: undefined }) -> { cause: 'a race', recur: 'no' }
/** The explanation a call or a body carries, and nothing else it says. */
export let explanation = (
  args: Record<string, unknown>,
): Partial<Explanation> =>
  Object.fromEntries(
    KEYS.filter((k) => args[k] != null).map((k) => [k, String(args[k])]),
  )

/// unexplained({ cause: 'a race', recur: 'no: the lock holds' }) -> []
/// unexplained({ cause: ' ', fix: 'abc1234' }) -> ['cause', 'recur', 'fix']
/** What a resolution lacks: its cause and recur, and a full sha for each
 * commit it names. */
export let unexplained = (r: Comp): string[] => [
  ...['cause', 'recur'].filter((k) => !String(r[k] ?? '').trim()),
  ...['since', 'fix'].filter((k) => r[k] != null && !SHA.test(String(r[k]))),
]

let refused = (eid: string, missing: string[]) =>
  new Refused(
    `bug ${eid} is resolved with its explanation: why it broke ` +
      '(resolved.cause), whether it can come back (resolved.recur), and ' +
      'any commit it names (since, fix) by its full sha. Missing or wrong: ' +
      missing.join(', '),
  )

/** The precondition: each bug a batch resolves is explained, counting what
 * its mark already holds. */
export let explaining = hook(['resolved'], (bundles, tx) => {
  let writes = bundles.filter((b) => b.resolved)
  if (!writes.length) return bundles
  return after(tx.get(writes.map((b) => b.entity.eid)), (rows) => {
    let held = new Map<string, Bundle>(rows.map((b) => [b.entity.eid, b]))
    for (let b of writes) {
      let was = held.get(b.entity.eid)
      if (!b.bug && !was?.bug) continue
      let missing = unexplained({
        ...was?.resolved as Comp | undefined,
        ...b.resolved as Comp,
      })
      if (missing.length) throw refused(b.entity.eid, missing)
    }
    return bundles
  })
})

/// let fixed = { entity: { eid: 'b' }, bug: {}, doc: { title: 'TypeError: no row' }, resolved: { cause: 'a race', fix: 'f'.repeat(40), recur: 'no: the lock holds' } }
/// explained(fixed) -> [['What broke', 'TypeError: no row'], ['Why', 'a race'], ['Fixed in', 'fffffff'], ['Can it come back', 'no: the lock holds']]
/// explained({ ...fixed, resolved: { cause: 'nobody looked', recur: 'it may' } })[2] -> ['Fixed in', 'nothing changed: it stopped on its own']
/// explained({ entity: { eid: 'b' }, bug: {}, resolved: {} }) -> []
/** Why a resolved bug stopped, as its resolver explained it: a label and what
 * it says, for each thing said, as a letter, a page and `yak admin errors`
 * read it. What broke falls back to the bug's headline; `commit` writes a
 * sha. Empty for a bug that is not resolved, or that was resolved before
 * explanations were kept. */
export let explained = (
  e: Bundle,
  commit: (sha: string) => string = sha,
): [string, string][] => {
  let r = comp(e, 'resolved')
  if (!r.cause) return []
  let lines: [string, string][] = [
    ['What broke', str(r.broke) || headline(said(e))],
    ['Why', str(r.cause)],
    ['Introduced in', r.since ? commit(str(r.since)) : ''],
    [
      'Fixed in',
      r.fix ? commit(str(r.fix)) : 'nothing changed: it stopped on its own',
    ],
    ['Can it come back', str(r.recur)],
  ]
  return lines.filter(([, line]) => line)
}

/** The tracker's graph plugin: the precondition that explains resolutions. */
export let resolutions = (): Plugin => ({
  name: '@yaks/tracker',
  hooks: { precondition: explaining },
})
