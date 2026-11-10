/**
 * A trial scores one way of assembling an agent's context on one case: a
 * correction marked `miss{entry, needed, across, told}` (@yaks/memory). The
 * case says which entry erred and which entity held the fact it lacked; the
 * variant is a persona, whose parts are what is preloaded.
 *
 * This module is the score alone, pure: given what the variant put in front of
 * the agent before its entry (the front, gathered by `@yaks/trial/moment`) and
 * what a search with the words it was answering found, it gives the
 * `trial{case, variant, asked, unasked, tokens}` row.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { trial } from '@yaks/trial'
 *
 * let row = trial(
 *   { eid: 'c', needed: 'm' },
 *   'p',
 *   [{ door: 'persona', eids: ['p', 'm'], text: 'x'.repeat(40) }],
 *   ['a', 'm'],
 * )
 * assertEquals(row.trial, {
 *   case: 'c', variant: 'p', unasked: true, asked: true, tokens: 10,
 * })
 * ```
 *
 * @module
 */
import type { Bundle, Eid } from '@yaks/graph'
import { identityEid } from '@yaks/graph/identity'

export { docs, trialDoc } from './vocab.ts'

/** Where a part of the front came in: the persona preloaded at start, the
 * compaction summary the harness wrote, a notice (hook or scheduled text), a
 * knock delivered, or the `hit` rows a write returned. */
export type Door = 'persona' | 'compaction' | 'notice' | 'knock' | 'hit'

/** One part of what was put in front of an agent: the entities it carried and
 * the text it was read as. */
export type Part = { door: Door; eids: Eid[]; text: string }

/** A case as a trial reads it: the entity wearing the miss, and the entity
 * that held the fact, absent when nothing did. */
export type Case = { eid: Eid; needed?: Eid }

/** How many of a search's rows count as found. */
export let FIRST = 5

/** Characters to tokens, at the four a token that `@yaks/session` estimates
 * with. */
export let tokens = (text: string): number => Math.ceil(text.length / 4)

/** The trial row of one case under one variant: `unasked` when the needed
 * entity is among the front's, `asked` when it is among the first
 * {@link FIRST} found. A case with no needed entity scores false on both. */
export let trial = (
  c: Case,
  variant: Eid,
  front: Part[],
  found: Eid[],
): Bundle => {
  let has = (eids: Eid[]) => !!c.needed && eids.includes(c.needed)
  return {
    entity: { eid: identityEid('trial', [c.eid, variant]) },
    trial: {
      case: c.eid,
      variant,
      unasked: has(front.flatMap((p) => p.eids)),
      asked: has(found.slice(0, FIRST)),
      tokens: front.reduce((n, p) => n + tokens(p.text), 0),
    },
  }
}

/** What a set of trial rows says: how many cases, and of them how many had
 * the fact in front unasked, how many a search found, how many the graph held
 * at all, and the mean tokens put in front. */
export type Tally = {
  cases: number
  held: number
  unasked: number
  asked: number
  tokens: number
}

/** The tally of trial rows, `held` counted from the cases they score. */
export let tally = (rows: Bundle[], cases: Case[]): Tally => {
  let t = rows.map((r) => r.trial as Record<string, unknown>)
  let count = (k: string) => t.filter((x) => x[k] === true).length
  return {
    cases: t.length,
    held: cases.filter((c) => c.needed).length,
    unasked: count('unasked'),
    asked: count('asked'),
    tokens: t.length
      ? Math.round(t.reduce((n, x) => n + Number(x.tokens), 0) / t.length)
      : 0,
  }
}
