// A rule's match, as ONE statement. @yaks/graph reads a rule's source into a
// plan (its join.ts: patterns, gates, variables); this lowers that plan to SQL
// through @yaks/sql's ordinary path-to-join binding, so a rule is compiled by
// the same compiler as every other query and there is no second evaluator to
// keep honest.
//
// The trick that makes several entities fit in one SELECT is the DIALECT. A
// dialect names every table, alias, join key and column expression, and
// @yaks/sql takes one as an option — so each pattern is bound through a
// dialect whose names carry that pattern's prefix (`p0_doc`, `p1_entity`), and
// the resulting relations can simply be put side by side: their FROMs cross,
// their joins gather, their conditions AND. One statement, no candidate sets,
// nothing gathered per rule by the host.
//
// A GATE is what the design says it is: a LEFT JOIN whose owner column IS
// NULL. It gets an alias of its own (`p0_gate_result`) because a gate is an
// absence — the query never reads its columns, and a separate alias cannot
// collide with a join the filter already made for the same component.
//
// A VARIABLE is a slot. `$call` alone is the pattern's entity (its integer
// spine id); `$call` as a value is that column. Two slots sharing a name are
// equated, which IS the join, and an id compares to an id — a reference column
// stores the target's integer id, so joining a reference to an entity is an
// integer compare, never an eid round trip. Mixing an id slot with a value
// slot is refused rather than coerced.
//
// Run it against a batch OVERLAY (./overlay.ts) and the same statement reads
// the graph with the batch in it. That is the whole of "rules run before
// persistence": no flag, no second path, a different set of tables underneath
// — the overlay is a `with` prefix of CTEs and the dialect simply points each
// covered component's name at its CTE, so what changes is a name.
//
// One clause cannot be said that way, because it is not about a row at all:
// `-comp` asks what the batch REMOVED, and a removed row is indistinguishable
// from a row that was never there. So the overlay keeps a list of what it
// took and this file contributes the one lowering that reads it — an
// @yaks/sql extension, the same seam text and vectors come in through.

import type { Vocab } from '@yaks/vocab'
import type { Binding, Bundle, Match } from '@yaks/graph'
import {
  and,
  bind,
  type BindOpts,
  type Compiled,
  type Cond,
  type Dialect,
  type Extension,
  type Join,
  or,
  raw,
  refEqAt,
  rel,
  render,
  sqlite,
} from '@yaks/sql'
import { present } from '@yaks/query'
import type { Driver, Param, Row } from './driver.ts'
import { overlay } from './overlay.ts'

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

/**
 * The SQLite dialect, renamed. Every alias it hands out carries `pre`, so two
 * of these bind two patterns into one statement without a single name in
 * common. The value lowerings are untouched — what a comparison MEANS is not
 * a matter of what a table is called.
 *
 * `at` says where a component is READ from, and defaults to the component's
 * own table. An overlay passes its own, and every table name in the statement
 * becomes that component's CTE without another line changing.
 */
export let prefixed = (pre: string, at: At = q): Dialect => {
  let own = (base: string) =>
    base == 'entity' ? `${q(pre + 'entity')}."id"` : `${q(pre + base)}."entity"`
  return {
    ...sqlite,
    name: `sqlite:${pre}`,
    spine: `${at('entity')} ${q(pre + 'entity')}`,
    membership: `${q(pre + 'entity')}."eid" as eid`,
    live: () => ({
      sql: `not exists (select 1 from tombstone ${q(pre + 'tomb')} where ` +
        `${q(pre + 'tomb')}."entity" = ${q(pre + 'entity')}."id")`,
      params: [],
    }),
    table: (comp) => `${at(comp)} ${q(pre + comp)}`,
    source: at,
    refEq: refEqAt(at('entity')),
    ownerKey: own,
    joinOn: (comp, base) => `${q(pre + comp)}."entity" = ${own(base)}`,
    refCol: (comp, prop) => `${q(pre + comp)}.${q(prop)}`,
    presence: (comp) => ({
      sql: `${q(pre + comp)}."entity" is not null`,
      params: [],
    }),
    // No archetype key: the batch overlay mints entities that wear no
    // archetype yet, and a plan that matched on one would not see them.
    archetype: undefined,
    col: (comp, prop, v) => {
      if (comp == 'entity' && v.column(comp, prop)?.category != 'ref') {
        return `${q(pre + 'entity')}.${q(prop)}`
      }
      if (prop == 'eid') return `${q(pre + comp)}."entity"`
      let c = v.column(comp, prop)
      if (!c) return null
      return c.category == 'ref'
        ? `(select __re.eid from ${at('entity')} __re where __re.id = ${
          q(pre + comp)
        }.${q(prop)})`
        : `${q(pre + comp)}.${q(prop)}`
    },
  }
}

