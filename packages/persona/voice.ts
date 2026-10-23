// Rendering a persona: one markdown document — the persona's own `doc`, then
// the documents it includes in full, then a list of the ones it only mentions
// by id. This is the text an agent is given at the top of its context.
//
// The persona's `doc` body is the instruction text (./vocab.json declares it
// that way), so it comes first and everything after it is a document the
// persona links to. Its words live in `doc.body` or `content.body`: a memory
// may mark a document, a comment or a transcript entry, and a persona linking
// to any of them renders the words where they already live. That is why there is no
// memory-shaped index line here and no section only memories may enter —
// restating another package's components is exactly what would stop this
// document carrying the next kind of thing somebody writes.
//
// Two sections, because there are two things a persona does with a document:
// it includes one (the body appears in full, so the reader has read it before
// starting) or it lists one (a line saying it exists, so the reader can ask
// for it). A third section would be a budget, and the budget belongs to the
// caller: it is the one that knows the size of the context window.
//
// Authored order, and nothing cleverer. The fleet's materializer sorted these
// by a warmth score that decayed against the wall clock, so two documents
// nobody had touched could swap places between renders, and a file written
// from it went stale with no graph write behind it. An edge's `ord` is a
// stored fact and the entity's number is another; both are stable, and a
// reader who wants a different order moves the edge.
//
// Markdown assembled from parts, never pasted together: each body is its own
// small document under an H1 of its own with a `---` rule above it, so a body
// may use `##` freely without colliding with the enclosing structure. Every
// title and id this module writes goes through @yaks/text's `safe` first — a
// control byte in a title is not something the terminal printing this should
// have to survive. A BODY does not: it is the author's whole document, and
// `safe` would strip the line breaks that make it one.

import type { Bundle, Comp } from '@yaks/graph'
import { BODY, DOC, TITLE } from '@yaks/doc'
import { human } from '@yaks/id'
import { safe } from '@yaks/text'
import type { Vocab } from '@yaks/vocab'

/** A persona and the documents it is built from: both sets, already resolved
 * and ordered, and the tools it offers. */
export type Worn = {
  /** the persona itself — its `doc` body is the instruction text */
  persona: Bundle
  /** the documents it includes: each body in full */
  contains: Bundle[]
  /** the documents it only mentions: one line apiece */
  names: Bundle[]
  /** the tools a session wearing it is offered: each registered tool
   * (@yaks/tools' `tool{name}`) it or a persona it includes contains. Never
   * part of its text. */
  tools: Bundle[]
}

/** The heading over the documents a persona only mentions by id. */
export let NAMED = '## Reads'

// Printed once, under that heading: a reader who meets an id needs to know it
// is an id and not a citation. Which tool resolves it is the caller's
// business, not this package's.
let ASK = 'Named here, not carried — ask the graph for one by id.'

let doc = (b: Bundle): Comp => (b[DOC] ?? {}) as Comp

let prop = (b: Bundle, name: string): string => {
  let value = doc(b)[name]
  if (name == BODY && !value) value = (b.content as Comp | undefined)?.body
  return value == null ? '' : String(value)
}

/**
 * A persona as one markdown document. Takes the loaded vocabulary the bundles
 * came from first — `let render = voice(vocab)`, then `render(worn)`.
 *
 * ```md
 * # N-1 TaskMaster
 *
 * the instruction text itself
 *
 * ---
 *
 * # M-3 delegation discipline
 *
 * an included document, in full
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
 * A pure function: give it bundles and it returns text. Where that text goes
 * — a file, a repo, the system prompt of a spawned agent — is the caller's
 * decision, which is why nothing here writes a file.
 */
export let voice = (vocab: Vocab): (worn: Worn) => string => {
  let id = human(vocab)
  let head = (b: Bundle): string => safe(`${id(b)} ${prop(b, TITLE)}`).trim()
  let part = (b: Bundle): string =>
    [`# ${head(b)}`, prop(b, BODY).trim()].filter(Boolean).join('\n\n')
  return ({ persona, contains, names }) =>
    [
      part(persona),
      ...contains.map(part),
      ...names.length
        ? [
          `${NAMED}\n\n${ASK}\n\n${
            names.map((b) => `- ${head(b)}`).join('\n')
          }`,
        ]
        : [],
    ].join('\n\n---\n\n') + '\n'
}
