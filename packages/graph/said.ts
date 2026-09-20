// The ids a QUERY LINE says out loud, as the eids they name.
//
// A person types the id they can say — `T-37584`, `jeff` — where the store
// keys by eid, and every door owes them that: it is what `addressed()`
// (tool.ts) does for a tool's argument, and what @yaks/alias's normalize hook
// does for a batch's reference columns. The read door owed it too and never
// paid, so `.decided.by=jeff` answered nothing while `.decided.by=<eid>`
// answered.
//
// A line names an entity in exactly four places: a reference column's value
// (`.decided.by=jeff`), the backlink `.refs=`, a walk's target
// (`.requires->T-42`) and the neighbour `.near=`. Nowhere else — `.status=done`
// is an enum, and a word that happens to be somebody's name must not become
// their eid because it sat on a scalar column.
//
// Which columns are references is the VOCABULARY's to say, so this takes one;
// who a name belongs to is a PLUGIN's, so `addressing` asks for `address`
// between its two halves.

import { type Clause, parse, type Query as Ast, type Value } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Eid } from './bundle.ts'
import type { Query } from './storage.ts'
import { then } from './pipe.ts'

/** What a token becomes. Collecting the ids and addressing them are the same
 * traversal under two of these. */
type Says = (id: string) => string

/** Whether a predicate's LEAF names a reference column — the only predicate
 * whose value is an entity. A path's earlier hops are dereferences; its leaf is
 * what the value is compared against. */
let refs = (vocab: Vocab, c: Clause & { kind: 'pred' }): boolean => {
  // Only the two equality forms compare a whole id. `~=` is a substring of
  // whatever is stored, and a range of eids means nothing.
  if (c.op != '=' && c.op != '!=') return false
  let hops
  try {
    hops = vocab.aim(c.path.join('.'), c.facet)
  } catch {
    return false
  }
  let leaf = hops[hops.length - 1]
  return !!leaf?.prop && vocab.column(leaf.comp, leaf.prop)?.category == 'ref'
}

/** A value's id-shaped leaves, mapped. A list is any-of, so each item names an
 * entity; a range and a time phrase name none. An empty scalar is the ABSENT
 * form (`.decided.by=`) and names nothing either. */
let value = (v: Value, f: Says): Value =>
  v.kind == 'scalar'
    ? (v.raw ? { ...v, raw: f(v.raw) } : v)
    : v.kind == 'list'
    ? { ...v, items: v.items.map((i) => value(i, f)) }
    : v

/** One clause with every entity-naming token mapped. */
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
 * The read door's half of addressing: a query line in, the same line with every
 * id it names read as the eid it names, asked of `address` in one round trip.
 *
 * The line comes back UNTOUCHED when it names no entity, and when nothing it
 * names moved — a line of plain eids costs a traversal and no lookup, and the
 * text a caller handed in is what the store still sees.
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
