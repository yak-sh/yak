// Keeping the vectors true to the text, off the write path.
//
// Embedding is slow and remote; a write is neither. So nothing here runs when a
// row changes — the sweep runs on its own schedule and reconciles: it drops the
// vectors of entities that no longer have text, and re-embeds the ones whose
// text (or model) moved. What decides "moved" is the content hash stored beside
// each vector, so an unchanged corpus costs one query and no embedder calls.
//
// The sweep is the only asynchronous thing in this package, because an embedder
// may be a network call. Everything a query touches stays synchronous.

import type { Eid } from '@yaks/graph'
import type { Driver } from './driver.ts'
import { type Embedder, hash } from './embedder.ts'
import { type Field, pieces, q } from './fields.ts'
import { TABLE } from './ddl.ts'
import { pack, unit } from './vector.ts'

/**
 * One entity's embeddable text: its integer owner id, its eid, the text joined
 * from every field it wears, and the hash of the vector already stored for it
 * (null when it has none).
 */
export type Source = {
  owner: number
  entity: Eid
  text: string
  had: string | null
}

// The pieces joined per entity, in field order. Assembled here rather than with
// a SQL group_concat because the join order matters and SQLite does not promise
// one for an aggregate.
let assemble = (
  rows: { owner: number; eid: Eid; had: string | null; t: string }[],
): Source[] => {
  let by = new Map<number, Source>()
  for (let r of rows) {
    let s = by.get(r.owner) ??
      { owner: r.owner, entity: r.eid, text: '', had: r.had }
    s.text = s.text ? `${s.text}\n${r.t}` : r.t
    by.set(r.owner, s)
  }
  return [...by.values()]
}

/**
 * Every living entity with text to embed, its text assembled and its stored
 * hash beside it. The graves are excluded here rather than pruned later, so a
 * deleted entity stops being a neighbour immediately.
 */
export let sources = (db: Driver, fields: Field[]): Source[] => {
  let text = pieces(fields)
  if (!text) return []
  let rows = db.query(
    `select o.id as owner, o.eid as eid, e.hash as had, s.ord as ord, s.t as t` +
      ` from (${text.sql}) s` +
      ` join entity o on o.id = s.owner` +
      ` left join ${q(TABLE)} e on e.entity = s.owner` +
      ` where not exists (select 1 from tombstone t where t.entity = s.owner)` +
      ` order by o.id, s.ord`,
    text.params,
  ) as unknown as { owner: number; eid: Eid; had: string | null; t: string }[]
  return assemble(rows)
}

/**
 * The entities owed a (re)embedding: those whose stored hash no longer names
 * their text under this model. Pure SQL and a hash — the testable half of the
 * sweep, with no embedder in sight.
 */
export let stale = (
  db: Driver,
  fields: Field[],
  model: string,
  limit = Infinity,
): Source[] =>
  sources(db, fields)
    .filter((s) => s.had != hash(model, s.text))
    .slice(0, limit)

/**
 * Drop the vectors of entities that no longer have any: deleted, emptied, or
 * no longer wearing an embedded component. Reads the SAME rule {@link sources}
 * embeds by, so the table can never keep a vector the sweep would never refresh.
 */
export let prune = (db: Driver, fields: Field[]): void => {
  let text = pieces(fields)
  if (!text) return
  db.query(
    `delete from ${q(TABLE)} where entity not in (` +
      `select s.owner from (${text.sql}) s` +
      ` where not exists (select 1 from tombstone t where t.entity = s.owner))`,
    text.params,
  )
}

/** Store one entity's vector, replacing whatever it had. */
export let put = (
  db: Driver,
  owner: number,
  model: string,
  text: string,
  vec: Float32Array,
): void => {
  db.query(
    `insert into ${q(TABLE)} (entity, model, hash, vec, at)` +
      ` values (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))` +
      ` on conflict (entity) do update set model = excluded.model,` +
      ` hash = excluded.hash, vec = excluded.vec, at = excluded.at`,
    [owner, model, hash(model, text), pack(unit(vec))],
  )
}

/** What one sweep did. */
export type Swept = {
  /** how many entities were (re)embedded */
  fresh: number
  /** how many were still owed one when the sweep stopped */
  left: number
}

/**
 * One reconciliation pass: prune, then embed what is stale, oldest work first.
 * `limit` bounds a pass so a huge backlog can be drained in slices; the default
 * drains it whole. An embedder that throws stops the pass — the rest stay stale
 * for the next one, and the error reaches the caller rather than being swallowed
 * into a quietly half-embedded corpus.
 */
export let sweep = async (
  db: Driver,
  fields: Field[],
  embedder: Embedder,
  limit = Infinity,
): Promise<Swept> => {
  prune(db, fields)
  let owed = stale(db, fields, embedder.model)
  let fresh = 0
  for (let s of owed.slice(0, limit)) {
    put(db, s.owner, embedder.model, s.text, await embedder.embed(s.text))
    fresh++
  }
  return { fresh, left: owed.length - fresh }
}
