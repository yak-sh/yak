// Parsing the MATCH half of a rule out of the query it is written as. A rule
// is not a second language: it is one or more ordinary @yaks/query patterns
// separated by `;`, one per entity, and the sigils already in the grammar
// express the rest — `+comp` ensures a component exists, `+!comp` also
// requires it did not already, `*comp` is the write set, `#Name` binds a
// resource, `$name` binds an entity, and a VALUE written `$name` is that same
// variable used as a value.
//
//   $call .call; .result, result.call=$call
//
// Two patterns, joined by the variable they share. Nothing was added to the
// grammar for that: `parse()` keeps raw tokens and leaves their meaning to a
// downstream compiler, so a scalar whose raw text begins with `$` is read HERE
// as the variable it plainly is, exactly as a bare `$name` is read as the
// pattern's entity.
//
// What this file produces is a PLAN, not SQL. A storage adapter lowers the
// plan to one statement through its own compiler — @yaks/sqlite does it
// through @yaks/sql's path-to-join lowering, where `+!comp` becomes a
// `LEFT JOIN … IS NULL` — and this package remains the one that knows nothing
// about any backend. Nothing here enumerates candidate rows: a rule's match is
// a query, and evaluating a query is storage's job.
//
// A variable is a SLOT, and what fills it depends on where it is written: a
// bare `$name` is the pattern's entity, and a `$name` in a value position is
// that column. Two slots sharing a name hold the same value, which is what
// joins the patterns; a slot in a `+` clause SUPPLIES the value instead, which
// is how a template's arguments work (T-37570). Deciding which is which is the
// compiler's job, not the grammar's.

import {
  type And,
  bare,
  type Clause,
  declared,
  eq,
  parse,
  type Pred,
  scalar,
  type Value,
} from '@yaks/query'
import type { Set as Sets } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { Eid } from './bundle.ts'

/** A column tied to a variable: the raw path as written, and the name. */
export type Bind = { path: string[]; name: string }

/** One result of a match: the entity each pattern bound, in the order the
 * patterns were written, and the value each variable took. A pattern that
 * CREATES an entity (one that only writes) binds nothing, so its slot is
 * `null`. */
export type Binding = {
  entities: (Eid | null)[]
  vars: Record<string, unknown>
}

/** One entity's pattern — everything one `;`-separated section declares. */
export type Pattern = {
  /** a bare `$name`: the variable this pattern's ENTITY binds to */
  entity?: string
  /** the clauses that FILTER, with every variable removed from them */
  filter: And
  /** `+!comp` — must be absent, and is added before the rule runs */
  gates: string[]
  /** `+comp` — added before the rule runs */
  ensures: string[]
  /** `*comp` — what the rule writes */
  writes: string[]
  /** `#Name` — the resources it reads */
  resources: string[]
  /** the columns a variable binds this pattern to */
  binds: Bind[]
  /** `+comp.col=value` — the columns it writes */
  sets: Sets[]
  /** nothing to match on: every clause writes, so this pattern CREATES an
   * entity, one per result of the patterns that do match */
  makes: boolean
}

/** A rule's match, parsed: its patterns and every variable they name. */
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

// The individual patterns in a rule's source. `;` separates entities and
// nothing else in this grammar uses it, so splitting on it is the whole parse.
let halves = (source: string): string[] =>
  source.split(';').map((s) => s.trim()).filter(Boolean)

// One pattern, parsed. `declared()` separates the sigil clauses from the
// filter — the same reading every rule has always had — and then the variables
// are removed from the filter, because comparing a column against the literal
// text `$session` would match nothing.
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
    sets: d.sets,
    // A pattern with no conditions is not a pattern that matches everything:
    // with no filter, no `+!` clause, no entity variable and no bound column,
    // the only thing it declares is what to write, so it CREATES the entity it
    // writes to.
    makes: !clauses.length && !d.gates.length && !d.vars.length &&
      !binds.length && !d.writes.length,
  }
}

/**
 * Parse a rule's match out of its source text.
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
 * Every component a match READS — what storage's overlay of the pending change
 * has to cover for the compiled statement to see that change. `+!` clauses
 * count too: testing that a component is absent is still a read. A bare column
 * name is resolved through the vocabulary, since `.title` means `doc.title`.
 */
export let reads = (m: Match, v: Vocab): string[] => {
  let out = new Set<string>()
  let path = (p: string[], facet = false) => {
    // A reverse association names the component on the FAR side (`.reviews`
    // is `review.product` seen from the product), and that is the component
    // the overlay has to cover for the traversal to see the pending change.
    let far = v.assoc(p[0])
    if (far) return void out.add(far.comp)
    try {
      for (let hop of v.aim(p.join('.'), facet)) out.add(hop.comp)
    } catch {
      // A name this vocabulary does not declare belongs to a rule that can
      // never fire here; covering the name itself costs nothing and loses
      // nothing.
      out.add(p[0])
    }
  }
  let walk = (clauses: And['clauses']) => {
    for (let c of clauses) {
      if (c.kind == 'and' || c.kind == 'or') walk(c.clauses)
      else if (c.kind == 'pred') path(c.path, bare(c))
      // `-comp` reads the change's own component removals, which the overlay
      // carries only for the components it covers — so a removal is a read
      // too.
      else if (c.kind == 'gone') out.add(c.comp)
    }
  }
  for (let p of m.patterns) {
    if (p.makes) continue
    walk(p.filter.clauses)
    for (let b of p.binds) path(b.path)
    for (let c of [...p.gates, ...p.ensures, ...p.writes]) out.add(c)
  }
  return [...out]
}

