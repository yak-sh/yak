// Fleet read composition: routed/resolved predicates become @yaks/query ASTs,
// @yaks/sql binds and lowers them against THIS connection's vocabulary. The
// fleet owns screens, ranking delivery and fallback policy, not SQL grammar.
import * as q from '@yaks/query'
import {
  and,
  bind,
  type BindOpts,
  type Frag,
  joined,
  or,
  raw,
  type Rel as PackageRel,
  renderCond,
  Unsupported,
  walkRows,
} from '@yaks/sql'
import { Unknown, type Vocab } from '@yaks/vocab'
import { blobRead } from '@yaks/blob'
import { fields, search } from '@yaks/fts'
import { traverse } from '@yaks/edge'
import { fleetVocabOf } from './db.ts'
import type { Sql } from './store/sql.ts'
import { derived } from './sql_derived.ts'
import { sentences } from './edge.ts'
import {
  AGG,
  EDGES,
  EXISTS,
  NEVER,
  ORDER,
  type Pred,
  PROJECT,
  type Reach,
  REACHES,
  reverseAssocs,
  TEXT,
  WANT,
  type Win,
  WINDOW,
} from './query.ts'
import { fromPackage, type Rel, toPackage } from './relation.ts'

// Reads and writes share the handle's complete vocabulary. Replanting the
// store's own words replaces that handle and invalidates these read options.
// Its scalar bodies are inline; only doc.body is a CAS read override.
let held = new WeakMap<Sql, { v: Vocab; opts: BindOpts }>()
let context = (db: Sql) => {
  let v = fleetVocabOf(db)
  let previous = held.get(db)
  if (previous?.v === v) return previous
  let docs = search(fields(v).filter((f) => f.comp == 'doc'))
  // Entries are a separate lazy partition with their own FTS index. Compose
  // its search explicitly; never register every fleet text/body column.
  let entries = search([{ comp: 'content', prop: 'body' }])
  let opts: BindOpts = {
    derived: {
      ...derived,
      'doc.body': blobRead(v, { key: 'entity' })['doc.body'],
    },
    extend: [traverse(v), {
      name: 'fleet/search',
      compile: {
        text: (c, site) =>
          or(docs.compile.text!(c, site)!, entries.compile.text!(c, site)!),
      },
    }],
  }
  let entry = { v, opts }
  held.set(db, entry)
  return entry
}

let field = (p: { comp: string; prop: string }): string =>
  [p.comp, p.prop].filter(Boolean).join('.')
let op = (p: Pred): q.Op => {
  if (p.op == EXISTS) return '!'
  if (p.op == WANT) return '?'
  if (p.op == '') return '='
  if (p.op == '!') return '!='
  if (p.op == '~') return '~='
  if (['<', '<=', '>', '>='].includes(p.op)) return p.op as q.Op
  throw new Unsupported('a fleet predicate', p.op)
}

// This is an adapter, not a parser: values have already been typed and refs
// resolved against the store. Do not round-trip through text (quotes/escapes
// would be lost). Package scalar lowering accepts the canonical comparison
// string, including the fleet predicate's list/range representation.
let clause = (p: Pred): q.Clause => {
  if (p.op == NEVER) return q.never()
  if (p.op == TEXT) return q.text(p.value)
  if (p.reach) return q.walk(p.reach.type, p.reach.dir, p.value, p.reach.depth)
  if (p.refs) return p.op == EXISTS ? q.hasRefs() : q.refs(p.value)
  if (p.rev) {
    let r = p.rev
    let name = [...reverseAssocs].find(([, a]) =>
      a.comp == r.comp && a.prop == r.prop
    )?.[0]
    if (!name) throw new Unsupported('a reverse association', field(r))
    if (r.count) return q.pred(name, op(p), q.scalar(p.value))
    if (!r.preds.length) return r.not ? q.absent(name) : q.present(name)
    return {
      ...q.present(name),
      where: q.and(...r.preds.map(clause)),
      not: r.not,
    }
  }
  if (p.op == REACHES) throw new Unsupported('a malformed walk')
  // Shared reference spellings have no one owning column. Keep the existing
  // matcher fallback rather than arbitrarily choosing a component.
  if (!p.comp && p.prop) throw new Unsupported('a shared reference', p.prop)
  let path = [field(p), ...(p.at ?? []).map(field)].join('.')
  let leaf = p.at?.at(-1) ?? p
  return {
    ...q.pred(
      path,
      op(p),
      p.op == EXISTS || p.op == WANT ? null : q.scalar(p.value),
    ),
    ...(!leaf.prop ? { facet: true } : {}),
  }
}
let directive = (p: Pred) => [AGG, PROJECT, WINDOW, ORDER, EDGES].includes(p.op)
let filters = (ps: Pred[]): q.Clause[] =>
  ps.filter((p) => !directive(p)).map(clause)