/** Where a component is read from: its own table, or an overlay's CTE. */
export type At = (comp: string) => string

/**
 * What a statement is asked AGAINST: the sources to read (an overlay's, or
 * nothing for the committed graph), where the batch's DELETIONS are read from
 * (`-comp`), and the entity ids the batch moved, which every match is narrowed
 * to.
 */
export type On = { at?: At; gone?: Gone; touched?: number[] }

/** Where a component the batch REMOVED is read from — the overlay's list, or
 * `null` where this batch removed none of it. */
export type Gone = (comp: string) => string | null

// The deletion clause, lowered. `-comp` is the one question a committed row
// cannot answer — the row is gone, and gone reads exactly like never-there —
// so it is answered from the overlay's own list of what the batch took. With
// no overlay under the statement nothing was removed, and the clause is false:
// a match asked of the file outright is about what IS, never about what went.
let removals = (gone: Gone): Extension => ({
  name: 'gone',
  compile: {
    gone: (c, site) => {
      let src = c.kind == 'gone' ? gone(c.comp) : null
      return raw(
        src
          ? {
            sql: `${site.owner} in (select "entity" from ${src})`,
            params: [],
          }
          : { sql: '0', params: [] },
      )
    },
  },
})

// Where a variable is filled from, and what kind of value fills it: an `id` is
// an integer spine id (an entity, or a reference column), a `value` is the
// column's own. `read` is how the same slot is PROJECTED — an eid for an id,
// so what comes back is the word a patch would write.
type Slot = { kind: 'id' | 'value'; sql: string; read: string }

/**
 * Compile a rule's match to one statement: one `eid` column per pattern, one
 * column per variable.
 *
 * ```ts
 * import { match } from '@yaks/graph'
 * import { statement } from '@yaks/sqlite'
 *
 * let { sql } = statement(match('$call .call; .result, result.call=$call'), v)
 * ```
 */
