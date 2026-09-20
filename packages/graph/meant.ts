// Which component a bare column MEANS, read off the line it sits on.
//
// A word several components declare — `status`, on a graph that keeps both
// tasks and transcripts — is ambiguous to the VOCABULARY, which sees one word
// at a time and rightly refuses (@yaks/vocab's `Ambiguous`, which names the
// choices). It is rarely ambiguous to the LINE: `.task&.status=open` has
// already said what it is about, and so has `.task.project=P-19 .status=open`.
// So the vocabulary states the choices and this decides between them, from the
// only thing that knows: the rest of the sentence.
//
// The rule, in one line: a bare column resolves to the comp the line already
// SELECTS, when exactly one of the candidates is selected. Nothing on the line
// picking one leaves the word alone, and the refusal reaches the caller with
// its choices — a guess between `task` and `session` is worse than a question.
//
// What SELECTS a comp is a word that names it outright: a facet (`.task`), and
// a qualified path's head (`.task.project`, `.tally=task.status`). A bare
// column never selects — it is the thing being resolved — and neither does a
// dereference through a reference column, which is about the entity at the far
// end rather than this one.
//
// Scope follows the shape of the query. Conjoined clauses describe ONE row, so
// every sibling of an `and` contributes; the arms of an `or` do not describe
// the same row, so an arm sees its own words and whatever encloses it, never
// its neighbour's.

import {
  type Clause,
  type FieldSel,
  parse,
  type Query as Ast,
} from '@yaks/query'
import { Ambiguous, type Vocab } from '@yaks/vocab'
import type { Query } from './storage.ts'

/** Whether a predicate's single segment is the bare presence form — the one
 * place a lone word names a component rather than a column. */
let facet = (c: Clause & { kind: 'pred' }): boolean =>
  !!c.facet || (c.op == '!' && c.path.length == 1 && !c.value)

/** The component a path NAMES outright, or nothing. A qualified path says it
 * in its head; a facet says it in its only segment. */
let named = (v: Vocab, path: string[], bare: boolean): string | undefined => {
  let head = path[0]
  if (!head || !v.comp(head)) return undefined
  return path.length > 1 || bare ? head : undefined
}

/** Every component one clause names FOR CERTAIN, gathered into `out`. A
 * conjunction's clauses all hold, so all of them count; an alternative's arms
 * are exactly what is not certain, so none of them does — an arm's own words
 * reach it when that arm is read. */
let selects = (v: Vocab, c: Clause, out: Set<string>): void => {
  if (c.kind == 'and') {
    for (let k of c.clauses) selects(v, k, out)
  } else if (c.kind == 'pred') {
    let name = named(v, c.path, facet(c))
    if (name) out.add(name)
    if (c.where) selects(v, c.where, out)
  } else if (c.kind == 'distinct' || c.kind == 'tally' || c.kind == 'walk') {
    let name = named(v, c.path, false)
    if (name) out.add(name)
  } else if (c.kind == 'fields') {
    for (let f of c.fields) {
      let name = named(v, f.path, false)
      if (name) out.add(name)
    }
  }
}

/** The comps a whole clause list selects — the scope its bare columns read. */
let scope = (v: Vocab, clauses: Clause[]): Set<string> => {
  let out = new Set<string>()
  for (let c of clauses) selects(v, c, out)
  return out
}

/** One bare column, qualified by the scope, or left as it is. A word the
 * vocabulary routes on its own never reaches the scope at all. */
let resolve = (
  v: Vocab,
  path: string[],
  within: Set<string>,
): string[] => {
  if (path.length != 1) return path
  try {
    v.route(path[0])
    return path
  } catch (e) {
    if (!(e instanceof Ambiguous)) return path
    let picked = e.comps.filter((c) => within.has(c))
    return picked.length == 1 ? [picked[0], path[0]] : path
  }
}

/** A field selector, resolved in place. */
let selected = (v: Vocab, f: FieldSel, within: Set<string>): FieldSel => {
  let path = resolve(v, f.path, within)
  return path == f.path ? f : { ...f, path }
}

/** `.order=status` and `.order=-status` name a column the same way, so the
 * sign comes off and goes back on. A ranking (`.order=similar`) names no
 * column and routes to nothing, so it is left alone. */
let ordered = (v: Vocab, value: string, within: Set<string>): string => {
  let desc = value.startsWith('-')
  let field = desc ? value.slice(1) : value
  let path = resolve(v, [field], within)
  return path.length == 1 ? value : `${desc ? '-' : ''}${path.join('.')}`
}

/** A clause list read against one scope, unchanged when none of it moved. */
let all = (cs: Clause[], each: (c: Clause) => Clause): Clause[] => {
  let out = cs.map(each)
  return out.some((c, i) => c != cs[i]) ? out : cs
}

/** One clause with every bare column it holds read against `within` — the
 * scope it inherits, widened by whatever its own conjunction says. The clause
 * itself comes back when nothing in it moved, so an untouched line stays the
 * string the caller wrote. */
let read = (v: Vocab, c: Clause, within: Set<string>): Clause => {
  // Conjoined clauses describe ONE row, so every sibling contributes to the
  // scope; an alternative's arms describe different rows, so each reads with
  // its own words alone.
  if (c.kind == 'and') {
    let inner = new Set([...within, ...scope(v, c.clauses)])
    let clauses = all(c.clauses, (k) => read(v, k, inner))
    return clauses == c.clauses ? c : { ...c, clauses }
  }
  if (c.kind == 'or') {
    let clauses = all(
      c.clauses,
      (k) => read(v, k, new Set([...within, ...scope(v, [k])])),
    )
    return clauses == c.clauses ? c : { ...c, clauses }
  }
  if (c.kind == 'pred') {
    let path = resolve(v, c.path, within)
    let where = c.where ? read(v, c.where, within) : undefined
    if (path == c.path && where == c.where) return c
    return { ...c, path, ...(where ? { where } : {}) }
  }
  if (c.kind == 'distinct' || c.kind == 'tally') {
    let path = resolve(v, c.path, within)
    return path == c.path ? c : { ...c, path }
  }
  if (c.kind == 'fields') {
    let fields = c.fields.map((f) => selected(v, f, within))
    return fields.some((f, i) => f != c.fields[i]) ? { ...c, fields } : c
  }
  if (c.kind == 'order') {
    let value = ordered(v, c.value, within)
    return value == c.value ? c : { ...c, value }
  }
  return c
}

/**
 * The read door's half of routing: a query line in, the same line with every
 * bare column read as the comp the line already selects.
 *
 * The line comes back UNTOUCHED when nothing moved, so a line of qualified
 * paths costs one traversal and the text a caller handed in is what the store
 * still sees.
 *
 * ```ts
 * // let mean = meaning(vocab)
 * // mean('.task&.status=open')  // → the AST, over `.task.status`
 * ```
 */
export let meaning = (vocab: Vocab) => (query: Query): Query => {
  let ast: Ast = typeof query == 'string' ? parse(query) : query
  let within = scope(vocab, ast.clauses)
  let clauses = all(ast.clauses, (c) => read(vocab, c, within))
  return clauses == ast.clauses ? query : { ...ast, clauses }
}
