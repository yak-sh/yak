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
// The caller supplies one function: `rows(sql, params)`. No platform API, no
// driver object, and no transaction of its own — the caller owns the
// transaction.

import type { Bundle, Comp, Eid, Plugin, Tx } from '@yaks/graph'
import { actorOf, comps, dead } from '@yaks/graph'
import type { Batch, Delta, Entry, Patch } from './batch.ts'
import { dec, enc } from './value.ts'

/** A parameterized statement, run for its rows: the whole of what the caller
 * has to supply. A write goes through it too — `insert … returning id` returns
 * a row. */
export type Rows = (
  sql: string,
  params: unknown[],
) => Record<string, unknown>[]

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
export let ddl = (spine = 'entity'): string => `
  create table if not exists journal_tx (
    id    integer primary key,
    ts    text not null,
    actor integer references ${spine}(id),
    via   integer references ${spine}(id),
    trace text
  );
  create table if not exists journal_change (
    id        integer primary key,
    tx        integer not null references journal_tx(id),
    ordinal   integer not null,
    entity    integer not null references ${spine}(id),
    component text not null,
    operation text not null
  );
  create table if not exists journal_field (
    id       integer primary key,
    change   integer not null references journal_change(id),
    ordinal  integer not null,
    field    text not null,
    present  integer not null,
    value    text,
    ref      integer references ${spine}(id)
  );
  create index if not exists journal_change_tx on journal_change(tx, ordinal);
  create index if not exists journal_change_ent
    on journal_change(entity, component);
  create index if not exists journal_field_change
    on journal_field(change, ordinal);
  create index if not exists journal_field_ref
    on journal_field(ref) where ref is not null;
`

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
    meta: { at: string; by?: Eid | null; via?: Eid | null; note?: unknown },
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
  /** the SQL fragment turning an eid into the entity table's integer id, for a
   * caller that has to reach the same rows */
  spineId: string
}

/**
 * Bind the log to a store.
 *
 * ```ts
 * let j = log({ rows: (sql, p) => db.prepare(sql).all(...p) })
 * j.write({ at, by, via, note }, patches) // inside the caller's transaction
 * j.history('T-1')                        // Batch[], oldest first
 * j.since(cursor)                         // Entry[], the feed
 * ```
 */
