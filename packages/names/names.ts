// The `by_name` keyword, interpreted: which components answer to a name, which
// column that name lives in, and the entity a typed name reaches.
//
// Not every entity has a name. An author is reached as `Ursula Le Guin`; a
// review is not reached by the sentence it opens with, even though it has a
// title too — a title deep in a store's prose matches by coincidence, and there
// is always one. So a component says so: `by_name`. Everything here reads that
// declaration off a loaded vocabulary; nothing is hardcoded.

import type { Hop, Vocab } from '@yaks/vocab'
import { CLOSE, nearest } from './match.ts'

/** An entity as this package reads it: component name → that component's
 * columns. Extra fields ride along untouched, so a caller's own row type works
 * as long as its components sit under `comps`. */
export type Comps = Record<string, Record<string, unknown> | undefined>

/** The shape a candidate must have to be resolved: the components it carries. */
export type Carried = { comps: Comps }

/** How names are read: `prop` is the default name column's bare spelling, routed
 * through the vocabulary (`title` → `doc.title` in most vocabularies), and
 * `close` is the match floor — 1 accepts exact names only. */
export type Opts = { prop?: string; close?: number }

// A component's declaration → the column its name lives in. `true` takes the
// vocabulary's default name column; a string names one instead. Anything else
// (absent, false) means this component's entities have no name.
let column = (v: Vocab, said: unknown, prop: string): Hop | undefined => {
  if (said !== true && typeof said != 'string') return undefined
  let bare = said === true ? prop : said
  // route() throws on a word the vocabulary does not own — the caller asked for
  // names by a column that isn't there, and a silent empty answer would read as
  // "nothing is named".
  return v.route(bare)
}

/**
 * Every component addressable by name, mapped to the column holding it:
 * `{ author: { comp: 'doc', prop: 'title' } }`. Reads the `by_name` keyword, so
 * the vocabulary must have been loaded with `nameKeywords` registered — an
 * unregistered keyword is invisible to the loader.
 */
export let named = (v: Vocab, opts: Opts = {}): Record<string, Hop> => {
  let out: Record<string, Hop> = {}
  for (let name of v.all) {
    let hop = column(v, v.comp(name)?.keywords.by_name, opts.prop ?? 'title')
    if (hop) out[name] = hop
  }
  return out
}

/**
 * An entity's name, or nothing when it has none. Config-first over a loaded
 * vocabulary: `let name = nameOf(v)`, then `name(author)`. An entity is named
 * when it carries a `by_name` component and the column that component points at
 * holds a string — so the same `doc.title` is a NAME on an author and just text
 * on a review.
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
 * The entity a typed name reaches, or nothing when none is close enough.
 * Config-first: `let byName = resolve(v)`, then `byName('le guin', authors)`.
 *
 * An exact name always wins. Failing that the closest name above the match
 * floor wins, because nobody types a name the way it is stored — pass
 * `{ close: 1 }` for exact names only. Candidates without a name sit out, so a
 * store's prose can never be reached by a word inside it.
 */
export let resolve = (
  v: Vocab,
  opts: Opts = {},
): <T extends Carried>(name: string, among: T[]) => T | undefined => {
  let name = nameOf(v, opts)
  let close = opts.close ?? CLOSE
  return (typed, among) => nearest(typed, among, name, close)
}
