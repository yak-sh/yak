// The `edge` keywords, interpreted: which components name a relation, what
// each of them is called, and how each reads from its far end.
//
// The set of relations is not a fixed list this package ships. An application
// declares as many as it has — a blog's `links`, a bookstore's `cites`, a task
// board's `requires` — and each is an ordinary component declaring `edge`
// about itself. Everything here reads that declaration off a loaded vocabulary;
// nothing is hardcoded, so adding a relation means adding one component, not
// editing this file.
//
// A relation has two names, and they may differ. The component name is the
// component stored on the link entity (`references`); the query name is what a
// query uses (`referenced`). Declaring `edge: true` makes them identical,
// which is the common case; declaring a string gives the query name. The link's
// id is derived from the component name, so the two maps below are not
// interchangeable.

import type { Vocab } from '@yaks/vocab'

/** The component every edge carries: its two ends, and its place in a list. */
export let EDGE = 'edge'

/**
 * Every relation the vocabulary declares, as query name → component name:
 * `{ cites: 'cites', referenced: 'references' }`. Reads the `edge` keyword,
 * so the vocabulary must have been loaded with `edgeKeywords` registered — an
 * unregistered keyword is invisible to the loader.
 */
export let relations = (v: Vocab): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let tag of v.all) {
    // The keyword is named after the component it is stored beside, so one
    // rule covers them all (@yaks/key's components declare `key`).
    let said = v.comp(tag)?.keywords?.edge
    if (said === true) out[tag] = tag
    else if (typeof said == 'string' && said) out[said] = tag
  }
  return out
}

/**
 * The same declarations the other way round, as component name → query name.
 * This is what reads a stored link back: a bundle carrying `references` is a
 * `referenced` link.
 */
export let names = (v: Vocab): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let [name, tag] of Object.entries(relations(v))) out[tag] = name
  return out
}

/**
 * How each relation reads from its far end, as query name → phrase: what a
 * page says about the links pointing at the entity it draws. A relation that
 * declares no `reversed` is left out, and its reader shows the relation's name.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * import { edgeKeywords, reversed } from '@yaks/edge'
 *
 * let v = loadVocab([{
 *   $defs: {
 *     cites: {
 *       component: true,
 *       type: 'object',
 *       edge: true,
 *       reversed: 'cited by',
 *     },
 *   },
 * }], [edgeKeywords])
 * assertEquals(reversed(v), { cites: 'cited by' })
 * ```
 */
export let reversed = (v: Vocab): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let [name, tag] of Object.entries(relations(v))) {
    let said = v.comp(tag)?.keywords?.reversed
    if (typeof said == 'string' && said) out[name] = said
  }
  return out
}
