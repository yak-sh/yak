// Which component a bare property name means, decided from the rest of the
// query it appears in.
//
// A property name several components declare — `status`, on a graph holding
// both tasks and transcripts — is ambiguous to the vocabulary, which sees one
// name at a time and rightly refuses (@yaks/vocab's `Ambiguous`, whose message
// lists the candidates). It is rarely ambiguous within the query:
// `.task&.status=open` has already said what it is about, and so has
// `.task.project=P-19 .status=open`. So the vocabulary lists the candidates and
// this file chooses between them, using the only thing that knows: the rest of
// the query.
//
// The rule: a bare property resolves to the component the query already
// selects, when exactly one of the candidates is selected. If nothing in the
// query picks one, the property is left alone and the vocabulary's refusal
// reaches the caller with its list of candidates — guessing between `task` and
// `session` is worse than asking.
//
// What selects a component is anything that names it outright: a bare
// component (`.task`), or the head of a qualified path (`.task.project`,
// `.tally=task.status`). A bare property never selects — it is the thing being
// resolved — and neither does a dereference through a reference property, which
// is about the entity at the other end rather than this one.
//
// Scope follows the shape of the query. Conjoined clauses all describe one
// row, so every sibling of an `and` contributes; the branches of an `or` do
// not describe the same row, so a branch sees its own clauses and whatever
// encloses it, never its sibling branch's.

import {
  type Clause,
  type FieldSel,
  parse,
  type Query as Ast,
} from '@yaks/query'
import { Ambiguous, type Vocab } from '@yaks/vocab'
import type { Query } from './storage.ts'

/** Whether a predicate's single segment is the "component is present" form —
 * the one place a lone name means a component rather than a property. */
let facet = (c: Clause & { kind: 'pred' }): boolean =>
  !!c.facet || (c.op == '!' && c.path.length == 1 && !c.value)

/** The component a path names outright, or nothing. A qualified path names it
 * in its first segment; a presence test names it in its only segment. */
let named = (v: Vocab, path: string[], bare: boolean): string | undefined => {
  let head = path[0]
  if (!head || !v.comp(head)) return undefined
  return path.length > 1 || bare ? head : undefined
}

/** Every component one clause names for certain, collected into `out`. A
 * conjunction's clauses all hold, so all of them count; a disjunction's
 * branches are exactly what is not certain, so none of them counts — a
 * branch's own clauses are added when that branch is processed. */
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

/** The components a whole clause list selects — the scope its bare properties
 * resolve against. */
let scope = (v: Vocab, clauses: Clause[]): Set<string> => {
  let out = new Set<string>()
  for (let c of clauses) selects(v, c, out)
  return out
}

/** One bare property, qualified by the scope, or left as it is. A property name
 * the vocabulary can resolve on its own never consults the scope at all. */
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

/** `.order=status` and `.order=-status` name a property the same way, so the
 * leading `-` is stripped and put back. A ranking (`.order=similar`) names no
 * property and resolves to nothing, so it is left alone. */
let ordered = (v: Vocab, value: string, within: Set<string>): string => {
  let desc = value.startsWith('-')
  let field = desc ? value.slice(1) : value
  let path = resolve(v, [field], within)
  return path.length == 1 ? value : `${desc ? '-' : ''}${path.join('.')}`
}

/** Map every clause in a list, returning the original array when none of them
 * changed. */
let all = (cs: Clause[], each: (c: Clause) => Clause): Clause[] => {
  let out = cs.map(each)
  return out.some((c, i) => c != cs[i]) ? out : cs
}

/** One clause with every bare property in it resolved against `within` — the
 * scope it inherits, widened by whatever its own conjunction names. The
 * original clause is returned when nothing in it changed, so an unaffected
 * query stays the exact string the caller wrote. */
let read = (v: Vocab, c: Clause, within: Set<string>): Clause => {
  // Conjoined clauses describe one row, so every sibling contributes to the
  // scope; a disjunction's branches describe different rows, so each branch
  // resolves against its own clauses alone.
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
 * The read side of property resolution: a query in, the same query with every
 * bare property resolved to the component the query already selects.
 *
 * The query comes back unchanged when nothing was resolved, so a query written
 * with qualified paths costs one traversal, and the exact text the caller
 * passed is what storage still sees.
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