/**
 * A template INVOCATION: the template's query merged with a bindings-only
 * query built from the call's arguments.
 *
 * Nothing new is introduced here, which is the whole point. A template is a
 * rule; its arguments are `$x=5`, which is a query; merging them is the
 * conjunction of two clause lists. Where a bound variable sits decides what it
 * does, and that was already how variables worked: in a MATCH clause it
 * constrains (the column must equal the argument), in a `+` clause it SUPPLIES
 * (the column is written with it), and in both it does both.
 *
 * ```ts
 * import { filled, match } from '@yaks/graph'
 *
 * // `+foo.bar=$x` merged with `$x=5` writes a new entity with bar=5
 * filled(match('+foo.bar=$x'), { x: 5 }).patterns[0].sets
 * ```
 */
export let filled = (
  m: Match | string,
  args: Record<string, unknown> | string,
): Match => {
  let plan = typeof m == 'string' ? match(m) : m
  let values = typeof args == 'string' ? bound(args) : args
  let patterns = plan.patterns.map((p) => {
    let clauses = [...p.filter.clauses]
    // A bound variable in a MATCH position is an ordinary predicate again:
    // the column must equal what the argument said.
    let binds = p.binds.filter((b) => {
      if (!(b.name in values)) return true
      clauses.push(eq(b.path.join('.'), String(values[b.name])))
      return false
    })
    // In a WRITE position it supplies the value instead.
    let sets = p.sets.map((s) => {
      let name = variable(s.value)
      return name && name in values
        ? { ...s, value: scalar(String(values[name])) }
        : s
    })
    // Binding the pattern's ENTITY variable pins it to one entity: the pattern
    // is about that row and no other.
    let entity = p.entity
    if (entity && entity in values) {
      clauses.push(eq('entity.eid', String(values[entity])))
      entity = undefined
    }
    return {
      ...p,
      ...(entity ? { entity } : { entity: undefined }),
      filter: { kind: 'and' as const, clauses },
      binds,
      sets,
      // A pattern that only wrote still only writes; one that gained a filter
      // clause now matches instead, which is what constraining it means.
      makes: p.makes && !clauses.length,
    }
  })
  return {
    patterns,
    vars: plan.vars.filter((name) => !(name in values)),
  }
}

/** The bindings a query carries: every `$name=value` in it, as plain values.
 * A query consisting of nothing but these is how a call's arguments are
 * written. */
export let bound = (source: string): Record<string, unknown> =>
  Object.fromEntries(
    declared(parse(source, { text: false })).values.map((
      [name, v],
    ) => [name, v.kind == 'scalar' || v.kind == 'time' ? v.raw : v]),
  )

/**
 * This match as THIS vocabulary can evaluate it, or `null` when it cannot be
 * evaluated at all.
 *
 * A component a vocabulary does not declare cannot be present on anything in
 * its graph. So a clause requiring that component to be ABSENT holds for every
 * entity here and is dropped; one requiring it to be PRESENT holds for none,
 * and the pattern containing it can never fire. That is what lets ONE rule
 * text be correct in two different graphs: `!wake` constrains nothing in a
 * graph that never schedules anything, and constrains the result in one that
 * does.
 */
export let asked = (m: Match, v: Vocab): Match | null => {
  // Does this vocabulary declare the name at all? Asked of its own tables
  // rather than through `aim`, which deliberately treats a BARE name as a
  // possibly-undeclared component — a bundle may carry one before its schema
  // is loaded, and that tolerance is exactly what this question must not
  // inherit.
  let known = (path: string[]): boolean => {
    if (v.assoc(path[0]) || v.comp(path[0])) return true
    try {
      v.aim(path.join('.'))
      return true
    } catch {
      return false
    }
  }
  // Both `!comp` and `.col=`: the value-less `=` the grammar reads as "this is
  // absent".
  let absent = (c: Pred): boolean =>
    c.op == '=' && c.value?.kind == 'scalar' && c.value.raw === ''
  let prune = (c: Clause): Clause | boolean => {
    if (c.kind == 'and' || c.kind == 'or') {
      let kids = c.clauses.map(prune)
      let all = c.kind == 'and'
      if (kids.some((k) => k === !all)) return !all
      let kept = kids.filter((k) => k !== all) as Clause[]
      return kept.length ? { ...c, clauses: kept } : all
    }
    // A component this vocabulary never declared cannot be REMOVED here
    // either, so a pattern requiring that never fires rather than being
    // dropped — the opposite of an absence test, which is trivially true when
    // the component cannot exist.
    if (c.kind == 'gone') return known([c.comp]) && c
    if (c.kind != 'pred' || known(c.path)) return c
    return absent(c)
  }
  let patterns: Pattern[] = []
  for (let p of m.patterns) {
    if (p.makes || !p.filter.clauses.length) {
      patterns.push(p)
      continue
    }
    if (p.binds.some((b) => !known(b.path))) return null
    let filter = prune(p.filter)
    if (filter === false) return null
    patterns.push({
      ...p,
      filter: filter === true ? { kind: 'and', clauses: [] } : filter as And,
    })
  }
  return { ...m, patterns }
}
