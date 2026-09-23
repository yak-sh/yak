// The `by_name` keyword, interpreted: which components are addressable by name,
// which property holds that name, and which entity a typed name refers to.
//
// Not every entity has a name. An author is found by typing `Ursula Le Guin`; a
// review is not found by the sentence it opens with, even though it has a title
// too — a title buried in a store's prose matches by coincidence, and there is
// always one such title. So a component declares it: `by_name`. Everything here
// reads that declaration off a loaded vocabulary; nothing is hardcoded.

import type { Hop, Vocab } from '@yaks/vocab'
import { CLOSE, nearest } from './match.ts'

/** An entity as this package reads it: component name → that component's
 * properties. Any other fields are left untouched, so a caller's own row type
 * works as long as its components are under `comps`. */
export type Comps = Record<string, Record<string, unknown> | undefined>

/** The shape a candidate must have to be resolved: the components it carries. */
export type Carried = { comps: Comps }

/** How names are read: `prop` is the default name property, given unqualified
 * and resolved through the vocabulary (`title` → `doc.title` in most
 * vocabularies), and `close` is the match threshold — 1 accepts exact names
 * only. */
export type Opts = { prop?: string; close?: number }

// A component's declaration → the property its name is held in. `true` uses the
// vocabulary's default name property; a string names another. Anything else
// (absent, false) means this component's entities have no name.
let holder = (v: Vocab, said: unknown, prop: string): Hop | undefined => {
  if (said !== true && typeof said != 'string') return undefined
  let bare = said === true ? prop : said
  // route() throws for a property the vocabulary does not declare — the caller
  // asked for names from a property that is not there, and returning nothing
  // would instead read as "no component is addressable by name".
  return v.route(bare)
}

/**
 * Every component addressable by name, mapped to the property holding it:
 * `{ author: { comp: 'doc', prop: 'title' } }`. Reads the `by_name` keyword, so
 * the vocabulary must have been loaded with `nameKeywords` registered — an
 * unregistered keyword is invisible to the loader.
 */
export let named = (v: Vocab, opts: Opts = {}): Record<string, Hop> => {
  let out: Record<string, Hop> = {}
  for (let name of v.all) {
    let hop = holder(v, v.comp(name)?.keywords.by_name, opts.prop ?? 'title')
    if (hop) out[name] = hop
  }
  return out
}

/**
 * An entity's name, or nothing when it has none. Config-first over a loaded
 * vocabulary: `let name = nameOf(v)`, then `name(author)`. An entity has a name
 * when it carries a component declared `by_name` and the property that
 * declaration points at holds a string — so the same `doc.title` is a name on
 * an author and merely text on a review.
 */
export let nameOf = (
  v: Vocab,
  opts: Opts = {},
): (e: Carried) => string | undefined => {
  let table = named(v, opts)
  return (e) => {
    for (let [comp, at] of Object.entries(table)) {
      if (!e.comps[comp]) continue
      let value = e.comps[at.comp]?.[at.prop]
      if (typeof value == 'string' && value) return value
    }
    return undefined
  }
}

/**
 * The entity a typed name refers to, or nothing when none is close enough.
 * Config-first: `let byName = resolve(v)`, then `byName('le guin', authors)`.
 *
 * An exact name always wins. Failing that, the closest name above the match
 * threshold wins, because nobody types a name exactly as it is stored — pass
 * `{ close: 1 }` for exact names only. Candidates with no name are skipped, so
 * a store's prose can never be matched by a word inside it.
 */
export let resolve = (
  v: Vocab,
  opts: Opts = {},
): <T extends Carried>(name: string, among: T[]) => T | undefined => {
  let name = nameOf(v, opts)
  let close = opts.close ?? CLOSE
  return (typed, among) => nearest(typed, among, name, close)
}
