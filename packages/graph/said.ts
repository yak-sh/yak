// Resolving the ids written in a query to the eids they refer to.
//
// A person types the id they can remember — `T-37584`, `jeff` — while the
// store keys rows by eid, and every entry point owes them that translation:
// `addressed()` (tool.ts) does it for a tool's arguments, and @yaks/alias's
// normalize hook does it for a change's reference properties. Reads did not, so
// `.decided.by=jeff` matched nothing while `.decided.by=<eid>` matched.
//
// A query names an entity in exactly five places: the entity's own eid
// (`.eid=T#47e9678bdf`), a reference property's value (`.decided.by=jeff`),
// the reverse-reference filter `.refs=`, a walk's target (`.requires->T-42`)
// and the neighbour filter `.near=`. Nowhere else —
// `.status=done` is an enum, and a value that happens to be somebody's name
// must not be turned into their eid just because it sat on a scalar property.
//
// Which properties are references is the vocabulary's to say, so this takes
// one; which entity a name belongs to is a plugin's, so `addressing` takes an
// `address` function between its two halves.

import { type Clause, parse, type Query as Ast, type Value } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Eid } from './bundle.ts'
import type { Query } from './storage.ts'
import { then } from './pipe.ts'

/** What one id maps to. Collecting the ids and rewriting them are the same
 * traversal with two different functions of this type. */
type Says = (id: string) => string

/** Whether a predicate's leaf is a reference property — the only kind of
 * predicate whose value is an entity. A path's earlier segments dereference
 * through properties; its leaf is what the value is compared against. */
let refs = (vocab: Vocab, c: Clause & { kind: 'pred' }): boolean => {
  // Only the two equality forms compare a whole id. `~=` is a substring of
  // whatever is stored, and a range of eids means nothing.
  if (c.op != '=' && c.op != '!=') return false
  // The entity's own eid names the entity it is.
  let [first, second] = c.path
  if (
    c.path.length == 1
      ? first == 'eid'
      : c.path.length == 2 && first == 'entity' && second == 'eid'
  ) {
    return true
  }
  let hops
  try {
    hops = vocab.aim(c.path.join('.'), c.facet)
  } catch {
    return false
  }
  let leaf = hops[hops.length - 1]
  return !!leaf?.prop && vocab.prop(leaf.comp, leaf.prop)?.category == 'ref'
}

/** A value's id-shaped leaves, mapped. A list means any-of, so each item names
 * an entity; a range and a relative time expression name none. An empty scalar
 * is the "property is absent" form (`.decided.by=`) and names nothing either.
 */
let value = (v: Value, f: Says): Value =>
  v.kind == 'scalar'
    ? (v.raw ? { ...v, raw: f(v.raw) } : v)
    : v.kind == 'list'
    ? { ...v, items: v.items.map((i) => value(i, f)) }
    : v

/** One clause with every id that names an entity mapped through `f`. */
let mapped = (vocab: Vocab, c: Clause, f: Says): Clause =>
  c.kind == 'and' || c.kind == 'or'
    ? { ...c, clauses: c.clauses.map((k) => mapped(vocab, k, f)) }
    : c.kind == 'refs'
    ? (c.op == '=' && c.value ? { ...c, value: f(c.value) } : c)
    : c.kind == 'walk'
    ? { ...c, target: f(c.target) }
    : c.kind == 'near'
    ? (c.value ? { ...c, value: f(c.value) } : c)
    : c.kind == 'pred'
    ? {
      ...c,
      ...(c.where ? { where: mapped(vocab, c.where, f) } : {}),
      ...(c.value && refs(vocab, c) ? { value: value(c.value, f) } : {}),
    }
    : c

/**
 * The read side of name resolution: a query in, the same query with every id
 * it names replaced by the eid it refers to, resolved through `address` in one
 * round trip.
 *
 * The query comes back unchanged when it names no entity, and when nothing it
 * names resolved to something else — a query written with plain eids costs one
 * traversal and no lookup, and the exact text the caller passed is what
 * storage still sees.
 *
 * ```ts
 * // let aim = addressing(vocab)
 * // await aim('.decided.by=jeff', graph.address)  // → the AST, by eid
 * ```
 */
export let addressing = (vocab: Vocab) =>
(
  query: Query,
  address: (ids: string[]) => Map<string, Eid> | Promise<Map<string, Eid>>,
): Query | Promise<Query> => {
  let ast: Ast = typeof query == 'string' ? parse(query) : query
  let said: string[] = []
  mapped(vocab, ast, (id) => (said.push(id), id))
  if (!said.length) return query
  return then(
    address([...new Set(said)]),
    (at) =>
      at.size ? mapped(vocab, ast, (id) => at.get(id) ?? id) as Ast : query,
  )
}
