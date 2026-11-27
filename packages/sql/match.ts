// A rule's match, as one statement. @yaks/graph parses a rule's source into a
// plan (its join.ts: patterns, gates, variables); this lowers that plan to SQL
// through the ordinary path-to-join binding (./bind.ts), so a rule is compiled
// by the same compiler as every other query and there is no second evaluator
// to keep in step.
//
// What makes several entities fit in one statement is the dialect. A dialect
// names every table, alias, join key and column expression, so each pattern is
// bound through one whose names carry that pattern's prefix (`p0_doc`,
// `p1_entity`), and no two patterns' selects share a name. Each is found in a
// select of its own, keyed on the patterns before it, and the statement crosses
// their rows (see `arm`). One statement, nothing gathered per rule by the
// caller.
//
// A gate lowers to a `not exists` under an alias of its own
// (`p0_gate_result`): a gate is an absence, the query never reads its columns,
// and a separate alias cannot collide with a join the filter already made for
// the same component.
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

import { field } from './sqlite.ts'
import type { Vocab } from '@yaks/vocab'
import { Unknown } from '@yaks/vocab/runtime'
import { type And, present } from '@yaks/query/core'
import {
  among,
  and,
  as,
  call,
  col,
  type Compound,
  cross,
  type Cte,
  eq,
  type Expr,
  FALSE,
  fn,
  from,
  iff,
  isNull,
  type Join,
  lit,
  op,
  raw,
  type Select,
  select,
  type Source,
  sub,
  table,
  val,
} from './ast.ts'
import { inline, q, relationOf } from './render.ts'
import { unionAllWithin } from './compound.ts'
import { type BindOpts, boundReads } from './bind.ts'
import type { Extension } from './extend.ts'
import { type Dialect, refEqAt, sqlite, type Tag } from './sqlite.ts'

// The spine's own id, `entity.eid`, as a hop.
let spine = (hop: { comp: string; prop: string }) =>
  hop.comp == 'entity' && hop.prop == 'eid'