export let statement = (
  m: Match,
  vocab: Vocab,
  opts: BindOpts = {},
  on: On = {},
): Compiled => {
  let at = on.at ?? q
  let touched = on.touched
  let extend = [...(opts.extend ?? []), removals(on.gone ?? (() => null))]
  let froms: string[] = []
  let joins: Join[] = []
  let conds: Cond[] = []
  let cols: string[] = []
  let anchors: string[] = []
  let slots = new Map<string, Slot[]>()
  let slot = (name: string, s: Slot) => {
    let held = slots.get(name) ?? []
    held.push(s)
    slots.set(name, held)
  }

  m.patterns.forEach((p, i) => {
    // A pattern that only writes matches nothing: it MAKES its entity, one
    // per binding of the patterns that do match, so it contributes no table.
    if (p.makes) return
    let pre = `p${i}_`
    let d = prefixed(pre, at)
    // A bound column has to be joined, and a bind implies the component is
    // there — so the presence says it, and @yaks/sql makes the join it always
    // would. A component the filter already named is joined once: the binder
    // keeps its tables in a set.
    let needs = p.binds.map((b) => vocab.aim(b.path.join('.'))).flat()
    let filter = {
      ...p.filter,
      clauses: [
        ...p.filter.clauses,
        ...needs.map((hop) => present(hop.comp)),
      ],
    }
    let r = bind(filter, vocab, {
      ...opts,
      extend,
      dialect: d,
      archetypes: undefined,
    })
    froms.push(r.from)
    joins.push(...r.joins)
    conds.push(r.where)
    cols.push(`${q(pre + 'entity')}."eid" as ${q(`e${i}`)}`)
    anchors.push(`${q(pre + 'entity')}."id"`)

    // A gate: joined under a name of its own, and required to be missing.
    for (let comp of p.gates) {
      let as = `${pre}gate_${comp}`
      joins.push({
        source: `${at(comp)} ${q(as)}`,
        on: `${q(as)}."entity" = ${q(pre + 'entity')}."id"`,
      })
      conds.push(raw({ sql: `${q(as)}."entity" is null`, params: [] }))
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
        throw new Error(`$${b.name} names no column: .${b.path.join('.')}`)
      }
      let c = vocab.column(hop.comp, hop.prop)
      if (!c) {
        throw new Error(`no column ${hop.comp}.${hop.prop} for $${b.name}`)
      }
      let read = d.col(hop.comp, hop.prop, vocab)!
      slot(b.name, {
        kind: c.category == 'ref' ? 'id' : 'value',
        sql: c.category == 'ref' ? d.refCol!(hop.comp, hop.prop) : read,
        read,
      })
    }
  })

  // The ANCHOR. A rule is about a batch, not about the file: without this the
  // same statement asks the whole graph, and a rule with a standing gate would
  // fire on every entity that ever failed to satisfy it. So at least one of
  // its patterns must bind an entity the batch wrote — the same thing the
  // coded effect rules have always required, said in SQL.
  if (touched) {
    let ids = touched.map(() => '?').join(', ')
    conds.push(
      or(...anchors.map((own) =>
        raw({
          sql: touched.length ? `${own} in (${ids})` : '0',
          params: [...touched],
        })
      )),
    )
  }

  // The join proper: every slot of a variable is the same value. An id and a
  // value are not comparable — a reference stores an integer, a scalar stores
  // itself — so that is a mistake to say out loud.
  for (let [name, held] of slots) {
    let kinds = new Set(held.map((s) => s.kind))
    if (kinds.size > 1) {
      throw new Error(
        `$${name} is an entity in one place and a plain value in another`,
      )
    }
    for (let other of held.slice(1)) {
      conds.push(raw({ sql: `${held[0].sql} = ${other.sql}`, params: [] }))
    }
    cols.push(`${held[0].read} as ${q(`v_${name}`)}`)
  }

  return render(rel(froms.join(', '), {
    cols,
    uniq: true,
    joins,
    where: and(...conds),
  }))
}

/**
 * Run a compiled match and read its rows back as bindings. The statement is
 * the one above; what makes it answer about a BATCH is the overlay standing
 * under it (./overlay.ts), not anything here.
 */
export let matched = (
  driver: Driver,
  m: Match,
  vocab: Vocab,
  opts: BindOpts = {},
  on: On = {},
  prefix: { with: string; params: Param[] } = { with: '', params: [] },
): Binding[] => {
  let s = statement(m, vocab, opts, on)
  return driver.query(prefix.with + s.sql, [
    ...prefix.params,
    ...s.params,
  ] as (string | number)[]).map((
    row: Row,
  ) => ({
    entities: m.patterns.map((p, i) => p.makes ? null : String(row[`e${i}`])),
    vars: Object.fromEntries(m.vars.map((name) => [name, row[`v_${name}`]])),
  }))
}

/**
 * The storage's DECLARED-RULE door (@yaks/graph `Tx.bindings`): answer every
 * match against this graph with `batch` folded in.
 *
 * One overlay for the whole set — `covers` is what the rules read — and then
 * one statement per match under it. The overlay is a `with` prefix, so it
 * costs nothing to leave standing and nothing to take down: every statement
 * here simply carries it.
 */
export let bindings = (
  driver: Driver,
  vocab: Vocab,
  matches: Match[],
  batch: Bundle[],
  covers: string[],
  opts: BindOpts = {},
): Binding[][] => {
  if (!matches.length) return []
  let over = overlay(driver, vocab, batch, covers)
  // What the batch is ABOUT, as the ids the overlay speaks in: the anchor
  // every match is narrowed to, so a rule asks about this batch rather than
  // about the file. With NO batch there is nothing to be about and nothing to
  // anchor to: the caller is asking the match outright, which is what a
  // template invocation is.
  let touched = batch.length
    ? [...new Set(batch.map((b) => over.ids.get(b.entity.eid)!))]
      .filter((id) => id !== undefined)
    : undefined
  let on = { at: over.at, gone: over.gone, touched }
  return matches.map((m) => matched(driver, m, vocab, opts, on, over))
}
