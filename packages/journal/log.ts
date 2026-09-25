// The journal's tables: three of them, append-only, holding no entities of
// their own. A transaction here is one call to `graph.apply()`, whose bundles
// all commit or none do.
//
//   journal_tx     one row per committed transaction — its id is the total
//                  order and the cursor
//   journal_change one ordered operation per component patched or removed
//   journal_field  one ordered after-image per property an operation wrote
//
// After-images only: what a write left, never both sides of it. The before-
// value a history read needs is rebuilt from the entity's own rows in the log
// (`before()`), a read bounded to one entity and never a table scan — which is
// what keeps the log about a third of the size of one that stores both sides. A
// property whose text the graph already keeps under a content address is
// recorded by its address ({@link Cas}), so logging every revision of every
// document costs a row rather than the document.
//
// Nothing is read in order to write, so there is no precondition phase and
// nothing is passed forward to a later phase: the log is derived entirely from
// what was applied, inside the caller's own transaction. A refused transaction
// leaves no trace; a committed one always has a row.
//
// The caller supplies one function: `rows(statement)`, a @yaks/sql node in
// and its rows out. No platform API, no driver object, and no transaction of
// its own — the caller owns the transaction.

import type { Bundle, Comp, Eid, Plugin, Tx } from '@yaks/graph'
import { actorOf, comps, dead } from '@yaks/graph'
import {
  and,
  as,
  col,
  type CreateTable,
  desc,
  eq,
  type Expr,
  fn,
  gt,
  type Join,
  join,
  left,
  lit,
  lt,
  notNull,
  or,
  over,
  type Row,
  type Select,
  select,
  type Stmt,
  sub,
  table,
  val,
} from '@yaks/sql'
import type { Batch, Delta, Entry, Patch } from './batch.ts'
import { dec, enc } from './value.ts'

/** A statement, run for its rows: the whole of what the caller has to supply.
 * A write goes through it too — `insert … returning id` returns a row. */
export type Rows = (s: Stmt) => Row[]

/**
 * A property whose text the graph already stores once, under a content address.
 * The journal then records that address and points at the graph's bytes instead
 * of repeating them — the difference between a log that keeps every revision of
 * every document and one that keeps a row per revision.
 */
export type Cas = {
  /** is this property content-addressed? */
  at: (comp: string, prop: string) => boolean
  /** store the text and return the id the journal records */
  put: (text: string) => number
  /** the table holding the content, and its key and value columns */
  table: string
  key: string
  value: string
}

/**
 * One recorded value a {@link Log.seek} found: where it sits in the log,
 * the value as stored, and the content address when the property is
 * content-addressed.
 */
export type Hit = {
  /** the row's own id — what a redaction names to rewrite it */
  field: number
  /** the entity the value was written about */
  target: Eid | null
  /** the component and property it belongs to */
  comp: string
  prop: string
  /** the transaction it was written by, and when that committed */
  seq: number
  at: string
  /** the value as recorded, decoded */
  value: unknown
  /** the content it refs, when the property is content-addressed */
  content: Eid | null
}

/** How the log is bound to a store. */
export type LogOpts = {
  /** the statement runner — the whole of what the caller supplies */
  rows: Rows
  /** the entity table: where an eid becomes the integer the tables store */
  spine?: { table?: string; id?: string; eid?: string }
  /** content-addressed properties, if the graph has any */
  cas?: Cas
}