export let log = (opts: LogOpts): Log => {
  let rows = opts.rows
  let table = opts.spine?.table ?? 'entity'
  let idCol = opts.spine?.id ?? 'id'
  let eidCol = opts.spine?.eid ?? 'eid'
  let cas = opts.cas
  // An eid bound where a column holds an entity-table id, and the lookup back
  // the other way.
  let spineId = `(select ${idCol} from ${table} where ${eidCol} = ?)`
  let eidOf = (col: string) =>
    `(select ${eidCol} from ${table} where ${idCol} = ${col})`
  let one = (sql: string, params: unknown[] = []) => rows(sql, params)[0]
  let num = (v: unknown) => Number(v ?? 0)
  let str = (v: unknown) => (v == null ? null : String(v))

  // Every change of a transaction, optionally cut to one entity, in applied
  // order. A change whose entity has no row in the entity table is not read —
  // once that row is purged there is no eid left to report.
  let changeRows = `select jc.id as id, e.${eidCol} as eid,
      jc.component as component, jc.operation as operation
    from journal_change jc join ${table} e on e.${idCol} = jc.entity`

  // A property recorded by address reads its text back through the content it
  // names.
  let fieldsSql = cas
    ? `select jf.field as field, jf.value as value, c.${cas.value} as text
       from journal_field jf
       left join ${cas.table} c on c.${cas.key} = jf.ref
       where jf.change = ? and jf.present = 1 order by jf.ordinal`
    : `select jf.field as field, jf.value as value, null as text
       from journal_field jf
       where jf.change = ? and jf.present = 1 order by jf.ordinal`

  let rebuild = (found: Record<string, unknown>[]): Patch[] =>
    found.map((ch) => {
      let target = String(ch.eid)
      let comp = String(ch.component)
      if (ch.operation == 'remove') return { target, comp, value: null }
      let value: Comp = {}
      for (let f of rows(fieldsSql, [ch.id])) {
        value[String(f.field)] = f.text ?? dec(f.value)
      }
      return { target, comp, value }
    })

  /** One transaction's operations, whole or cut to one entity, in applied
   * order. */
  let patches = (seq: number, target?: Eid): Patch[] =>
    rebuild(
      target == null
        ? rows(`${changeRows} where jc.tx = ? order by jc.ordinal`, [seq])
        : rows(
          `${changeRows} where jc.tx = ? and e.${eidCol} = ?
           order by jc.ordinal`,
          [seq, target],
        ),
    )

  let entryOf = (r: Record<string, unknown>, target?: Eid): Entry => ({
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
    meta: { at: string; by?: Eid | null; via?: Eid | null; note?: unknown },
    applied: Patch[],
  ): number => {
    let seq = num(
      one(
        `insert into journal_tx (ts, actor, via, trace)
         values (?, ${spineId}, ${spineId}, ?) returning id`,
        [meta.at, meta.by ?? null, meta.via ?? null, meta.note ?? null],
      )?.id,
    )
    // The properties a component still holds, newest after-image per property:
    // the field id is monotonic, so the highest-id row per property is the
    // latest in total order — and it reads this transaction's earlier upserts,
    // which are uncommitted but visible on the same connection.
    let held = `select field from (
        select jf.field as field, jf.present as present,
               row_number() over (
                 partition by jf.field order by jf.id desc) as rn
        from journal_field jf join journal_change jc on jc.id = jf.change
        where jc.entity = ${spineId} and jc.component = ?
      ) where rn = 1 and present = 1`
    applied.forEach(({ target, comp, value }, ordinal) => {
      let change = num(
        one(
          `insert into journal_change (tx, ordinal, entity, component,
             operation) values (?, ?, ${spineId}, ?, ?) returning id`,
          [seq, ordinal, target, comp, value == null ? 'remove' : 'upsert'],
        )?.id,
      )
      let field = (i: number, name: string, v: string | null, ref: unknown) =>
        rows(
          `insert into journal_field (change, ordinal, field, present, value,
             ref) values (?, ?, ?, ?, ?, ?)`,
          [change, i, name, v == null && ref == null ? 0 : 1, v, ref ?? null],
        )
      if (value == null) {
        // A removal tombstones every property the component still had, so
        // property history stays self-contained across a removal and a later
        // recreation.
        rows(held, [target, comp]).forEach((f, i) =>
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
      let p of rebuild(rows(
        `${changeRows} where jc.entity = ${spineId} and jc.tx < ?
         order by jc.tx, jc.ordinal`,
        [target, seq],
      ))
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

  let txRows = `select id, ts, ${eidOf('actor')} as actor,
      ${eidOf('via')} as via, trace from journal_tx`

  /** Every transaction that touched one entity, newest first, cut to that
   * entity. */
  let entries = (target: Eid, n = 50): Entry[] =>
    rows(
      `select jc.tx as id, jt.ts as ts, ${eidOf('jt.actor')} as actor,
              ${eidOf('jt.via')} as via, jt.trace as trace
       from journal_change jc join journal_tx jt on jt.id = jc.tx
       where jc.entity = ${spineId}
       group by jc.tx order by jc.tx desc limit ?`,
      [target, n],
    ).map((r) => entryOf(r, target))

  /** Every transaction one instrument wrote, newest first, whole — a ledger
   * wants everything a transaction did, not one entity's part of it. */
  let by = (via: Eid, n = 500): Entry[] =>
    rows(`${txRows} where via = ${spineId} order by id desc limit ?`, [via, n])
      .map((r) => entryOf(r))

  /** The transactions after a cursor, oldest first — the feed. The before-side
   * is not derived here: a feed replays what was written, and deriving it would
   * turn one range read into a walk of the log per entity. */
  let since = (cursor = 0): Entry[] =>
    rows(`${txRows} where id > ? order by id`, [cursor]).map((r) => entryOf(r))

  /** One transaction, whole, as a Batch — both sides of every movement, which
   * is what `undone()` reverses and `applied()` replays. */
  let at = (seq: number): Batch | undefined => {
    let found = one(`${txRows} where id = ?`, [seq])
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
      one(
        `select max(tx) as id from journal_change where entity = ${spineId}`,
        [target],
      )?.id,
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
    rows(
      `select ${eidOf('jc.entity')} as target, jf.value as value, jc.tx as seq
         from journal_field jf join journal_change jc on jc.id = jf.change
        where jc.component = ? and jf.field = ? and jf.present = 1
          and jc.operation = 'upsert'
        order by jc.tx, jf.id`,
      [comp, prop],
    ).flatMap((r) =>
      r.target == null
        ? []
        : [{ target: String(r.target), value: dec(r.value), seq: num(r.seq) }]
    )

  /** The highest seq the log holds, or 0 — the cursor a reader starts from. */
  let tip = (): number => num(one(`select max(id) as m from journal_tx`)?.m)

  /** Has anything touched this entity since `seq`? The coarse "something
   * changed" question an undo asks where there is no property to put a
   * precondition on. */
  let touchedSince = (target: Eid, seq: number): boolean =>
    !!one(
      `select 1 from journal_change where entity = ${spineId} and tx > ?
       limit 1`,
      [target, seq],
    )

  /**
   * Every recorded value that contains this text, oldest first — the scan a
   * redaction starts from. `value` is the stored JSON and `ref` the content
   * address when the property is content-addressed; the caller decodes and
   * decides, because whether a property holds content or structure is the
   * caller's policy, not the log's.
   */
  let seek = (text: string): Hit[] => {
    let encoded = JSON.stringify(text).slice(1, -1)
    return rows(
      `select jf.id as id, jf.value as value, jf.field as field,
              ${cas ? 'c.' + cas.value : 'null'} as text,
              ${eidOf('jc.entity')} as target, jc.component as comp,
              ${eidOf('jf.ref')} as content, jt.id as seq, jt.ts as at
         from journal_field jf
         join journal_change jc on jc.id = jf.change
         join journal_tx jt on jt.id = jc.tx
         ${cas ? `left join ${cas.table} c on c.${cas.key} = jf.ref` : ''}
        where jf.present = 1
          and (instr(jf.value, ?) > 0${
        cas ? ` or instr(c.${cas.value}, ?) > 0` : ''
      })
        order by jf.id`,
      cas ? [encoded, text] : [encoded],
    ).map((r) => ({
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
    !!one(`select 1 from journal_field where ref = ? limit 1`, [ref])

  // Rewrite one recorded value in place — the one write here that is not an
  // append. A value deliberately forgotten has to leave the log too, or it
  // survives in the very thing that keeps history; the row itself stays, so the
  // chain of changes stays navigable and reads back as whatever replaced it.

  /** Scrub an inline value, JSON-encoded as the log stores it. */
  let scrubValue = (field: number, value: string) => {
    rows(`update journal_field set value = ? where id = ?`, [value, field])
  }

  /** Point a content-addressed value at clean content instead. */
  let scrubRef = (field: number, ref: number) => {
    rows(`update journal_field set ref = ? where id = ?`, [ref, field])
  }

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
    /** the SQL fragment turning an eid into the entity table's integer id,
     * for a caller that has to reach the same rows */
    spineId,
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
