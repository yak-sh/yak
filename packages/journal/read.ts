// The reading half: the three questions a journal is kept to answer.
//
//   history(src)(eid)      what happened to this entity, oldest first
//   at(src)(seq)           one batch, whole
//   since(src)(cursor)     the batches after a cursor, and the next cursor
//
// Each is a query over the same two components, so anything that can answer a
// query can answer them: a graph, a storage adapter, a client cache holding
// bundles. That is the whole of the seam — `Source` is one method wide.
//
// The joining is done by `seq` rather than by a walk: a delta carries the seq
// of the batch it belongs to, so a page of batches and every delta in that
// page are two reads over a range, however many entities the batches touched.

import type { Bundle, Comp, Eid, Query, ReadOpts } from '@yaks/graph'
import { then } from '@yaks/graph'
import { and, eq, gt, le, limit, list, order, pred } from '@yaks/query'
import { BATCH, DELTA } from './vocab.ts'
import { dec } from './value.ts'

/** Anything that can answer a query with bundles: a `Graph`, a `Storage`, a
 * transaction — the one method the reading half needs. */
export type Source = {
  /** a query → the matching entities as whole bundles */
  read: (query: Query, opts?: ReadOpts) => Bundle[] | Promise<Bundle[]>
}

/**
 * One thing that moved. A `column` names the column that moved, with the value
 * on each side of the write; a delta with NO column is about the component as
 * a whole — `after` set is the component appearing, `before` set is the
 * component going, and both spellings carry the columns it held.
 */
export type Delta = {
  /** the entity that changed */
  target: Eid
  /** the component that changed */
  comp: string
  /** the column that moved, or `null` for the whole component */
  column: string | null
  /** what it held before (`null` for nothing) */
  before: unknown
  /** what it holds after (`null` for nothing) */
  after: unknown
}

/** One committed batch: where it sits in the log, who wrote it, and what
 * moved. */
export type Batch = {
  /** its place in the total order — the cursor a feed pages by */
  seq: number
  /** when it committed, ISO-8601 */
  at: string
  /** the actor that wrote it, from the batch's `$actor` */
  by: Eid | null
  /** the instrument it was written through */
  via: Eid | null
  /** what moved, in the order it moved */
  deltas: Delta[]
}

/** A reader's place in the log: the last seq it has seen. Serializable, so a
 * server keeps one per subscriber and a worker keeps one on disk. */
export type Cursor = { seq: number }

/** A page of the feed: the batches after a cursor, and the cursor that follows
 * them. An empty page hands the cursor straight back. */
export type Feed = { batches: Batch[]; cursor: Cursor }

let seqOf = (b: Bundle, comp: string): number =>
  Number((b[comp] as Comp | undefined)?.seq ?? 0)

let ordOf = (b: Bundle): number =>
  Number((b[DELTA] as Comp | undefined)?.ord ?? 0)

let batchOf = (b: Bundle): Batch => {
  let c = (b[BATCH] ?? {}) as Comp
  return {
    seq: Number(c.seq ?? 0),
    at: String(c.at ?? ''),
    by: (c.by as Eid) ?? null,
    via: (c.via as Eid) ?? null,
    deltas: [],
  }
}

let deltaOf = (b: Bundle): Delta => {
  let c = (b[DELTA] ?? {}) as Comp
  return {
    target: String(c.target ?? ''),
    comp: String(c.comp ?? ''),
    column: c.column == null ? null : String(c.column),
    before: dec(c.before),
    after: dec(c.after),
  }
}

// Batches and deltas read separately, put back together: batches in seq order,
// each carrying the deltas that name it, in the order they happened. The order
// is the rows' own (`seq`, `ord`) and never the order an adapter answered in.
let gather = (batches: Bundle[], deltas: Bundle[]): Batch[] => {
  let out = batches.map(batchOf).sort((a, b) => a.seq - b.seq)
  let by = new Map(out.map((e) => [e.seq, e]))
  for (let d of [...deltas].sort((a, b) => ordOf(a) - ordOf(b))) {
    by.get(seqOf(d, DELTA))?.deltas.push(deltaOf(d))
  }
  return out
}

/**
 * What happened to one entity, oldest first — each batch that touched it,
 * with its actor and its moment, carrying only the deltas about THIS entity.
 * `n` keeps the most recent n batches (still oldest first).
 */
export let history = (src: Source) =>
(
  target: Eid,
  n?: number,
): Batch[] | Promise<Batch[]> =>
  then(
    src.read(and(eq(`${DELTA}.target`, target), order(`${DELTA}.seq`))),
    (found) => {
      let seqs = [...new Set(found.map((d) => seqOf(d, DELTA)))]
        .sort((a, b) => a - b)
      let want = n == null ? seqs : seqs.slice(-n)
      if (!want.length) return []
      let mine = found.filter((d) => want.includes(seqOf(d, DELTA)))
      return then(
        src.read(and(pred(`${BATCH}.seq`, '=', list(...want)))),
        (batches) => gather(batches, mine),
      )
    },
  )

/** One batch, whole — every delta it wrote, about every entity it touched.
 * `undefined` when no batch has that seq. */
export let at =
  (src: Source) =>
  (seq: number): Batch | undefined | Promise<Batch | undefined> =>
    then(
      src.read(and(eq(`${BATCH}.seq`, seq))),
      (batches) =>
        !batches.length ? undefined : then(
          src.read(and(eq(`${DELTA}.seq`, seq), order(`${DELTA}.seq`))),
          (deltas) => gather(batches, deltas)[0],
        ),
    )

/**
 * The batches committed after a cursor, oldest first, with the cursor that
 * follows them — the feed a server recasts to its subscribers and a worker
 * drives effects from.
 *
 * ```ts
 * let page = since(g)(mine)          // { batches, cursor }
 * for (let b of page.batches) cast(applied(b))
 * mine = page.cursor                 // store it, then do the work: at most once
 * ```
 *
 * A batch is never handed out twice: the cursor is the highest seq the page
 * carried, and the next page starts strictly after it. `n` caps the page.
 */
export let since = (src: Source) =>
(
  cursor: Cursor = { seq: 0 },
  n = 100,
): Feed | Promise<Feed> =>
  then(
    src.read(
      and(gt(`${BATCH}.seq`, cursor.seq), order(`${BATCH}.seq`), limit(n)),
    ),
    (batches) => {
      if (!batches.length) return { batches: [], cursor }
      let hi = Math.max(...batches.map((b) => seqOf(b, BATCH)))
      return then(
        src.read(
          and(
            gt(`${DELTA}.seq`, cursor.seq),
            le(`${DELTA}.seq`, hi),
            order(`${DELTA}.seq`),
          ),
        ),
        (deltas) => ({ batches: gather(batches, deltas), cursor: { seq: hi } }),
      )
    },
  )
