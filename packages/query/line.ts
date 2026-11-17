// A query line written in code. Every value put into a `line` is one
// operand, written as `parse` reads it back, so a slug, eid or title cannot
// close a clause and open another. Query text joins another line only through
// `sub`. A store reads a `Line`, so text spliced together by hand does not
// type-check; a whole query its author wrote (a person's own filter, a saved
// board's line) enters through `whole`.

import { coerce, type Input } from './ast.ts'
import { conjoin } from './parse.ts'
import { listed } from './stringify.ts'

declare const LINE: unique symbol

/** Query text a store reads: {@link Built} in code, or taken {@link whole}. */
export type Line = string & { readonly [LINE]: 'built' | 'whole' }

/** Query text built by {@link line} or {@link joined}, whose every operand
 * was quoted; only this joins another line. */
export type Built = string & { readonly [LINE]: 'built' }

// A line's text, to be spliced as written rather than quoted.
class Sub {
  constructor(readonly text: Built) {}
}

/** What `line` takes between its parts: an operand, a list of operands (one
 * any-of value), or a line's text marked by {@link sub}. */
export type Part = Input | readonly Input[] | Sub

let written = (v: Part): string => {
  if (v instanceof Sub) return v.text
  if (Array.isArray(v)) {
    if (!v.length) throw new SyntaxError('an empty list has no query text')
    return listed(v)
  }
  if (v == null) throw new TypeError(`a query operand is ${v}`)
  return listed([coerce(v as Input)])
}

/**
 * A query line, each value between its parts written as one operand.
 *
 * ```ts
 * import { line, sub } from '@yaks/query'
 * import { equal } from '@yaks/testing'
 *
 * let slug = 'me)|(.member.person=x'
 * equal(line`.space.slug=${slug}`, '.space.slug="me)|(.member.person=x"')
 * equal(line`.app=${['a', 'b c']}`, '.app=a,"b c"')
 * let mine = line`.member.person=${'p'}`
 * equal(line`.space&${sub(mine)}`, '.space&.member.person=p')
 * ```
 */
export let line = (
  parts: TemplateStringsArray,
  ...values: readonly Part[]
): Built =>
  parts.reduce((text, part, i) => text + written(values[i - 1]) + part) as Built

/** A line's text, put into another `line` as written. */
export let sub = (text: Built): Sub => new Sub(text)

/** A whole query its author wrote as one: a person's filter, a saved board's
 * line. A store reads it as written, and no other line splices it: a door
 * that narrows a person's query parses it and joins the trees. */
export let whole = (text: string): Line => text as Line

/** Built lines joined by `|` or `&`. Each arm of a `|` is grouped; under
 * `&`, only a line holding a top-level `|` is (`conjoin`), so a directive
 * such as `.limit` stays one. */
export let joined = (all: readonly Built[], by: '|' | '&'): Built =>
  (by == '|' ? all.map((l) => `(${l})`).join('|') : conjoin(...all)) as Built

/** A query a reader takes, `Q & Asked<Q>`: a line, a tree, or text written
 * in the source as one literal. A string put together at run time is none of
 * them, so it does not type-check.
 *
 * ```ts
 * import { type Asked, line, type Query } from '@yaks/query'
 *
 * let read = <Q extends string | Query>(q: Q & Asked<Q>) => q
 * let slug = 'me'
 * read('.space')
 * read(line`.space.slug=${slug}`)
 * // @ts-expect-error: text spliced together at run time
 * read(`.space.slug=${slug}`)
 * ```
 */
export type Asked<Q> = string extends Q ? Line : Q
