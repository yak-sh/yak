// The journal as three relational tables instead of entities on the spine.
//
// `./record.ts` writes a batch and a delta per movement as ORDINARY ENTITIES,
// which is what makes the log queryable with the same grammar as everything
// else and storable by any adapter — a Map in a browser tab included. On a
// graph with hundreds of thousands of entities that shape costs a spine row
// and a minted id per column that moved, and keeps both sides of every write
// where only one of them is news. This module is the other trade: three
// append-only tables OFF the spine, integer ids, AFTER-IMAGES only, with the
// before-value derived at read time from the entity's own slice of the log.
// Same questions, same answers, a third of the bytes.
//
//   tx     one row per committed batch — its id IS the total order and cursor
//   change one ordered operation per component patched or removed
//   field  one ordered after-image per column an operation wrote
//
// A reading is never needed to write, so there is no `precondition` phase and
// nothing rides forward on the batch: the log is derived wholly from what was
// applied. What it costs instead is that `before` is a read — bounded to one
// entity's own slice, never a scan of the log.
//
// The host is one function wide: `rows(sql, params)`. No platform API, no
// driver object, no transaction of its own — the caller owns the transaction,
// so a refused batch leaves no trace exactly as it does in `./record.ts`.

import type { Comp, Eid } from '@yaks/graph'
import type { Batch, Delta } from './read.ts'
import { dec, enc } from './value.ts'

/** A parameterized statement, run for its rows: the whole of the host. A
 * write goes through it too — `insert … returning id` answers a row. */
export type Rows = (
  sql: string,
  params: unknown[],
) => Record<string, unknown>[]

/**
 * One recorded operation: a component patched to `value`, or removed when
 * `value` is null. The unit the tables store natively and the unit a wire that
 * speaks component patches replays — a batch is a list of these, in the order
 * they were applied.
 */
export type Patch = {
  /** the entity the operation was about */
  target: Eid
  /** the component it patched, or `entity` for the spine itself */
  comp: string
  /** the columns it wrote, or `null` for a removal */
  value: Comp | null
}

/** One committed batch as the tables hold it: its provenance, the note the
 * writer left beside it, and what it did. */
export type Entry = {
  /** its place in the total order — the cursor a feed pages by */
  seq: number
  /** when it committed, ISO-8601 */
  at: string
  /** the actor it resolved to, or null when unowned */
  by: Eid | null
  /** the instrument it was written through */
  via: Eid | null
  /** whatever the writer wrote down beside the batch, verbatim */
  note: string | null
  /** what it did, in the order it did it */
  patches: Patch[]
}

/**
 * A column whose text the graph already stores once, under a content address.
 * The journal then records the ADDRESS and shares the graph's bytes instead of
 * repeating them — which is the difference between a log that keeps every
 * revision of every document and one that keeps a row per revision.
 */
export type Cas = {
  /** is this column content-addressed? */
  at: (comp: string, column: string) => boolean
  /** land the text and answer the id the journal records */
  put: (text: string) => number
  /** the table holding the content, and its key and value columns */
  table: string
  key: string
  value: string
}

/**
 * One recorded value a {@link Normal.seek} found: where it sits in the log,
 * the value as stored, and the content address when the column is
 * content-addressed.
 */
export type Hit = {
  /** the row's own id — what a scrub names */
  field: number
  /** the entity the value was written about */
  target: Eid | null
  /** the component and column it belongs to */
  comp: string
  column: string
  /** the batch it rode and when that committed */
  seq: number
  at: string
  /** the value as recorded, decoded */
  value: unknown
  /** the content it refs, when the column is content-addressed */
  content: Eid | null
}

/** How a normalized journal is bound. */
export type NormalOpts = {
  /** the statement runner — the whole host */
  rows: Rows
  /** the spine: where an eid becomes the integer the tables store */
  spine?: { table?: string; id?: string; eid?: string }
  /** content-addressed columns, if the graph has any */
  cas?: Cas
}