// The tables. Append-only, no eid of their own, never in a snapshot and never
// in a client cache: this is the record of what was applied, not part of it.
//
// `tx.id` is an integer primary key, so it is the next rowid — monotonic, which
// is what lets the total order rest on something other than a clock, and what
// every cursor in the system holds.
//
// `change.operation` is `upsert` (the component is present; an empty one is an
// upsert with no field rows) or `remove` (the component was removed, or the
// entity was deleted when component = 'entity'). A row in the entity table
// outlives the entity it names, so every change can keep pointing at one.
//
// `field.present = 1` records a written value, JSON-encoded, so a value that is
// null stays distinct from a tombstone; `present = 0` is the tombstone written
// for each property a component still held when it was removed, which keeps
// property history, before-value lookup and undo self-contained and stops a
// value leaking across a removal and a later recreation. `ref` names content-
// addressed bytes the graph already holds, and then `value` stays null.
export let ddl = (spine = 'entity'): Stmt[] => {
  let id = { name: 'id', type: 'integer', pk: true }
  let to = (t: string, required = false) => ({
    type: 'integer',
    notNull: required,
    ref: { table: t, cols: ['id'] },
  })
  let text = (name: string, required = false) => ({
    name,
    type: 'text',
    notNull: required,
  })
  let int = (name: string) => ({ name, type: 'integer', notNull: true })
  let created = (name: string, cols: CreateTable['cols']): CreateTable => ({
    t: 'create table',
    name,
    ifNot: true,
    cols,
  })
  let index = (name: string, on: string, cols: string[], where?: Expr) => ({
    t: 'create index' as const,
    name,
    on,
    cols: cols.map((c) => col(c)),
    ifNot: true,
    where,
  })
  return [
    created('journal_tx', [
      id,
      text('ts', true),
      { name: 'actor', ...to(spine) },
      { name: 'via', ...to(spine) },
      text('trace'),
    ]),
    created('journal_change', [
      id,
      { name: 'tx', ...to('journal_tx', true) },
      int('ordinal'),
      { name: 'entity', ...to(spine, true) },
      text('component', true),
      text('operation', true),
    ]),
    created('journal_field', [
      id,
      { name: 'change', ...to('journal_change', true) },
      int('ordinal'),
      text('field', true),
      int('present'),
      text('value'),
      { name: 'ref', ...to(spine) },
    ]),
    index('journal_change_tx', 'journal_change', ['tx', 'ordinal']),
    index('journal_change_ent', 'journal_change', ['entity', 'component']),
    index('journal_field_change', 'journal_field', ['change', 'ordinal']),
    index('journal_field_ref', 'journal_field', ['ref'], notNull(col('ref'))),
  ]
}

// The properties an after-image records: everything but `eid`, which is the
// row's own identity and already the change's entity.
let written = (value: Comp): [string, unknown][] =>
  Object.entries(value).filter(([prop]) => prop != 'eid')

/** The log bound to one store: the writer, and the questions a journal is kept
 * in order to answer. */
export type Log = {
  /** write one transaction down inside the caller's own transaction; returns
   * its seq */
  write: (
    meta: {
      at: string
      by?: Eid | null
      via?: Eid | null
      note?: string | null
    },
    applied: Patch[],
  ) => number
  /** one transaction's operations, whole or cut to one entity, in applied
   * order */
  patches: (seq: number, target?: Eid) => Patch[]
  /** the transactions that touched one entity, newest first, cut to it */
  entries: (target: Eid, n?: number) => Entry[]
  /** every transaction one instrument wrote, newest first, whole */
  by: (via: Eid, n?: number) => Entry[]
  /** the transactions after a cursor, oldest first — the feed */
  since: (cursor?: number) => Entry[]
  /** one transaction as a Batch, both sides of every movement */
  at: (seq: number) => Batch | undefined
  /** what happened to one entity, oldest first, as Batch */
  history: (target: Eid, n?: number) => Batch[]
  /** one entity's components as of just before a transaction */
  before: (target: Eid, seq: number) => Record<string, Comp>
  /** the last transaction that touched one entity, or 0 */
  latest: (target: Eid) => number
  /** every recorded write of one property, oldest first */
  wrote: (
    comp: string,
    prop: string,
  ) => { target: Eid; value: unknown; seq: number }[]
  /** the highest seq the log holds, or 0 */
  tip: () => number
  /** has anything touched this entity since a given transaction? */
  touchedSince: (target: Eid, seq: number) => boolean
  /** does the log still read its text through this content? */
  holds: (ref: number) => boolean
  /** every recorded value containing this text, oldest first */
  seek: (text: string) => Hit[]
  /** rewrite one recorded inline value in place */
  scrubValue: (field: number, value: string) => void
  /** point one recorded content-addressed value at different content */
  scrubRef: (field: number, ref: number) => void
}

