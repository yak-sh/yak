// What @yaks/memory says at the start of a transcript: the `digest` facet a
// host takes (`@yaks/memory/digest`) — the memories this session's project
// keeps, newest first, one line each.
//
// NEWEST, NOT NEAREST, AND ON PURPOSE. "The memories nearest what this session
// is about" is the better answer, and it is `.near=<entity>&.order=similar`
// (./recall.ts `line`) — which a host answers only where it composed
// @yaks/embedding, and refuses outright where it did not (`@yaks/sql cannot
// compile .near`). Ranking by WORDS is not the fallback it looks like: a bare
// word on a query line compiles to one quoted PHRASE (@yaks/fts `term`), so
// handing it a sentence about the claimed work matches nothing at all. A
// digest that silently said nothing would be worse than one that says what it
// can, so this asks for what every store can answer. When a host embeds, the
// `near` is one line here and belongs in the same change as that config.
//
// Titles only. A memory is read WHOLE or not at all (`memory_recall`), and a
// digest quoting six of them in full would be the page of prose a digest
// exists to replace; a line naming one is a pointer somebody follows.

import type { Bundle, Comp } from '@yaks/graph'
import { type Sections, snip } from '@yaks/context'
import { human } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'
import { MEMORY } from './comp.ts'
import { line } from './recall.ts'

/** What a config says to this facet. */
export type Options = {
  /** how many memories a digest carries (default 6) */
  recall?: number
}

/** How many memories a digest carries where nobody said. */
export let RECALL = 6

/** Where this section sits: after what this session is about, and before the
 * standing goals it serves. */
export let weight = 10

let str = (v: unknown): string => v == null ? '' : String(v)

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** This package's section. The vocabulary is what a memory is named with; the
 * options say how many. */
export let digest = (
  host: { vocab: Vocab },
  options: Options = {},
): Sections =>
async (session, read) => {
  // The project a transcript belongs to is the actor behind it; a memory with
  // no scope is a principle that holds everywhere.
  let scope = str(comp(session as Bundle, 'session').actor)
  let id = human(host.vocab)
  let want = options.recall ?? RECALL
  // A wider window than the answer: `scope absent OR scope = this one` has no
  // spelling on a filter line, so it is read off the rows — and a memory
  // filtered out here must not have eaten a place in the answer.
  let found = await read(line({ limit: want * 4 }))
  return [{
    heading: 'recall',
    lines: found
      .filter((b) => {
        let held = str(comp(b, MEMORY).scope)
        return !held || held == scope
      })
      .slice(0, want)
      .map((b) => {
        let title = str(comp(b, 'doc').title)
        return `- ${id(b)}${title ? ` — ${snip(title)}` : ''}`
      }),
  }]
}
