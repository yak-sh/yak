// The `key` keyword, interpreted: which components tag a key, and what each of
// them is called.
//
// The kinds are not a fixed list this package ships. An application declares as
// many as it has — a store's `alias`, a directory's `email`, a library's `isbn`
// — and each is an ordinary component declaring `key` about itself. Everything
// here reads that declaration off a loaded vocabulary; nothing is hardcoded, so
// adding a kind is one component declaration, not an edit here.
//
// A kind has two names, and they may differ. The tag is the component a key
// entity carries; the name is what a query uses. Declaring `key: true` makes
// them the same, which is the common case; declaring a string names the kind
// separately. The key's id is derived from the tag, so the two maps below are
// not interchangeable.

import type { Vocab } from '@yaks/vocab'

/** The component every key carries: the entity it identifies, and the
 * value. */
export let KEY = 'key'

/**
 * Every kind the vocabulary declares, as name → tag component:
 * `{ alias: 'alias', mailbox: 'email' }`. It reads the `key` keyword, so the
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
 * The same declarations the other way round, as tag component → name. This is
 * what reads a key back: a bundle carrying `email` holds a `mailbox` value.
 */
export let names = (v: Vocab): Record<string, string> => {
  let out: Record<string, string> = {}
  for (let [name, tag] of Object.entries(kinds(v))) out[tag] = name
  return out
}
