// A rule's MATCH half, read off the query it is written as. A rule is not a
// second language: it is one or more ordinary @yaks/query patterns separated
// by `;`, one per entity, and the sigils already in the grammar say the rest —
// `+comp` ensures, `+!comp` gates, `*comp` is the write set, `#Name` binds a
// resource, `$name` names an entity, and a VALUE spelled `$name` is that same
// variable used as a value.
//
//   $call .call; .result, result.call=$call
//
// Two patterns, joined by the variable they share. Nothing was added to the
// grammar to say that: `parse()` keeps raw tokens and leaves the meaning to a
// downstream compiler (its own words), so a scalar whose raw text begins with
// `$` is read HERE as the variable it plainly is, exactly as `$name` alone is
// read as the entity's.
//
// What this file answers is a PLAN, not SQL. A storage lowers the plan to one
// statement through its own compiler — @yaks/sqlite does it through @yaks/sql's
// path-to-join lowering, where a gate is a LEFT JOIN … IS NULL — and this
// package stays the one that knows no backend. There is no candidate
// gathering: a rule's match is a query, and a query is something storage
// answers.
//
// A variable is a SLOT, and what fills it is decided by where it is written: a
// bare `$name` is the pattern's entity, a `$name` in a value is that column.
// Two slots sharing a name are the same value, which is the join; a slot in a
// `+` clause SUPPLIES it instead, which is what a template's arguments are
// (T-37570). Reading which is which is the compiler's, not the grammar's.

import {
  type And,
  bare,
  declared,
  parse,
  type Pred,
  type Value,
} from '@yaks/query'
import type { Vocab } from '@yaks/vocab'

/** A column tied to a variable: the raw path as written, and the name. */
export type Bind = { path: string[]; name: string }

/** One entity's pattern — everything one `;`-separated half says. */
export type Pattern = {
  /** `$name` alone: the variable this pattern's ENTITY binds to */
  entity?: string
  /** the clauses that FILTER, with every variable taken out of them */
  filter: And
  /** `+!comp` — must be absent, and is added before the rule runs */
  gates: string[]
  /** `+comp` — added before the rule runs */
  ensures: string[]
  /** `*comp` — what the rule writes */
  writes: string[]
  /** `#Name` — the singletons it reads */
  resources: string[]
  /** the columns a variable ties this pattern to */
  binds: Bind[]
}

/** A rule's match, read: its patterns and every variable they name. */
export type Match = {
  patterns: Pattern[]
  /** every variable, in the order it was first written */
  vars: string[]
}

/** Is this value a variable reference — a scalar whose text begins with `$`? */
export let variable = (v: Value | null): string | null =>
  v && v.kind == 'scalar' && v.raw.startsWith('$') && v.raw.length > 1
    ? v.raw.slice(1)
    : null

// The pattern halves of a rule source. `;` separates entities and nothing
// else in this grammar spells it, so splitting is the whole reading.
let halves = (source: string): string[] =>
  source.split(';').map((s) => s.trim()).filter(Boolean)

// One half, read. The sigils come off through `declared()` — the same reading
// every rule has always had — and then the variables come out of the filter,
// because a literal `$session` compared against a column matches nothing.
let pattern = (text: string): Pattern => {
  let d = declared(parse(text, { text: false }))
  let binds: Bind[] = []
  let clauses = d.filter.clauses.filter((c) => {
    if (c.kind != 'pred') return true
    let name = variable((c as Pred).value)
    if (!name) return true
    binds.push({ path: (c as Pred).path, name })
    return false
  })
  if (d.vars.length > 1) {
    throw new Error(
      `a pattern names one entity, not ${d.vars.map((v) => `$${v}`).join(' ')}`,
    )
  }
  return {
    ...(d.vars.length ? { entity: d.vars[0] } : {}),
    filter: { kind: 'and', clauses },
    gates: d.gates,
    ensures: d.ensures,
    writes: d.writes,
    resources: d.resources,
    binds,
  }
}

/**
 * Read a rule's match off its source.
 *
 * ```ts
 * import { match } from '@yaks/graph'
 *
 * let m = match('$call .call; .result, result.call=$call')
 * m.vars // ['call']
 * m.patterns[1].binds // [{ path: ['result', 'call'], name: 'call' }]
 * ```
 */
export let match = (source: string): Match => {
  let patterns = halves(source).map(pattern)
  if (!patterns.length) throw new Error('a rule needs a pattern')
  let vars: string[] = []
  let see = (name: string) => {
    if (!vars.includes(name)) vars.push(name)
  }
  for (let p of patterns) {
    if (p.entity) see(p.entity)
    for (let b of p.binds) see(b.name)
  }
  return { patterns, vars }
}

/**
 * Every component a match READS — what a batch overlay has to cover for the
 * statement to see this batch. Gates included: an absence is a read too, and a
 * bare word is routed through the vocabulary, since `.title` is `doc`.
 */
export let reads = (m: Match, v: Vocab): string[] => {
  let out = new Set<string>()
  let path = (p: string[], facet = false) => {
    for (let hop of v.aim(p.join('.'), facet)) out.add(hop.comp)
  }
  let walk = (clauses: And['clauses']) => {
    for (let c of clauses) {
      if (c.kind == 'and' || c.kind == 'or') walk(c.clauses)
      else if (c.kind == 'pred') path(c.path, bare(c))
    }
  }
  for (let p of m.patterns) {
    walk(p.filter.clauses)
    for (let b of p.binds) path(b.path)
    for (let c of [...p.gates, ...p.ensures, ...p.writes]) out.add(c)
  }
  return [...out]
}