// The tables. Append-only, no eid of their own, never in a snapshot and never
// in a client cache: this is the record OF the wire, not part of it.
//
// `tx.id` is an integer primary key, so it is the next rowid — monotonic,
// which is what lets the total order rest on something other than a clock, and
// what every cursor in the system holds.
//
// `change.operation` is `upsert` (a present component, an empty one being an
// upsert with no field rows) or `remove` (a component removed, or the entity
// dead when component = 'entity'). A spine row outlives its entity, so every
// change names one.
//
// `field.present = 1` records a written value, JSON-encoded, so a present null
// stays distinct from a tombstone; `present = 0` is the TOMBSTONE written for
// each then-present column when its component is removed, so column history,
// predecessor lookup and undo stay self-contained and no value leaks across a
// removal and a later recreation. `ref` names content-addressed bytes the
// graph already holds, and then `value` stays null.
export let normalDdl = (spine = 'entity'): string => `
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

// The columns an after-image records: everything but `eid`, which is the row's
// own identity and already the change's entity.
let written = (value: Comp): [string, unknown][] =>
  Object.entries(value).filter(([column]) => column != 'eid')

/** The normalized journal bound to one store. */
export type Normal = ReturnType<typeof normalized>

/**
 * Bind the normalized journal to a store.
 *
 * ```ts
 * let j = normalized({ rows: (sql, p) => db.prepare(sql).all(...p) })
 * j.write({ at, by, via, note }, patches) // inside the caller's transaction
 * j.history('T-1')                        // Batch[], oldest first
 * j.since(cursor)                         // Entry[], the feed
 * ```
 */
export let normalized = (opts: NormalOpts) => {
  let rows = opts.rows
  let table = opts.spine?.table ?? 'entity'
  let idCol = opts.spine?.id ?? 'id'
  let eidCol = opts.spine?.eid ?? 'eid'
  let cas = opts.cas
  // An eid bound where a column holds a spine id, and the projection back.
  let spineId = `(select ${idCol} from ${table} where ${eidCol} = ?)`
  let eidOf = (col: string) =>
    `(select ${eidCol} from ${table} where ${idCol} = ${col})`
  let one = (sql: string, params: unknown[] = []) => rows(sql, params)[0]
  let num = (v: unknown) => Number(v ?? 0)
  let str = (v: unknown) => (v == null ? null : String(v))

  // Every change of a batch, optionally cut to one entity, in applied order.
  // A change whose entity has no spine row is not read — a purged spine has no
  // eid to speak.
  let changeRows = `select jc.id as id, e.${eidCol} as eid,
      jc.component as component, jc.operation as operation
    from journal_change jc join ${table} e on e.${idCol} = jc.entity`

  // A ref'd column reads its text back through the content it names.
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

  /** One batch's operations, whole or cut to one entity, in applied order. */
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
   * Write one batch down, inside the caller's transaction, and answer its
   * seq. Derived wholly from what was applied: nothing was read first, so a
   * writer owes this call nothing but the truth about what it wrote.
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
    // The columns a component still holds, newest after-image per column: the
    // field id is monotonic, so the highest-id row per column is the latest in
    // total order — and it reads THIS batch's earlier upserts, uncommitted but
    // visible on the same connection.
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
        // A removal tombstones every column the component still had, so
        // column history stays self-contained across a removal and a later
        // recreation.
        rows(held, [target, comp]).forEach((f, i) =>
          field(i, String(f.field), null, null)
        )
        return
      }
      // An upsert records one present after-image per column, JSON-encoded so
      // a present null stays distinct from a tombstone. An empty component
      // writes none — its change row alone marks its presence.
      written(value).forEach(([column, v], i) =>
        cas && cas.at(comp, column) && typeof v == 'string'
          ? field(i, column, null, cas.put(v))
          : field(i, column, JSON.stringify(v) ?? 'null', null)
      )
    })
    return seq
  }

  /**
   * One entity's component state as of just BEFORE `seq`, rebuilt by
   * column-merging that entity's own slice of the log — bounded to one entity,
   * never a scan. This is where the before-value an after-image log does not
   * store comes from.
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
      // A death mid-window cannot precede a live target, but resetting keeps
      // the reconstruction honest if one is seen.
      if (p.comp == 'entity') {
        if (!p.value) state = {}
        continue
      }
      if (p.value == null) delete state[p.comp]
      else state[p.comp] = { ...(state[p.comp] ?? {}), ...p.value }
    }
    return state
  }

  // An entry's operations said as the package says them: a component that was
  // not there is announced by a column-less delta before its columns follow, a
  // component that went is a column-less delta carrying what it held, and a
  // death is a tombstone. The before-side comes from `before()`, carried
  // forward across the batch so a batch that touches one component twice reads
  // as two movements.
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
            column: null,
            before: was,
            after: null,
          })
        }
        held.set(target, {})
        out.push({
          target,
          comp: 'tombstone',
          column: null,
          before: null,
          after: {},
        })
        continue
      }
      let was = st[comp]
      if (value == null) {
        if (!was) continue
        out.push({ target, comp, column: null, before: was, after: null })
        delete st[comp]
        continue
      }
      if (!was) {
        out.push({ target, comp, column: null, before: null, after: {} })
        st[comp] = was = {}
      }
      let next: Comp = { ...was }
      for (let [column, v] of written(value)) {
        out.push({
          target,
          comp,
          column,
          before: was[column] ?? null,
          after: v ?? null,
        })
        if (v == null) delete next[column]
        else next[column] = v
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

  /** Every batch that touched one entity, newest first, cut to that entity. */
  let entries = (target: Eid, n = 50): Entry[] =>
    rows(
      `select jc.tx as id, jt.ts as ts, ${eidOf('jt.actor')} as actor,
              ${eidOf('jt.via')} as via, jt.trace as trace
       from journal_change jc join journal_tx jt on jt.id = jc.tx
       where jc.entity = ${spineId}
       group by jc.tx order by jc.tx desc limit ?`,
      [target, n],
    ).map((r) => entryOf(r, target))

  /** Every batch one instrument wrote, newest first, whole — a ledger wants
   * the batch's full sentence, not one entity's slice of it. */
  let by = (via: Eid, n = 500): Entry[] =>
    rows(`${txRows} where via = ${spineId} order by id desc limit ?`, [via, n])
      .map((r) => entryOf(r))

  /** The batches after a cursor, oldest first — the feed. The before-side is
   * not derived here: a feed replays what was written, and deriving it would
   * turn a range read into a walk per entity. */
  let since = (cursor = 0): Entry[] =>
    rows(`${txRows} where id > ? order by id`, [cursor]).map((r) => entryOf(r))

  /** One batch, whole, as the package's own Batch — both sides of every
   * movement, which is what `undone()` reverses and `applied()` replays. */
  let at = (seq: number): Batch | undefined => {
    let found = one(`${txRows} where id = ?`, [seq])
    if (!found) return undefined
    let e = entryOf(found)
    return e.patches.length ? batchOf(e) : undefined
  }

  /** What happened to one entity, oldest first, as the package's own Batch —
   * carrying only the movements about that entity, which is what
   * `history(src)` answers over the component layout. */
  let history = (target: Eid, n = 50): Batch[] =>
    entries(target, n).reverse().map(batchOf)

  /** The last batch that touched one entity, or 0 — what an undo with no seq
   * reverses. */
  let latest = (target: Eid): number =>
    num(
      one(
        `select max(tx) as id from journal_change where entity = ${spineId}`,
        [target],
      )?.id,
    )

  /**
   * Every recorded write of one column, oldest first: the entity it was about,
   * what it wrote, and the batch it rode. The question a backfill asks — what
   * did this column ever hold, anywhere — which no per-entity reader answers.
   */
  let wrote = (
    comp: string,
    column: string,
  ): { target: Eid; value: unknown; seq: number }[] =>
    rows(
      `select ${eidOf('jc.entity')} as target, jf.value as value, jc.tx as seq
         from journal_field jf join journal_change jc on jc.id = jf.change
        where jc.component = ? and jf.field = ? and jf.present = 1
          and jc.operation = 'upsert'
        order by jc.tx, jf.id`,
      [comp, column],
    ).flatMap((r) =>
      r.target == null
        ? []
        : [{ target: String(r.target), value: dec(r.value), seq: num(r.seq) }]
    )

  /** The highest seq the log holds, or 0 — the cursor a reader starts from. */
  let tip = (): number => num(one(`select max(id) as m from journal_tx`)?.m)

  /** Has anything touched this entity since `seq`? The coarse "the world
   * moved" an undo asks where there is no column to guard. */
  let touchedSince = (target: Eid, seq: number): boolean =>
    !!one(
      `select 1 from journal_change where entity = ${spineId} and tx > ?
       limit 1`,
      [target, seq],
    )

  /**
   * Every recorded value that contains this text, oldest first — the scan a
   * redaction starts from. `value` is the stored JSON and `ref` the content
   * address when the column is content-addressed; the caller decodes and
   * decides, because whether a column is content or structure is its policy,
   * not the log's.
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
      column: String(r.field),
      seq: num(r.seq),
      at: String(r.at),
      value: r.text != null ? String(r.text) : dec(r.value),
      content: str(r.content),
    }))
  }

  /** Does the log still hold this content? Content-addressed bytes outlive
   * the graph row that first wrote them, and this is who else is holding. */
  let holds = (ref: number): boolean =>
    !!one(`select 1 from journal_field where ref = ? limit 1`, [ref])

  // Rewrite one recorded value in place — the one write here that is not an
  // append. A value deliberately forgotten must leave the log too, or it leaks
  // through the door that keeps history; the row stays, so the chain stays
  // navigable and reads back as whatever replaced it.

  /** Scrub an inline value, JSON-encoded as the log stores it. */
  let scrubValue = (field: number, value: string) => {
    rows(`update journal_field set value = ? where id = ?`, [value, field])
  }

  /** Repoint a content-addressed value at clean content. */
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
    /** the eid→spine-id fragment, for a host that must reach the same rows */
    spineId,
  }
}

export { dec, enc }
