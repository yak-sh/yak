// The `key` keyword, interpreted: which components tag a key, and what each of
// them is called.
//
// A kind is not a fixed list this package ships. An application declares as
// many as it has — a store's `alias`, a directory's `email`, a library's `isbn`
// — and each is an ordinary component that says `key` about itself. Everything
// here reads that declaration off a loaded vocabulary; nothing is hardcoded, so
// adding a kind is one component, not an edit here.
//
// A kind has two spellings, and they may differ. The TAG is the component a key
// entity wears; the NAME is what a query says. Declaring `key: true` makes them
// the same word, which is the common case; declaring a string names the
// reading. The tag is what the key's id is derived from, so the two maps below
// are not interchangeable.

import type { Vocab } from '@yaks/vocab'

/** The component every key carries: what it names, and the value. */
export let KEY = 'key'

/**
 * Every kind the vocabulary declares, as NAME → tag component:
 * `{ alias: 'alias', mailbox: 'email' }`. Reads the `key` keyword, so the
 * vocabulary must have been loaded with `keyKeywords` registered — an
 * unregistered keyword is invisible to the loader.
 */
export let kinds = (v: Vocab): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let tag of v.all) {
    let said = v.comp(tag)?.keywords.key
    if (said === true) out[tag] = tag
    else if (typeof said == 'string' && said) out[said] = tag
  }
  return out
}

/**
 * The same declarations the other way round, as tag component → NAME. This is
 * what reads a key BACK: a bundle wearing `email` states a `mailbox` value.
 */
export let names = (v: Vocab): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let [name, tag] of Object.entries(kinds(v))) out[tag] = name
  return out
}