// The refusal of a variable that is an entity in one pattern and a plain value
// in another. The query is the caller's, so it is a `Refused` (by name:
// @yaks/graph sits above this package), and it says how to compare the two.
let mixed = (name: string): Error => {
  let no = new Error(
    `$${name} is an entity in one place and a plain value in another; ` +
      `end the entity's path in .entity.eid to compare its eid as a value`,
  )
  no.name = 'Refused'
  return no
}

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
  collections?: unknown[]
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
let prefixed = (
  pre: string,
  at: At,
  from: (comp: string) => string,
): Dialect => {
  let own = (base: string) =>
    base == 'entity' ? `${q(pre + 'entity')}."id"` : `${q(pre + base)}."entity"`
  return {
    ...sqlite,
    name: `sqlite:${pre}`,
    spine: `${from('entity')} ${q(pre + 'entity')}`,
    membership: `${q(pre + 'entity')}."eid" as eid`,
    live: (owner = `${q(pre + 'entity')}."id"`) => ({
      sql: `not exists (select 1 from tombstone ${q(pre + 'tomb')} where ` +
        `${q(pre + 'tomb')}."entity" = ${owner})`,
      params: [],
    }),
    table: (comp) => `${from(comp)} ${q(pre + comp)}`,
    source: from,
    refEq: refEqAt(from('entity')),
    ownerKey: own,
    joinOn: (comp, base) => `${q(pre + comp)}."entity" = ${own(base)}`,
    refCol: (comp, prop) => `${q(pre + comp)}.${q(field(prop))}`,
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
      let own = col(field(prop), pre + comp)
      return c.category == 'ref'
        ? inline(sub(select({
          cols: [col('eid', '__re')],
          from: table(at('entity'), '__re'),
          where: eq(col('id', '__re'), own),
        })))
        : inline(own)
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

// The batch's ids, as each arm starts from them.
let TOUCHED = '__touched'

// Where a variable is filled from, and what kind of value fills it: an `id` is
// an integer spine id (an entity, or a reference column), a `value` is the
// column's own. `read` is how the same slot is projected — an eid for an id,
// so what comes back is the word a patch would write. `of` is the pattern the
// slot belongs to, and `tag` how its value crosses a carried row (`carry`).
type Slot = {
  name: string
  kind: 'id' | 'value'
  sql: string
  read: string
  tag: Tag
  of: number
}

// One matching pattern, bound: what finds it (its sources, their joins and
// its conditions), its eid, and its slots in the order its row carries them.
type Part = {
  i: number
  from: Source[]
  joins: Join[]
  where: Expr[]
  eid: string
  slots: Slot[]
}

// A carried row holds a value as JSON does, except the two JSON cannot hold:
// a JSONB value rides as its text and a binary one as hex, and each is read
// back as it was stored.
let carry = (e: Expr, tag: Tag): Expr =>
  tag == 'jsonb'
    ? op('||', fn('json', e), lit(''))
    : tag == 'binary'
    ? iff(isNull(e), lit(null), fn('hex', e))
    : e
let uncarry = (e: Expr, tag: Tag): Expr =>
  tag == 'jsonb' ? fn('jsonb', e) : tag == 'binary' ? fn('unhex', e) : e

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
): Select | Compound => {
  if (m.collections?.length) {
    throw new Error('a collection is evaluated by the storage adapter')
  }
  let at = on.at ?? ((comp: string) => comp)
  // A component read from its committed table is read as the relation of its
  // stored columns under their labels (`relationOf`), since the vocabulary
  // may store it by its identity; an overlay's CTE already speaks labels.
  let source = (comp: string) => {
    let name = at(comp)
    return name == comp ? relationOf(vocab, comp) : q(name)
  }
  let touched = on.touched
  let extend = [...(opts.extend ?? []), removals(on.gone ?? (() => null))]
  let ctes: Cte[] = []
  let parts: Part[] = []
  let slots = new Map<string, Slot[]>()

  m.patterns.forEach((p, i) => {
    // A pattern that only writes matches nothing: it makes its entity, one
    // per binding of the patterns that do match, so it contributes no table.
    if (p.makes) return
    let pre = `p${i}_`
    let d = prefixed(pre, at, source)
    // A bind implies the component its path starts from is there, as the
    // in-memory matcher has it, so a presence clause is added and the binder
    // makes the join it always would. A component the filter already named is
    // joined once: the binder keeps its tables in a set. A path through
    // references (`.speaker.recording.meeting`) is read from the entity it
    // reaches, as any query reads one: the root need not wear its far end. A
    // path ending `entity.eid` reads the eid of the entity it reaches, as a
    // plain value: what a string property holding an eid compares with.
    let binds = p.binds.map((b) => {
      let path = b.path.join('.')
      let hops = vocab.aim(path)
      let leaf = hops[hops.length - 1]
      if (!leaf?.prop) {
        throw new Unknown(path, `$${b.name} names no property: .${path}`)
      }
      let def = spine(leaf) ? undefined : vocab.prop(leaf.comp, leaf.prop)
      if (!def && !spine(leaf)) {
        throw new Unknown(path, `no property ${path} for $${b.name}`)
      }
      return { ...b, path, hops, ref: def?.category == 'ref' }
    })
    let filter = {
      ...p.filter,
      clauses: [
        ...p.filter.clauses,
        ...binds.flatMap((b) =>
          spine(b.hops[0]) ? [] : [present(b.hops[0].comp)]
        ),
      ],
    }
    let { select: r, fields } = boundReads(
      filter,
      vocab,
      { ...opts, extend, archetypes: undefined },
      d,
      binds.map((b) => b.path),
    )
    ctes.push(...r.with ?? [])
    let entity = q(pre + 'entity')
    let part: Part = {
      i,
      from: [r.from ?? []].flat(),
      joins: r.joins ?? [],
      where: r.where ? [r.where] : [],
      eid: `${entity}."eid"`,
      slots: [],
    }
    parts.push(part)

    // A gate: no row of it for the matched entity, asked under a name of its
    // own. Asked as `not exists` rather than a left join found empty, because
    // SQLite reads an overlay (@yaks/sqlite overlay.ts) by its key only where
    // it can fold it into the statement, and it never folds one into the
    // right side of a left join: there it copies the whole table first.
    for (let comp of p.gates) {
      let as = `${pre}gate_${comp}`
      part.where.push(
        raw(
          `not exists (select 1 from ${source(comp)} ${q(as)} where ${
            q(as)
          }."entity" = ${entity}."id")`,
        ),
      )
    }

    let slot = (s: Omit<Slot, 'of'>) => {
      let one = { ...s, of: i }
      slots.set(s.name, [...slots.get(s.name) ?? [], one])
      part.slots.push(one)
    }
    if (p.entity) {
      slot({
        name: p.entity,
        kind: 'id',
        sql: `${entity}."id"`,
        read: `${entity}."eid"`,
        tag: 'eid',
      })
    }
    // A reference joins by the integer id it stores, a plain value by itself.
    for (let b of binds) {
      let { expr, key, tag } = fields.get(b.path)!
      let leaf = b.hops[b.hops.length - 1]
      let id = key ??
        (b.hops.length == 1 ? d.refCol!(leaf.comp, leaf.prop) : undefined)
      if (b.ref && !id) {
        throw new Error(`$${b.name} reads .${b.path}, which stores no id`)
      }
      slot({
        name: b.name,
        kind: b.ref ? 'id' : 'value',
        sql: b.ref ? id! : expr,
        read: expr,
        tag,
      })
    }
  })

  // An id and a value are not comparable — a reference stores an integer, a
  // scalar stores itself — so the query mixing them is refused rather than
  // compiled.
  for (let [name, held] of slots) {
    if (new Set(held.map((s) => s.kind)).size > 1) throw mixed(name)
  }

  // The order an arm binds its patterns in: `k` first, then each pattern
  // sharing a variable with those already bound, so it is found by a key they
  // hold rather than read whole. A pattern sharing none comes when nothing
  // else is left.
  let ordered = (k: number): Part[] => {
    let order = [parts[k]]
    let names = new Set(parts[k].slots.map((s) => s.name))
    while (order.length < parts.length) {
      let rest = parts.filter((p) => !order.includes(p))
      let next = rest.find((p) => p.slots.some((s) => names.has(s.name))) ??
        rest[0]
      order.push(next)
      for (let s of next.slots) names.add(s.name)
    }
    return order
  }

  // One arm: its patterns in order, each found in a select of its own.
  //
  // A batch's overlay is a `union all` of committed and batch rows, and SQLite
  // reads one by its key only by folding it into the select that names it,
  // which copies that select once for each of its arms. Every overlaid source
  // in one select doubles it again: a rule of n patterns, each standing on an
  // overlaid spine and component, was 4^n copies of itself, and four patterns
  // passed workerd's 25,000 operations to a statement. So each pattern is
  // found in a select of its own, its sources folded there and nowhere else,
  // and what the rest of the arm needs of it (its eid and its slots) comes back
  // as one JSON row per match, which `json_each` crosses into the arm. Its
  // conditions on the patterns bound before it are part of that select, so it
  // is found by their keys, and the first is found by the batch's. `limit -1`
  // keeps SQLite from folding that select into the `json_group_array` around
  // it, which no overlay can be folded into.
  let arm = (order: Part[]): Select => {
    // The first slot of each variable: every later slot of it equals that
    // one, which is the join, and it is what the variable reads as.
    let first = new Map<string, Slot>()
    for (let s of order.flatMap((p) => p.slots)) {
      if (!first.has(s.name)) first.set(s.name, s)
    }
    // Where a carried row holds a first slot's value, and its read where that
    // differs; a later slot is only compared, in its own pattern's select.
    let carried = new Map<Slot, { row: string; read: number; sql: number }>()
    let held = (s: Slot, which: 'sql' | 'read'): Expr => {
      let at = carried.get(s)
      if (!at) return raw(s[which])
      return uncarry(
        fn('json_extract', col('value', at.row), lit(`$[${at[which]}]`)),
        s.tag,
      )
    }
    let rows = new Map<number, string>()
    let sources: Source[] = []
    // The anchor. A rule is about a batch, not about the whole database:
    // without it the same statement queries the whole graph, and a rule with
    // a standing gate would fire on every entity that ever failed to satisfy
    // it. So one of its patterns must bind an entity the batch wrote: the arm
    // starts from the batch's ids, and its first pattern is looked up by them
    // rather than found by walking a table whose rows merely might match.
    if (touched) {
      sources.push(call('json_each', [val(JSON.stringify(touched))], TOUCHED))
    }
    for (let p of order) {
      let conds = [...p.where]
      if (touched && p == order[0]) {
        conds.push(
          eq(raw(`${q(`p${p.i}_entity`)}."id"`), col('value', TOUCHED)),
        )
      }
      let row = `__p${p.i}`
      let values: Expr[] = [raw(p.eid)]
      let own = new Map<Slot, { row: string; read: number; sql: number }>()
      for (let s of p.slots) {
        let one = first.get(s.name)!
        if (one != s) {
          conds.push(eq(held(one, 'sql'), raw(s.sql)))
          continue
        }
        let read = values.push(carry(raw(s.read), s.tag)) - 1
        let sql = s.sql == s.read || slots.get(s.name)!.length == 1
          ? read
          : values.push(carry(raw(s.sql), s.tag)) - 1
        own.set(s, { row, read, sql })
      }
      let found = select({
        cols: [as(fn('json_array', ...values), 'row')],
        from: p.from,
        joins: p.joins,
        where: and(...conds),
        limit: val(-1),
      })
      sources.push(call('json_each', [
        sub(select({
          cols: [fn('json_group_array', col('row'))],
          from: from(found),
        })),
      ], row))
      rows.set(p.i, row)
      for (let [s, at] of own) carried.set(s, at)
    }
    let [start, ...rest] = sources
    return select({
      cols: [
        ...parts.map((p) =>
          as(
            fn('json_extract', col('value', rows.get(p.i)), lit('$[0]')),
            `e${p.i}`,
          )
        ),
        ...[...slots.keys()].map((name) =>
          as(held(first.get(name)!, 'read'), `v_${name}`)
        ),
      ],
      from: start,
      joins: rest.map(cross),
    })
  }

  let with_ = ctes.length ? { with: ctes } : {}
  // Not `distinct`: a binding found twice is one binding to whoever reads the
  // rows back (@yaks/sqlite rules.ts).
  //
  // Several patterns are anchored together, any one of them enough: one arm
  // for each, starting from it, their rows together.
  if (!touched) return { ...arm(ordered(0)), ...with_ }
  let arms = parts.map((_, k) => arm(ordered(k)))
  return { ...unionAllWithin(arms) as Select | Compound, ...with_ }
}
