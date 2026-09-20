// What @yaks/memory says at the start of a transcript: the `digest` facet a
// host takes (`@yaks/memory/digest`) — the memories worth having back before
// the first turn, one line each.
//
// NEAREST WHAT THIS SESSION IS ABOUT. A transcript says what it is about twice
// over in the graph: the work it HOLDS, and the last few things a person TYPED
// to the actor behind it. Both are words, and words are what a store can find
// memories by — so they go on the line as alternatives, ANY one of them
// enough, and what comes back is ranked. Where the host composed
// @yaks/embedding the ranking is MEANING (`.near=<the claimed work>`, nearest
// among what the rest of the line selected); where it did not, it is how much
// of this session's words a memory actually says.
//
// WHY ANY AND NOT ALL. A search means every word (@yaks/fts ANDs them), and a
// sentence of them lands on nothing: a claimed title and five owner lines
// ANDed select no memory in any graph. A digest is not a search box — it asks
// what is worth recalling about a subject — so it asks widely and puts the
// answer in order, which is also what gives `.near` something to rank.
//
// WHETHER THE STORE ANSWERS `.near` IS THE STORE'S TO SAY. @yaks/embedding is
// a query EXTENSION, not a word in the vocabulary, so a host that composed it
// looks exactly like one that did not until a line asks. This asks, and one
// refusal settles it for the life of the host.
//
// Titles only. A memory is read WHOLE or not at all (`memory_recall`), and a
// digest quoting six of them in full would be the page of prose a digest
// exists to replace; a line naming one is a pointer somebody follows.

import type { Bundle, Comp } from '@yaks/graph'
import { type Reading, type Sections, snip, type Subject } from '@yaks/context'
import { human } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'
import { MEMORY } from './comp.ts'
import { type Asked, line, words } from './recall.ts'

/** What a config says to this facet. */
export type Options = {
  /** how many memories a digest carries (default 6) */
  recall?: number
}

/** How many memories a digest carries where nobody said. */
export let RECALL = 6

/** How many of the owner's turns the words are gathered from. */
export let TURNS = 5

/** Where this section sits: after what this session is about, and before the
 * standing goals it serves. */
export let weight = 10

// The words of the packages this section READS. Named, never imported: what a
// transcript is is @yaks/session's to declare, and a vocabulary package that
// imported it would carry a host's plugin list into a browser tab.
let CLAIM = 'claim'
let ENTRY = 'entry'
let SESSION = 'session'

// An entry a PERSON typed: prose with nothing beside it saying a model said it
// or a tool answered it (@yaks/session ./status.ts tells them apart the same
// way, by the comps on the entry rather than by a column).
let TYPED = '.content&!output&!result&!error&!exception'

let str = (v: unknown): string => v == null ? '' : String(v)

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let quoted = (v: string) => JSON.stringify(v)

// An eid a query may name: a `$alias` is a bundle the batch has yet to mint,
// and nothing in the graph refers to it.
let minted = (eid: string) => !eid.startsWith('$')

// The refusal a store makes when it cannot compile `.near` (@yaks/sql
// `Unsupported`), read off the feature it names rather than off the class:
// this package reaches no store, and a host without vectors is not an error.
let refused = (e: unknown): boolean =>
  (e as { feature?: string } | null)?.feature == '.near'

/** What this transcript is about: the work it holds, and the last few things
 * the owner typed to the actor behind it — as words to find memories by, and
 * the entity to rank them around. */
let about = async (
  read: Reading,
  session: Subject,
): Promise<{ said: string; near?: string }> => {
  let eid = session.entity.eid
  let actor = str(comp(session as Bundle, SESSION).actor)
  let held = minted(eid)
    ? await read(`.${CLAIM}.session=${quoted(eid)}&.doc?`)
    : []
  // A FRESH TRANSCRIPT IS NOT AN EMPTY ONE: at its first hook it has no
  // entries of its own, and the person was still talking a minute ago in the
  // one that just ended. So the turns are the ACTOR's, across its transcripts.
  let typed = actor
    ? await read(
      `.${ENTRY}.session.${SESSION}.actor=${quoted(actor)}&${TYPED}` +
        `&.order=-entity.num&.limit=${TURNS}`,
    )
    : []
  return {
    // The first thing it holds: a transcript holding several is holding one
    // piece of work and its parts, and the parts are near the whole anyway.
    near: held[0]?.entity.eid,
    said: [
      ...held.map((b) => str(comp(b, 'doc').title)),
      ...typed.map((b) => str(comp(b, 'content').body)),
    ].join(' '),
  }
}

// How much of what this session is about one memory actually says. A query
// line carries no bm25 — @yaks/fts keeps its ranking for the search door — so
// the store selects and this puts the selection in order.
let mentions = (b: Bundle, words: string[]): number => {
  let doc = comp(b, 'doc')
  let text = `${str(doc.title)} ${str(doc.body)}`.toLowerCase()
  return words.filter((w) => text.includes(w)).length
}

/** This package's section. The vocabulary is what a memory is named with; the
 * options say how many. */
export let digest = (
  host: { vocab: Vocab },
  options: Options = {},
): Sections => {
  // Whether this host's store answers `.near` at all — assumed until a line
  // asking for one is refused, and never asked again after that.
  let embeds = true
  return async (session, read) => {
    // The project a transcript belongs to is the actor behind it; a memory
    // with no scope is a principle that holds everywhere.
    let scope = str(comp(session as Bundle, SESSION).actor)
    let id = human(host.vocab)
    let want = options.recall ?? RECALL
    let { said, near } = await about(read, session)
    // A wider window than the answer: `scope absent OR scope = this one` has
    // no spelling on a filter line, so it is read off the rows — and a memory
    // filtered out here must not have eaten a place in the answer.
    let asked: Asked = { limit: want * 4, ...(said ? { said, any: true } : {}) }
    let found: Bundle[] = []
    if (near && embeds) {
      try {
        found = await read(line({ ...asked, near }))
      } catch (e) {
        if (!refused(e)) throw e
        embeds = false
      }
    }
    // Nothing nearest: either the store does not rank by meaning, or the
    // anchor has no vector yet (the sweep embeds what is written, afterwards).
    // Either way the words still select, and the newest of them lead.
    if (!found.length) {
      let each = [...new Set(words(said).toLowerCase().split(' '))]
        .filter(Boolean)
      found = (await read(line(asked)))
        .toSorted((a, b) => mentions(b, each) - mentions(a, each))
    }
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
}