/**
 * Bind the log to a store.
 *
 * ```ts
 * let j = log({ rows: (s) => db.query(s) })
 * j.write({ at, by, via, note }, patches) // inside the caller's transaction
 * j.history('T-1')                        // Batch[], oldest first
 * j.since(cursor)                         // Entry[], the feed
 * ```
 */
export let log = (opts: LogOpts): Log => {
  let rows = opts.rows
  let spine = opts.spine?.table ?? 'entity'
  let idCol = opts.spine?.id ?? 'id'
  let eidCol = opts.spine?.eid ?? 'eid'
  let cas = opts.cas
  let jt = (c: string) => col(c, 'jt')
  let jc = (c: string) => col(c, 'jc')
  let jf = (c: string) => col(c, 'jf')
  // An eid bound where a column holds an entity-table id, and the lookup back
  // the other way.
  let idOf = (eid: Eid | null | undefined): Expr =>
    sub(select({
      cols: [col(idCol, 's')],
      from: table(spine, 's'),
      where: eq(col(eidCol, 's'), val(eid ?? null)),
    }))
  let eidOf = (id: Expr): Expr =>
    sub(select({
      cols: [col(eidCol, 's')],
      from: table(spine, 's'),
      where: eq(col(idCol, 's'), id),
    }))
  let one = (s: Stmt) => rows(s)[0]
  let num = (v: unknown) => Number(v ?? 0)
  let str = (v: unknown) => (v == null ? null : String(v))
  // The joins from a field to its change, and from a change to its
  // transaction.
  let ofChange = join(table('journal_change', 'jc'), eq(jc('id'), jf('change')))
  let ofTx = join(table('journal_tx', 'jt'), eq(jt('id'), jc('tx')))
  // A property recorded by address reads its text back through the content
  // it names.
  let content: Join[] = cas
    ? [left(table(cas.table, 'c'), eq(col(cas.key, 'c'), jf('ref')))]
    : []
  let resolved = cas ? col(cas.value, 'c') : lit(null)

  // Every change matching `where`, in `order`. A change whose entity has no
  // row in the entity table is not read — once that row is purged there is no
  // eid left to report.
  let changes = (where: Expr, order: Expr[]): Select =>
    select({
      cols: [
        as(jc('id'), 'id'),
        as(col(eidCol, 'e'), 'eid'),
        as(jc('component'), 'component'),
        as(jc('operation'), 'operation'),
      ],
      from: table('journal_change', 'jc'),
      joins: [join(table(spine, 'e'), eq(col(idCol, 'e'), jc('entity')))],
      where,
      order,
    })

  // One change's present after-images, in the order they were written.
  let fieldsOf = (change: unknown): Select =>
    select({
      cols: [
        as(jf('field'), 'field'),
        as(jf('value'), 'value'),
        as(resolved, 'text'),
      ],
      from: table('journal_field', 'jf'),
      joins: content,
      where: and(eq(jf('change'), val(num(change))), eq(jf('present'), lit(1))),
      order: [jf('ordinal')],
    })

  let rebuild = (found: Row[]): Patch[] =>
    found.map((ch) => {
      let target = String(ch.eid)
      let comp = String(ch.component)
      if (ch.operation == 'remove') return { target, comp, value: null }
      let value: Comp = {}
      for (let f of rows(fieldsOf(ch.id))) {
        value[String(f.field)] = f.text ?? dec(f.value)
      }
      return { target, comp, value }
    })

  /** One transaction's operations, whole or cut to one entity, in applied
   * order. */
  let patches = (seq: number, target?: Eid): Patch[] =>
    rebuild(rows(changes(
      target == null
        ? eq(jc('tx'), val(seq))
        : and(eq(jc('tx'), val(seq)), eq(col(eidCol, 'e'), val(target))),
      [jc('ordinal')],
    )))

  let entryOf = (r: Row, target?: Eid): Entry => ({
    seq: num(r.id),
    at: String(r.ts),
    by: str(r.actor),
    via: str(r.via),
    note: str(r.trace),
    patches: patches(num(r.id), target),
  })

  /**
   * Write one transaction down, inside the caller's own transaction, and
   * return its seq. It is derived entirely from what was applied: nothing was
   * read first, so a caller owes this function nothing but an accurate account
   * of what it wrote.
   */
  let write = (
    meta: {
      at: string
      by?: Eid | null
      via?: Eid | null
      note?: string | null
    },
    applied: Patch[],
  ): number => {
    let seq = num(
      one({
        t: 'insert',
        into: 'journal_tx',
        cols: ['ts', 'actor', 'via', 'trace'],
        rows: [[
          val(meta.at),
          idOf(meta.by),
          idOf(meta.via),
          val(meta.note ?? null),
        ]],
        returning: [col('id')],
      })?.id,
    )
    // The properties a component still holds, newest after-image per property:
    // the field id is monotonic, so the highest-id row per property is the
    // latest in total order — and it reads this transaction's earlier upserts,
    // which are uncommitted but visible on the same connection.
    let held = (target: Eid, comp: string): Select =>
      select({
        cols: [col('field')],
        from: {
          t: 'from',
          q: select({
            cols: [
              as(jf('field'), 'field'),
              as(jf('present'), 'present'),
              as(
                over(fn('row_number'), [jf('field')], [desc(jf('id'))]),
                'rn',
              ),
            ],
            from: table('journal_field', 'jf'),
            joins: [ofChange],
            where: and(
              eq(jc('entity'), idOf(target)),
              eq(jc('component'), val(comp)),
            ),
          }),
        },
        where: and(eq(col('rn'), lit(1)), eq(col('present'), lit(1))),
      })
    applied.forEach(({ target, comp, value }, ordinal) => {
      let change = num(
        one({
          t: 'insert',
          into: 'journal_change',
          cols: ['tx', 'ordinal', 'entity', 'component', 'operation'],
          rows: [[
            val(seq),
            val(ordinal),
            idOf(target),
            val(comp),
            val(value == null ? 'remove' : 'upsert'),
          ]],
          returning: [col('id')],
        })?.id,
      )
      let field = (
        i: number,
        name: string,
        v: string | null,
        ref: number | null,
      ) =>
        rows({
          t: 'insert',
          into: 'journal_field',
          cols: ['change', 'ordinal', 'field', 'present', 'value', 'ref'],
          rows: [[
            val(change),
            val(i),
            val(name),
            val(v == null && ref == null ? 0 : 1),
            val(v),
            val(ref),
          ]],
        })
      if (value == null) {
        // A removal tombstones every property the component still had, so
        // property history stays self-contained across a removal and a later
        // recreation.
        rows(held(target, comp)).forEach((f, i) =>
          field(i, String(f.field), null, null)
        )
        return
      }
      // An upsert records one present after-image per property, JSON-encoded so
      // a present null stays distinct from a tombstone. An empty component
      // writes none — its change row alone marks its presence.
      written(value).forEach(([prop, v], i) =>
        cas && cas.at(comp, prop) && typeof v == 'string'
          ? field(i, prop, null, cas.put(v))
          : field(i, prop, JSON.stringify(v) ?? 'null', null)
      )
    })
    return seq
  }

  /**
   * One entity's component state as of just before `seq`, rebuilt by merging,
   * property by property, that entity's own rows in the log — bounded to one
   * entity, never a table scan. This is where the before-value an after-image
   * log does not store comes from.
   */
  let before = (target: Eid, seq: number): Record<string, Comp> => {
    let state: Record<string, Comp> = {}
    for (
      let p of rebuild(rows(changes(
        and(eq(jc('entity'), idOf(target)), lt(jc('tx'), val(seq))),
        [jc('tx'), jc('ordinal')],
      )))
    ) {
      // A deletion partway through cannot precede a live target, but resetting
      // keeps the reconstruction correct if one turns up.
      if (p.comp == 'entity') {
        if (!p.value) state = {}
        continue
      }
      if (p.value == null) delete state[p.comp]
      else state[p.comp] = { ...(state[p.comp] ?? {}), ...p.value }
    }
    return state
  }

  // An entry's operations as deltas: a component that was not there is
  // announced by a property-less delta before its properties follow, a
  // component that went is a property-less delta carrying what it held, and a
  // deletion is a tombstone. The before-side comes from `before()`, carried
  // forward across the transaction so that a transaction touching one component
  // twice reads as two movements.
  let deltasOf = (e: Entry): Delta[] => {
    let held = new Map<Eid, Record<string, Comp>>()
    let now = (eid: Eid) => {
      let s = held.get(eid)
      if (!s) held.set(eid, s = before(eid, e.seq))
      return s
    }
    let out: Delta[] = []
    for (let { target, comp, value } of e.patches) {
      let st = now(target)
      if (comp == 'entity' && value == null) {
        for (let [name, was] of Object.entries(st)) {
          out.push({
            target,
            comp: name,
            prop: null,
            before: was,
            after: null,
          })
        }
        held.set(target, {})
        out.push({
          target,
          comp: 'tombstone',
          prop: null,
          before: null,
          after: {},
        })
        continue
      }
      let was = st[comp]
      if (value == null) {
        if (!was) continue
        out.push({ target, comp, prop: null, before: was, after: null })
        delete st[comp]
        continue
      }
      if (!was) {
        out.push({ target, comp, prop: null, before: null, after: {} })
        st[comp] = was = {}
      }
      let next: Comp = { ...was }
      for (let [prop, v] of written(value)) {
        out.push({
          target,
          comp,
          prop,
          before: was[prop] ?? null,
          after: v ?? null,
        })
        if (v == null) delete next[prop]
        else next[prop] = v
      }
      st[comp] = next
    }
    return out
  }

  let batchOf = (e: Entry): Batch => ({
    seq: e.seq,
    at: e.at,
    by: e.by,
    via: e.via,
    deltas: deltasOf(e),
  })

  // Transactions: their seq, when, who and through what, and the note.
  let txs = (s: Omit<Select, 't' | 'cols' | 'from'>): Select =>
    select({
      cols: [
        as(jt('id'), 'id'),
        as(jt('ts'), 'ts'),
        as(eidOf(jt('actor')), 'actor'),
        as(eidOf(jt('via')), 'via'),
        as(jt('trace'), 'trace'),
      ],
      from: table('journal_tx', 'jt'),
      ...s,
    })

  /** Every transaction that touched one entity, newest first, cut to that
   * entity. */
  let entries = (target: Eid, n = 50): Entry[] =>
    rows(select({
      cols: [
        as(jc('tx'), 'id'),
        as(jt('ts'), 'ts'),
        as(eidOf(jt('actor')), 'actor'),
        as(eidOf(jt('via')), 'via'),
        as(jt('trace'), 'trace'),
      ],
      from: table('journal_change', 'jc'),
      joins: [ofTx],
      where: eq(jc('entity'), idOf(target)),
      group: [jc('tx')],
      order: [desc(jc('tx'))],
      limit: val(n),
    })).map((r) => entryOf(r, target))

  /** Every transaction one instrument wrote, newest first, whole — a ledger
   * wants everything a transaction did, not one entity's part of it. */
  let by = (via: Eid, n = 500): Entry[] =>
    rows(txs({
      where: eq(jt('via'), idOf(via)),
      order: [desc(jt('id'))],
      limit: val(n),
    })).map((r) => entryOf(r))

  /** The transactions after a cursor, oldest first — the feed. The before-side
   * is not derived here: a feed replays what was written, and deriving it would
   * turn one range read into a walk of the log per entity. */
  let since = (cursor = 0): Entry[] =>
    rows(txs({ where: gt(jt('id'), val(cursor)), order: [jt('id')] }))
      .map((r) => entryOf(r))

  /** One transaction, whole, as a Batch — both sides of every movement, which
   * is what `undone()` reverses and `applied()` replays. */
  let at = (seq: number): Batch | undefined => {
    let found = one(txs({ where: eq(jt('id'), val(seq)) }))
    if (!found) return undefined
    let e = entryOf(found)
    return e.patches.length ? batchOf(e) : undefined
  }

  /** What happened to one entity, oldest first, as Batch values carrying only
   * the movements about that entity — what the `history` tool reports. */
  let history = (target: Eid, n = 50): Batch[] =>
    entries(target, n).reverse().map(batchOf)

  /** The last transaction that touched one entity, or 0 — what an undo with no
   * seq reverses. */
  let latest = (target: Eid): number =>
    num(
      one(select({
        cols: [as(fn('max', jc('tx')), 'id')],
        from: table('journal_change', 'jc'),
        where: eq(jc('entity'), idOf(target)),
      }))?.id,
    )

  /**
   * Every recorded write of one property, oldest first: the entity it was
   * about, what it wrote, and the transaction that wrote it. This is the
   * question a backfill asks — what has this property ever held, on any entity
   * — which no per-entity reader can answer.
   */
  let wrote = (
    comp: string,
    prop: string,
  ): { target: Eid; value: unknown; seq: number }[] =>
    rows(select({
      cols: [
        as(eidOf(jc('entity')), 'target'),
        as(jf('value'), 'value'),
        as(jc('tx'), 'seq'),
      ],
      from: table('journal_field', 'jf'),
      joins: [ofChange],
      where: and(
        eq(jc('component'), val(comp)),
        eq(jf('field'), val(prop)),
        eq(jf('present'), lit(1)),
        eq(jc('operation'), lit('upsert')),
      ),
      order: [jc('tx'), jf('id')],
    })).flatMap((r) =>
      r.target == null
        ? []
        : [{ target: String(r.target), value: dec(r.value), seq: num(r.seq) }]
    )

  /** The highest seq the log holds, or 0 — the cursor a reader starts from. */
  let tip = (): number =>
    num(
      one(
        select({
          cols: [as(fn('max', col('id')), 'm')],
          from: table('journal_tx'),
        }),
      )
        ?.m,
    )

  /** Has anything touched this entity since `seq`? The coarse "something
   * changed" question an undo asks where there is no property to put a
   * precondition on. */
  let touchedSince = (target: Eid, seq: number): boolean =>
    !!one(select({
      cols: [lit(1)],
      from: table('journal_change', 'jc'),
      where: and(eq(jc('entity'), idOf(target)), gt(jc('tx'), val(seq))),
      limit: lit(1),
    }))

  /**
   * Every recorded value that contains this text, oldest first — the scan a
   * redaction starts from. `value` is the stored JSON and `ref` the content
   * address when the property is content-addressed; the caller decodes and
   * decides, because whether a property holds content or structure is the
   * caller's policy, not the log's.
   */
  let seek = (text: string): Hit[] => {
    let encoded = JSON.stringify(text).slice(1, -1)
    let within = (e: Expr, s: string) => gt(fn('instr', e, val(s)), lit(0))
    return rows(select({
      cols: [
        as(jf('id'), 'id'),
        as(jf('value'), 'value'),
        as(jf('field'), 'field'),
        as(resolved, 'text'),
        as(eidOf(jc('entity')), 'target'),
        as(jc('component'), 'comp'),
        as(eidOf(jf('ref')), 'content'),
        as(jt('id'), 'seq'),
        as(jt('ts'), 'at'),
      ],
      from: table('journal_field', 'jf'),
      joins: [ofChange, ofTx, ...content],
      where: and(
        eq(jf('present'), lit(1)),
        cas
          ? or(within(jf('value'), encoded), within(col(cas.value, 'c'), text))
          : within(jf('value'), encoded),
      ),
      order: [jf('id')],
    })).map((r) => ({
      field: num(r.id),
      target: str(r.target),
      comp: String(r.comp),
      prop: String(r.field),
      seq: num(r.seq),
      at: String(r.at),
      value: r.text != null ? String(r.text) : dec(r.value),
      content: str(r.content),
    }))
  }

  /** Does the log still refer to this content? Content-addressed bytes outlive
   * the graph row that first wrote them, and this reports whether the log is
   * one of the things still holding a reference. */
  let holds = (ref: number): boolean =>
    !!one(select({
      cols: [lit(1)],
      from: table('journal_field'),
      where: eq(col('ref'), val(ref)),
      limit: lit(1),
    }))

  // Rewrite one recorded value in place — the one write here that is not an
  // append. A value deliberately forgotten has to leave the log too, or it
  // survives in the very thing that keeps history; the row itself stays, so the
  // chain of changes stays navigable and reads back as whatever replaced it.

  let scrub = (field: number, set: Record<string, Expr>) =>
    void rows({
      t: 'update',
      table: 'journal_field',
      set,
      where: eq(col('id'), val(field)),
    })

  /** Scrub an inline value, JSON-encoded as the log stores it. */
  let scrubValue = (field: number, value: string) =>
    scrub(field, { value: val(value) })

  /** Point a content-addressed value at clean content instead. */
  let scrubRef = (field: number, ref: number) => scrub(field, { ref: val(ref) })

  return {
    write,
    patches,
    entries,
    by,
    since,
    at,
    history,
    before,
    latest,
    wrote,
    tip,
    touchedSince,
    holds,
    seek,
    scrubValue,
    scrubRef,
  }
}

