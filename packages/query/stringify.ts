// The printer: an AST back to the query text `parse` reads. A storage that
// speaks text across a wire (a store's `/query?q=`) takes a parsed or built
// tree here, never `String(ast)`, which writes `[object Object]` and asks for
// nothing at all.
//
// It writes what `parse` reads back to the same tree: terms joined by `&`, an
// `or` grouped wherever it sits beside other terms, a value quoted where the
// grammar would read it as structure. A few trees have no text form, because
// the grammar has no way to say them (README, Separators, grouping, and
// quoting): an equality on a value holding a comma or a range marker, a
// reverse association whose child test is not a single predicate. Those throw
// rather than write a different query.

import type { Clause, Pred, Value } from './ast.ts'
import { parseDot } from './parse.ts'

let unwritable = (what: string) =>
  new SyntaxError(`${what} cannot be written as a query line`)

// A value the tokenizer or an operator would read as structure, quoted.
let SPECIAL = /[\s&|()"']|^[=<>~!-]|^$/
let quoted = (raw: string) => `"${raw.replace(/["'\\]/g, '\\$&')}"`
let plain = (raw: string) => SPECIAL.test(raw) ? quoted(raw) : raw

// A value as raw text. A value is split on commas and read for `..` after its
// quotes come off, so neither can be quoted away inside a scalar, and a range's
// bounds are scalars.
let raw = (v: Value): string => {
  if (v.kind == 'scalar' || v.kind == 'time') {
    if (/,|\.\./.test(v.raw)) throw unwritable(`the value ${v.raw}`)
    return v.raw
  }
  if (v.kind == 'list' || v.lo.kind == 'range' || v.hi.kind == 'range') {
    throw unwritable('a value nested in a value')
  }
  let lo = raw(v.lo), hi = raw(v.hi)
  if (lo.endsWith('.') || hi.startsWith('.')) throw unwritable(`${lo}..${hi}`)
  return `${lo}${v.exclusiveEnd ? '...' : '..'}${hi}`
}
let value = (v: Value): string =>
  v.kind == 'list'
    ? v.items.map((item) => plain(raw(item))).join(',')
    : plain(raw(v))

// A bare word is a text term unless it reads as a clause, a group, `*` (or
// `?*`) or a list; then it is quoted.
let word = (s: string): string => {
  let clause = true
  try {
    clause = s == '*' || s == '?*' || parseDot(s) != null
  } catch { /* a malformed clause is not a word either */ }
  return clause || /[\s&|(),"'[\]]|^$/.test(s) ? quoted(s) : s
}

let path = (p: string[]) => p.join('.')

let pred = (c: Pred): string => {
  if (c.where || c.not) return reverse(c)
  let p = path(c.path)
  if (c.op == '!') return `.${p}`
  if (c.op == '?') return `?${p}`
  let v = c.value!
  if (c.op == '=' && v.kind == 'scalar' && v.raw == '') return `!${p}`
  // Contains is one literal scalar, commas and all.
  if (c.op == '~=') {
    if (v.kind != 'scalar') throw unwritable('a contains test on a list')
    return `.${p}~=${v.raw.includes(',') ? quoted(v.raw) : plain(v.raw)}`
  }
  return `.${p}${c.op}${value(v)}`
}

// `.comments!.status=done` (none), `.comments.reviews!.stars=5` (some comment
// whose reviews have none at five): the child test follows the association
// with its own leading dot, and a `!` between says none rather than some.
let reverse = (c: Pred): string => {
  let [assoc, ...rest] = c.path
  if (!c.where && !rest.length) throw unwritable('a reverse test with no child')
  let child = c.where ?? { ...c, path: rest, not: undefined }
  let inner = child.kind == 'pred' ? pred(child) : ''
  if (!inner.startsWith('.')) throw unwritable('this reverse association')
  return c.where
    ? `.${path(c.path)}${c.not ? '!' : ''}${inner}`
    : `.${assoc}!${inner}`
}

// The terms of a conjunction, nested ones spliced in and `never` left out.
let terms = (c: Clause): Clause[] =>
  c.kind == 'and' ? c.clauses.flatMap(terms) : c.kind == 'never' ? [] : [c]

let joined = (cs: Clause[]): string => {
  let ts = cs.flatMap(terms)
  return ts.map((t) => t.kind == 'or' && ts.length > 1 ? `(${one(t)})` : one(t))
    .join('&')
}

let one = (c: Clause): string => {
  switch (c.kind) {
    case 'and':
      return joined(c.clauses)
    case 'or':
      return c.clauses.map((a) =>
        a.kind == 'or' ? `(${one(a)})` : a.kind == 'and' ? joined([a]) : one(a)
      ).join('|')
    case 'never':
      return ''
    case 'pred':
      return pred(c)
    case 'text':
      return word(c.value)
    case 'order':
    case 'near':
      return `.${c.kind}=${plain(c.value)}`
    case 'refs':
      return c.op == '!'
        ? '.refs'
        : c.value
        ? `.refs=${plain(c.value)}`
        : '!refs'
    case 'count':
      return '.count'
    case 'distinct':
    case 'tally':
      return `.${c.kind}=${path(c.path)}`
    case 'fields':
      return `.fields=${
        c.fields.map((f) => path(f.path) + (f.wake ? '' : '~')).join(',')
      }`
    case 'every':
      return '*'
    case 'limit':
      return `.limit=${c.n}`
    case 'after':
      return `.after=${'n' in c ? c.n : c.eid}`
    case 'edges': {
      let s = c.select
      return [
        s ? `.edges[${s.type}${s.via ? ',' + path(s.via) : ''}]` : '',
        c.limit == null ? '' : `.edges.limit=${c.limit}`,
        c.peers.length ? `.edges.peers=${c.peers.map(path).join(',')}` : '',
      ].filter(Boolean).join('&') || '.edges'
    }
    case 'walk':
      return `.${path(c.path)}${c.depth ? `[<=${c.depth}]` : ''}${c.dir}${
        plain(c.target)
      }`
    case 'ensure':
    case 'mutable': {
      let mark = c.kind == 'ensure' ? '+' : '*'
      return c.prop
        ? `${mark}${c.comp}.${c.prop}=${value(c.value!)}`
        : mark + c.comp
    }
    case 'gate':
      return `+!${c.comp}`
    case 'resource':
      return `#${c.comp}`
    case 'gone':
      return `-${c.comp}`
    case 'var':
      return c.value ? `$${c.name}=${value(c.value)}` : `$${c.name}`
  }
}

/**
 * A query as text: a line stays as it was written, and a tree is written in
 * the grammar `parse` reads back to the same tree. The inverse of `parse`, for
 * any door that only carries text.
 *
 * ```ts
 * import { and, eq, or, parse, present, want, stringify } from '@yaks/query'
 * import { equal } from '@yaks/testing'
 *
 * equal(stringify(and(eq('doc.title', 'Two words'), want('entity'))),
 *   '.doc.title="Two words"&?entity')
 * equal(stringify(and(present('a'), or(eq('b', 1), eq('c', 2)))),
 *   '.a&(.b=1|.c=2)')
 * equal(stringify('.a=1 .b=2'), '.a=1 .b=2')
 * equal(parse(stringify(parse('.comments.reviews!.stars=5'))),
 *   parse('.comments.reviews!.stars=5'))
 * ```
 */
export let stringify = (q: string | Clause): string =>
  typeof q == 'string' ? q : one(q)
