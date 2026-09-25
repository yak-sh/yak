// A rule's match, as one statement. @yaks/graph parses a rule's source into a
// plan (its join.ts: patterns, gates, variables); this lowers that plan to SQL
// through the ordinary path-to-join binding (./bind.ts), so a rule is compiled
// by the same compiler as every other query and there is no second evaluator
// to keep in step.
//
// What makes several entities fit in one SELECT is the dialect. A dialect names
// every table, alias, join key and column expression, so each pattern is bound
// through one whose names carry that pattern's prefix (`p0_doc`, `p1_entity`),
// and the resulting selects can simply be put side by side: their sources
// cross, their joins gather, their conditions AND. One statement, no candidate
// sets, nothing gathered per rule by the caller.
//
// A gate lowers to a LEFT JOIN whose owner column IS NULL. It gets an alias of
// its own (`p0_gate_result`) because a gate is an absence — the query never
// reads its columns, and a separate alias cannot collide with a join the filter
// already made for the same component.
//
// A variable is a slot. `$call` alone is the pattern's entity (its integer
// spine id); `$call` as a value is that property. Two slots sharing a name are
// equated, which is the join, and an id compares to an id — a reference column
// stores the target's integer id, so joining a reference to an entity is an
// integer compare, never an eid round trip. Mixing an id slot with a value
// slot is rejected rather than coerced.
//
// Read against a batch (@yaks/sqlite's overlay) the same statement sees the
// graph with the batch in it: the overlay is a `with` prefix of CTEs, and `at`
// points each covered component at its CTE, so what changes is a name.
//
// One clause cannot be expressed that way, because it is not about a row at
// all: `-comp` asks what the batch removed, and a removed row is
// indistinguishable from a row that was never there. So the overlay keeps a
// list of what it removed, and `gone` names it.

import type { Vocab } from '@yaks/vocab'
import { type And, present } from '@yaks/query'
import {
  among,
  and,
  col,
  type Expr,
  FALSE,
  type Join,
  or,
  raw,
  type Select,
  select,
  type Source,
  table,
} from './ast.ts'
import { q } from './render.ts'
import { type BindOpts, bound } from './bind.ts'
import type { Extension } from './extend.ts'
import { type Dialect, refEqAt, sqlite } from './sqlite.ts'

/** A rule's match as this statement reads it — @yaks/graph's `Match`, named
 * here by its shape because @yaks/graph sits above this package. */
export type Plan = {
  patterns: {
    entity?: string
    filter: And
    gates: string[]
    binds: { path: string[]; name: string }[]
    makes: boolean
  }[]
}

/** Where a component is read from: the name of its table, or of a CTE that
 * stands in for it. */
export type At = (comp: string) => string

/** The name of the list of entities a batch removed a component from, or
 * `null` where it removed none. */
export type Gone = (comp: string) => string | null

/**
 * What a statement is asked against: the sources to read (an overlay's, or
 * the tables for the committed graph), where the batch's deletions are read
 * from (`-comp`), and the entity ids the batch moved, which every match is
 * narrowed to.
 */
export type On = { at?: At; gone?: Gone; touched?: number[] }

// The SQLite dialect, renamed. Every alias it hands out carries `pre`, so two
// of these bind two patterns into one statement without a single name in
// common. The value lowerings are untouched — what a comparison means is not a
// matter of what a table is called.
let prefixed = (pre: string, at: At): Dialect => {
  let from = (comp: string) => q(at(comp))
  let own = (base: string) =>
    base == 'entity' ? `${q(pre + 'entity')}."id"` : `${q(pre + base)}."entity"`
  return {
    ...sqlite,
    name: `sqlite:${pre}`,
    spine: `${from('entity')} ${q(pre + 'entity')}`,
    membership: `${q(pre + 'entity')}."eid" as eid`,
    live: () => ({
      sql: `not exists (select 1 from tombstone ${q(pre + 'tomb')} where ` +
        `${q(pre + 'tomb')}."entity" = ${q(pre + 'entity')}."id")`,
      params: [],
    }),
    table: (comp) => `${from(comp)} ${q(pre + comp)}`,
    source: from,
    refEq: refEqAt(from('entity')),
    ownerKey: own,
    joinOn: (comp, base) => `${q(pre + comp)}."entity" = ${own(base)}`,
    refCol: (comp, prop) => `${q(pre + comp)}.${q(prop)}`,
    presence: (comp) => ({
      sql: `${q(pre + comp)}."entity" is not null`,
      params: [],
    }),
    // No archetype key: the batch overlay mints entities that have no
    // archetype yet, and a plan that matched on one would not see them.
    archetype: undefined,
    col: (comp, prop, v) => {
      if (comp == 'entity' && v.prop(comp, prop)?.category != 'ref') {
        return `${q(pre + 'entity')}.${q(prop)}`
      }
      if (prop == 'eid') return `${q(pre + comp)}."entity"`
      let c = v.prop(comp, prop)
      if (!c) return null
      return c.category == 'ref'
        ? `(select __re.eid from ${from('entity')} __re where __re.id = ${
          q(pre + comp)
        }.${q(prop)})`
        : `${q(pre + comp)}.${q(prop)}`
    },
  }
}