export { dec, enc }

/**
 * The log as a plugin, so that a graph keeps a journal by listing it:
 *
 * ```ts
 * let j = log({ rows })
 * graph({ storage, vocab, plugins: [journal(j)] })
 * ```
 *
 * It registers a hook on the `journal` phase alone: an after-image log needs to
 * read nothing in order to write, so nothing is gathered beforehand and nothing
 * is passed forward to a later phase. The transaction is recorded as applied —
 * one row per component the bundles patched or removed, in the order they
 * arrived.
 */
export let journal = (
  n: Log,
  opts: { now?: () => string; skip?: string[]; name?: string } = {},
): Plugin => {
  let clock = opts.now ?? (() => new Date().toISOString())
  let skip = new Set(opts.skip ?? ['created', 'updated'])
  return {
    name: opts.name ?? '@yaks/journal',
    hooks: {
      journal: (bundles: Bundle[], _tx: Tx) => {
        let applied: Patch[] = []
        for (let b of bundles) {
          let target = b.entity.eid
          if (dead(b)) {
            applied.push({ target, comp: 'entity', value: null })
            continue
          }
          for (let [comp, value] of comps(b)) {
            if (skip.has(comp)) continue
            applied.push({ target, comp, value: value ?? null })
          }
        }
        if (!applied.length) return bundles
        let actor = actorOf(bundles)
        n.write(
          { at: clock(), by: actor.by ?? null, via: actor.via ?? null },
          applied,
        )
        return bundles
      },
    },
  }
}
