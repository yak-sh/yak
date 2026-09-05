// The `relation` keyword, interpreted: which components tag an edge, and what
// each of them is called.
//
// A relation is not a fixed list this package ships. An application declares as
// many as it has — a blog's `links`, a bookstore's `cites`, a task board's
// `requires` — and each is an ordinary component that says `relation` about
// itself. Everything here reads that declaration off a loaded vocabulary;
// nothing is hardcoded, so adding a relation is one component, not an edit
// here.
//
// A relation has two spellings, and they may differ. The TAG is the component
// an edge entity wears (`references`); the NAME is what a query says
// (`referenced`). Declaring `relation: true` makes them the same word, which is
// the common case; declaring a string names the reading. The tag is what the
// edge's id is derived from, so the two maps below are not interchangeable.

import type { Vocab } from '@yaks/vocab'

/** The component every edge carries: its two ends, and its place in a list. */
export let EDGE = 'edge'

/**
 * Every relation the vocabulary declares, as NAME → tag component:
 * `{ cites: 'cites', referenced: 'references' }`. Reads the `relation` keyword,
 * so the vocabulary must have been loaded with `edgeKeywords` registered — an
 * unregistered keyword is invisible to the loader.
 */
export let relations = (v: Vocab): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let tag of v.all) {
    let said = v.comp(tag)?.keywords.relation
    if (said === true) out[tag] = tag
    else if (typeof said == 'string' && said) out[said] = tag
  }
  return out
}

/**
 * The same declarations the other way round, as tag component → NAME. This is
 * what reads an edge BACK: a bundle wearing `references` states a `referenced`
 * link.
 */
export let names = (v: Vocab): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let [name, tag] of Object.entries(relations(v))) out[tag] = name
  return out
}