let compile = (db: Sql, cs: q.Clause[], now: number): PackageRel => {
  let { v, opts } = context(db)
  return bind(q.and(...cs), v, { ...opts, now })
}
let attempt = <T>(body: () => T): T | null => {
  try {
    return body()
  } catch (e) {
    if (e instanceof Unsupported || e instanceof Unknown) return null
    throw e
  }
}
let membership = (r: PackageRel): Rel => fromPackage({ ...r, order: [] })

export let where = (db: Sql, ps: Pred[], now = Date.now()): Rel | null =>
  attempt(() => membership(compile(db, filters(ps), now)))

// Dropping a declining conjunct only widens the candidate set. The caller
// refines it with the fleet matcher before any page bound is applied.
export let whereSome = (db: Sql, ps: Pred[], now = Date.now()): Rel => {
  let exact = where(db, ps, now)
  if (exact) return exact
  let kept = ps.filter((p) => where(db, [p], now) != null)
  return where(db, kept, now)!
}
export let countSql = (db: Sql, ps: Pred[], now = Date.now()): Rel | null =>
  attempt(() => fromPackage(compile(db, [...filters(ps), q.count()], now)))
export let aggregateSql = (
  db: Sql,
  ps: Pred[],
  now = Date.now(),
): Rel | null => {
  let agg = ps.find((p) => p.op == AGG)
  if (!agg?.agg) return null
  let c = agg.agg == 'count'
    ? q.count()
    : agg.agg == 'tally'
    ? q.tally(field(agg))
    : q.distinct(field(agg))
  return attempt(() => fromPackage(compile(db, [...filters(ps), c], now)))
}
export let select = (db: Sql, ps: Pred[], now = Date.now()): Rel | null => {
  let fields = ps.filter((p) => p.op == PROJECT).flatMap((p) => p.fields ?? [])
  return attempt(() => {
    let { v } = context(db)
    if (
      fields.some((f) => !v.column(f.comp, f.prop) && field(f) != 'entity.eid')
    ) {
      throw new Unsupported('an unknown projection column')
    }
    return membership(compile(db, [
      ...filters(ps),
      q.fields(
        ...fields.map((f) => ({ path: field(f).split('.'), wake: f.wake })),
      ),
    ], now))
  })
}

// Caller-owned CTEs may have already joined task/completed. The package owns
// all other joins and the condition tree, including tombstone exclusion.
export let screenSql = (
  db: Sql,
  ps: Pred[],
  present: string[] = [],
  now = Date.now(),
) => {
  let r = where(db, ps, now)
  if (!r) return null
  let ir = toPackage(r), cond = renderCond(ir.where)
  return {
    joins: joined(
      ir.joins.filter((j) => !present.some((p) => j.source == `"${p}"`)),
    ),
    cond: cond.sql,
    params: cond.params,
  }
}

// Rankings are delivered separately. Only exact unranked membership reaches
// this num window; add clauses to the IR, never to a finished SQL statement.
export let windowed = (base: Rel, w: Win): Rel => {
  let ir = toPackage(base)
  return fromPackage({
    ...ir,
    where: w.after == null
      ? ir.where
      : and(ir.where, raw({ sql: '"entity"."num" < ?', params: [w.after] })),
    order: ['"entity"."num" desc'],
    limit: w.limit ?? null,
  })
}

// The fleet supplies the step relation; the package owns the closure/row valve.
export let reachRows = (r: Reach, target: string): Frag =>
  walkRows(
    q.walk(r.type, r.dir, target, r.depth),
    r.via
      ? `select t.entity as "from", t."${r.via.prop}" as "to" from "${r.via.comp}" t`
      : `select parent as "from", child as "to" from (${sentences(r.type)})`,
  )
