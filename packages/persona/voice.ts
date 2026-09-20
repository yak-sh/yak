// A persona, said: the ACT this package adds to its words. One markdown
// document — the persona's own doc, then the docs it carries whole, then the
// ones it only names — which is the projection an agent reads at the top of
// its context.
//
// The persona's body IS the voice (./vocab.json says so), so it leads and
// everything after it is something the persona HOLDS. What it holds is a `doc`
// and nothing more particular: a memory is @yaks/memory's word, a goal is
// @yaks/goal's, and a persona holding either renders the same way. That is why
// there is no memory-shaped index line here and no tier only memories may
// enter — restating another package's words would be the one thing that makes
// this document unable to carry the next kind of thing somebody writes.
//
// TWO TIERS, because there are two things a persona does with a document: it
// CARRIES one (the body rides in full, and the reader has read it before it
// starts) or it NAMES one (a line saying it exists, so the reader can ask for
// it). A third tier would be a budget, and a budget is the host's: it is the
// one that knows the context window.
//
// AUTHORED ORDER, and nothing cleverer. The fleet's materializer sorted these
// by a warmth score that decays against the wall clock, so two documents
// nobody touched could swap places between renders and a file written from it
// went stale with no graph write behind it. An edge's `ord` is a graph fact and
// the entity's number is another; both are stable, and a reader who wants a
// different order moves the edge.
//
// Markdown by PARTS, never by paste: each body is its own little document
// under an H1 of its own with a `---` rule above it, so a body may use `##`
// freely without colliding with the frame. Every title and id this module
// writes goes through @yaks/text's `safe` first — a control byte in a title is
// not something the terminal printing this should have to survive. A BODY does
// not: it is the author's whole document, and `safe` eats the line breaks that
// make it one.

import type { Bundle, Comp } from '@yaks/graph'
import { BODY, DOC, TITLE } from '@yaks/doc'
import { idOf } from '@yaks/id'
import { safe } from '@yaks/text'
import type { Vocab } from '@yaks/vocab'

/** A persona and what it holds: the two tiers, already resolved and ordered. */
export type Worn = {
  /** the persona itself — its doc is the voice */
  persona: Bundle
  /** the docs it carries: each body in full */
  carries: Bundle[]
  /** the docs it only names: a line apiece */
  names: Bundle[]
}

/** The heading over the tier a persona only names. */
export let NAMED = '## Reads'

// Said once, under that heading: a reader who meets an id needs to know it is
// an id and not a citation. Which tool answers it is the host's word, not ours.
let ASK = 'Named here, not carried — ask the graph for one by id.'

let doc = (b: Bundle): Comp => (b[DOC] ?? {}) as Comp

let column = (b: Bundle, name: string): string => {
  let value = doc(b)[name]
  return value == null ? '' : String(value)
}

/**
 * A persona as one markdown document. Config-first over the loaded vocabulary
 * the bundles came from — `let said = voice(vocab)`, then `said(worn)`.
 *
 * ```md
 * # N-1 TaskMaster
 *
 * the voice itself
 *
 * ---
 *
 * # M-3 delegation discipline
 *
 * what it carries, whole
 *
 * ---
 *
 * ## Reads
 *
 * Named here, not carried — ask the graph for one by id.
 *
 * - M-9 tickets carry signal
 * ```
 *
 * Pure: hand it bundles and it answers text. Where that text LANDS — a file, a
 * repo, a spawn's system prompt — is the host's, which is why nothing here
 * writes one.
 */
export let voice = (vocab: Vocab): (worn: Worn) => string => {
  let id = idOf(vocab)
  let head = (b: Bundle): string =>
    safe(
      `${id({ eid: b.entity.eid, kind: vocab.kindOf(b), num: b.entity.num })} ${
        column(b, TITLE)
      }`,
    ).trim()
  let part = (b: Bundle): string =>
    [`# ${head(b)}`, column(b, BODY).trim()].filter(Boolean).join('\n\n')
  return ({ persona, carries, names }) =>
    [
      part(persona),
      ...carries.map(part),
      ...names.length
        ? [
          `${NAMED}\n\n${ASK}\n\n${
            names.map((b) => `- ${head(b)}`).join('\n')
          }`,
        ]
        : [],
    ].join('\n\n---\n\n') + '\n'
}