// The deletion clause, lowered: an owner in the overlay's list of what the
// batch removed. With no overlay under the statement nothing was removed, and
// the clause is false: a match run against the committed rows alone is about
// what is stored, never about what was removed.
let removals = (gone: Gone): Extension => ({
  name: 'gone',
  compile: {
    gone: (c, site) => {
      let src = c.kind == 'gone' ? gone(c.comp) : null
      return src
        ? among(site.owner, select({ cols: [col('entity')], from: table(src) }))
        : FALSE
    },
  },
})

// Where a variable is filled from, and what kind of value fills it: an `id` is
// an integer spine id (an entity, or a reference column), a `value` is the
// column's own. `read` is how the same slot is projected — an eid for an id,
// so what comes back is the word a patch would write.
type Slot = { kind: 'id' | 'value'; sql: string; read: string }

/**
 * A rule's match as one select: one `e<i>` column per pattern (its eid), one
 * `v_<name>` column per variable. Put an overlay's CTEs in its `with` to read
 * it against a batch.
 */
export let rule = (
  m: Plan,
  vocab: Vocab,
  opts: BindOpts = {},
  on: On = {},
): Select => {
  let at = on.at ?? ((comp: string) => comp)
  let touched = on.touched
  let extend = [...(opts.extend ?? []), removals(on.gone ?? (() => null))]
  let froms: Source[] = []
  let joins: Join[] = []
  let conds: Expr[] = []
  let cols: Expr[] = []
  let anchors: string[] = []
  let slots = new Map<string, Slot[]>()
  let slot = (name: string, s: Slot) => {
    let held = slots.get(name) ?? []
    held.push(s)
    slots.set(name, held)
  }

  m.patterns.forEach((p, i) => {
    // A pattern that only writes matches nothing: it makes its entity, one
    // per binding of the patterns that do match, so it contributes no table.
    if (p.makes) return
    let pre = `p${i}_`
    let d = prefixed(pre, at)
    // A bound column has to be joined, and a bind implies the component is
    // there — so a presence clause is added, and the binder makes the join it
    // always would. A component the filter already named is joined once: the
    // binder keeps its tables in a set.
    let needs = p.binds.map((b) => vocab.aim(b.path.join('.'))).flat()
    let filter = {
      ...p.filter,
      clauses: [
        ...p.filter.clauses,
        ...needs.map((hop) => present(hop.comp)),
      ],
    }
    let r = bound(filter, vocab, { ...opts, extend, archetypes: undefined }, d)
    froms.push(...[r.from ?? []].flat())
    joins.push(...r.joins ?? [])
    if (r.where) conds.push(r.where)
    cols.push(raw(`${q(pre + 'entity')}."eid" as ${q(`e${i}`)}`))
    anchors.push(`${q(pre + 'entity')}."id"`)

    // A gate: joined under a name of its own, and required to be missing.
    for (let comp of p.gates) {
      let as = `${pre}gate_${comp}`
      joins.push({
        how: 'left',
        src: raw(`${q(at(comp))} ${q(as)}`),
        on: raw(`${q(as)}."entity" = ${q(pre + 'entity')}."id"`),
      })
      conds.push(raw(`${q(as)}."entity" is null`))
    }

    if (p.entity) {
      slot(p.entity, {
        kind: 'id',
        sql: `${q(pre + 'entity')}."id"`,
        read: `${q(pre + 'entity')}."eid"`,
      })
    }
    for (let b of p.binds) {
      let hops = vocab.aim(b.path.join('.'))
      let hop = hops[hops.length - 1]
      if (!hop?.prop) {
        throw new Error(`$${b.name} names no property: .${b.path.join('.')}`)
      }
      let c = vocab.prop(hop.comp, hop.prop)
      if (!c) {
        throw new Error(`no property ${hop.comp}.${hop.prop} for $${b.name}`)
      }
      let read = d.col(hop.comp, hop.prop, vocab)!
      slot(b.name, {
        kind: c.category == 'ref' ? 'id' : 'value',
        sql: c.category == 'ref' ? d.refCol!(hop.comp, hop.prop) : read,
        read,
      })
    }
  })

  // The anchor. A rule is about a batch, not about the whole database: without
  // this the same statement queries the whole graph, and a rule with a standing
  // gate would fire on every entity that ever failed to satisfy it. So at least
  // one of its patterns must bind an entity the batch wrote — the same thing
  // the hand-written effect rules have always required, expressed in SQL.
  if (touched) {
    let ids = JSON.stringify(touched)
    conds.push(
      or(
        ...anchors.map((own) =>
          touched.length
            ? raw(`${own} in (select value from json_each(?))`, [ids])
            : raw('0')
        ),
      ),
    )
  }

  // The join proper: every slot of a variable is the same value. An id and a
  // value are not comparable — a reference stores an integer, a scalar stores
  // itself — so mixing them throws rather than compiling.
  for (let [name, held] of slots) {
    let kinds = new Set(held.map((s) => s.kind))
    if (kinds.size > 1) {
      throw new Error(
        `$${name} is an entity in one place and a plain value in another`,
      )
    }
    for (let other of held.slice(1)) {
      conds.push(raw(`${held[0].sql} = ${other.sql}`))
    }
    cols.push(raw(`${held[0].read} as ${q(`v_${name}`)}`))
  }

  return {
    t: 'select',
    distinct: true,
    cols,
    from: froms,
    joins,
    where: and(...conds),
  }
}
