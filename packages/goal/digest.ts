// What @yaks/goal says at the start of a transcript: the `digest` facet a host
// takes (`@yaks/goal/digest`) — the standing goals, titles only.
//
// It comes LAST on purpose. A goal is never finished and never news; what it
// changes is how a session weighs the work it just read about, so it is the
// frame around the page rather than anything on it. Titles only for the same
// reason — `show V-3` reads one whole, and eight goals quoted in full would be
// the prose a digest exists to avoid.
//
// A goal with no `scope` holds everywhere; one with a scope holds for that
// project, and the project a transcript belongs to is the actor behind it. A
// host whose sessions name no actor gets the unscoped ones, which is the
// honest answer rather than everybody's goals.

import type { Bundle, Comp } from '@yaks/graph'
import { type Sections, snip } from '@yaks/context'
import { human } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'

let GOAL = 'goal'

/** What a config says to this facet. */
export type Options = {
  /** how many goals a digest carries (default 8) */
  goals?: number
}

/** How many goals a digest carries where nobody said. */
export let GOALS = 8

/** Where this section sits: last, as the frame around everything above it. */
export let weight = 20

let str = (v: unknown): string => v == null ? '' : String(v)

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** This package's section. */
export let digest = (
  host: { vocab: Vocab },
  options: Options = {},
): Sections =>
async (session, read) => {
  let scope = str(comp(session as Bundle, 'session').actor)
  let id = human(host.vocab)
  let want = options.goals ?? GOALS
  // A wider window than the answer, because the scope is read off the rows
  // rather than said on the line: `scope absent OR scope = this one` is a
  // disjunction the dot grammar has no spelling for, and a goal filtered out
  // here must not have eaten a place in the answer.
  let found = await read(`.${GOAL}&.doc&.order=entity.num&.limit=${want * 4}`)
  return [{
    heading: 'goals',
    lines: found
      .filter((b) => {
        let held = str(comp(b, GOAL).scope)
        return !held || held == scope
      })
      .slice(0, want)
      .map((b) => `- ${id(b)} ${snip(str(comp(b, 'doc').title))}`),
  }]
}
