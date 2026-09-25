// Keeping the vectors in step with the text, off the write path.
//
// Embedding is slow and usually remote; a write is neither. So nothing here
// runs when a row changes: a trigger notes the entity (./owed.ts), and the
// sweep runs on its own schedule and settles what was noted — it deletes the
// vectors of entities that no longer have text, and re-embeds the ones whose
// text (or model) changed. What decides "changed" is the content hash stored
// beside each vector, so an entity queued without its text moving costs a
// read and no call to the embedder.
//
// The sweep is the only asynchronous thing in this package, because an embedder
// may be a network call. Everything a query touches stays synchronous.

import type { Eid } from '@yaks/graph'
import {
  as,
  at,
  col,
  type Driver,
  eq,
  exists,
  fn,
  from,
  join,
  lit,
  not,
  select,
  sub,
  table,
  val,
} from '@yaks/sql'
import { type Embedder, hash, Refused } from './embedder.ts'
import { type Field, pieces } from './fields.ts'
import { TABLE } from './ddl.ts'
import { due, left, owe, paid, watch } from './owed.ts'
import { pack, unit } from './vector.ts'

/** How many queued entities one sweep takes by default. */
export let BATCH = 64

/**
 * One entity's embeddable text: its integer owner id, its eid, the text of all
 * its embedded fields joined together, and the hash of the vector already
 * stored for it (null when it has none).
 */
export type Source = {
  owner: number
  entity: Eid
  text: string
  had: string | null
}

// The pieces joined per entity, in field order. Assembled here rather than with
// a SQL group_concat because the order matters and SQLite does not guarantee
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
 * Every entity that still exists and has text to embed — or those of `owners`
 * that do — its text assembled and its stored hash beside it. Deleted entities
 * are left out, so an entity stops being a neighbour as soon as it is deleted.
 */
export let sources = (
  db: Driver,
  fields: Field[],
  owners?: number[],
): Source[] => {
  let text = pieces(fields, owners)
  if (!text) return []
  let s = at('s'), o = at('o'), e = at('e')
  let rows = db.query(select({
    cols: [
      as(o('id'), 'owner'),
      as(o('eid'), 'eid'),
      as(e('hash'), 'had'),
      as(s('ord'), 'ord'),
      as(s('t'), 't'),
    ],
    from: from(text, 's'),
    joins: [
      join(table('entity', 'o'), eq(o('id'), s('owner'))),
      { how: 'left', src: table(TABLE, 'e'), on: eq(e('entity'), s('owner')) },
    ],
    where: not(exists(select({
      cols: [lit(1)],
      from: table('tombstone', 't'),
      where: eq(col('entity', 't'), s('owner')),
    }))),
    order: [o('id'), s('ord')],
  }))
  return assemble(rows.map((r) => ({
    owner: Number(r.owner),
    eid: String(r.eid),
    had: r.had == null ? null : String(r.had),
    t: String(r.t),
  })))
}

/** Store one entity's vector, replacing whatever it had. */
export let put = (
  db: Driver,
  owner: number,
  model: string,
  text: string,
  vec: Float32Array,
): void => {
  let fresh = (k: string) => col(k, 'excluded')
  db.query({
    t: 'insert',
    into: TABLE,
    cols: ['entity', 'model', 'hash', 'vec'],
    rows: [[
      val(owner),
      val(model),
      val(hash(model, text)),
      val(pack(unit(vec))),
    ]],
    upsert: [{
      on: [col('entity')],
      set: {
        model: fresh('model'),
        hash: fresh('hash'),
        vec: fresh('vec'),
        at: fresh('at'),
      },
    }],
  })
}

// Delete one entity's vector: it has no text to make one from, or its text
// was refused.
let drop = (db: Driver, owner: number): void =>
  void db.query({
    t: 'delete',
    from: TABLE,
    where: eq(col('entity'), val(owner)),
  })

// Whether any stored vector was made by another model. Asked only once the
// queue is empty, so a model change queues everything once, not every pass.
// The smallest and largest model name, each read off the model index: a scan
// for one that differs would read every vector.
let moved = (db: Driver, model: string): boolean => {
  let edge = (f: string) =>
    sub(select({ cols: [fn(f, col('model'))], from: table(TABLE) }))
  let [r] = db.query(
    select({ cols: [as(edge('min'), 'lo'), as(edge('max'), 'hi')] }),
  )
  return r.lo != null && (r.lo != model || r.hi != model)
}

// The vectors for a batch of texts, asked for together; a text the embedder
// refused is its `Refused`. One refusal fails the request it rode in, so a
// refused batch is asked again a text at a time to find it. Anything else is
// an embedder that cannot be reached, and stops the sweep.
let embedAll = async (
  embedder: Embedder,
  texts: string[],
): Promise<(Float32Array | Refused)[]> => {
  let ask = async (t: string) => {
    try {
      return await embedder.embed(t)
    } catch (error) {
      if (error instanceof Refused) return error
      throw error
    }
  }
  let got = await Promise.all(texts.map(ask))
  if (texts.length < 2 || !got.some((v) => v instanceof Refused)) return got
  let one: (Float32Array | Refused)[] = []
  for (let t of texts) one.push(await ask(t))
  return one
}

/** What one sweep did. */
export type Swept = {
  /** how many entities were (re)embedded */
  fresh: number
  /** how many were still owed a look when the sweep stopped */
  left: number
  /** the texts the embedder refused: their entities have no vector */
  refused: { entity: Eid; error: Refused }[]
}

/**
 * One pass: make the queue's triggers match the fields (./owed.ts `watch`),
 * then settle the newest `limit` queued entities — embed what changed, delete
 * the vectors of what has no text, and leave the rest as they are. An
 * embedder that cannot be reached stops the pass: what it took stays queued
 * for the next one, and the error reaches the caller rather than being
 * swallowed into a quietly half-embedded corpus.
 */
export let sweep = async (
  db: Driver,
  fields: Field[],
  embedder: Embedder,
  limit = BATCH,
): Promise<Swept> => {
  let { model } = embedder
  watch(db, fields)
  let owed = due(db, limit)
  if (!owed.length && moved(db, model)) {
    owe(db, fields)
    owed = due(db, limit)
  }
  let by = new Map(
    sources(db, fields, owed.map((d) => d.owner)).map((s) => [s.owner, s]),
  )
  let todo = owed.flatMap((d) => {
    let s = by.get(d.owner)
    return s && s.had != hash(model, s.text) ? [{ d, s }] : []
  })
  let got = await embedAll(embedder, todo.map(({ s }) => s.text))
  let refused: Swept['refused'] = []
  todo.forEach(({ d, s }, i) => {
    let v = got[i]
    if (v instanceof Refused) {
      refused.push({ entity: s.entity, error: v })
      drop(db, d.owner)
    } else put(db, d.owner, model, s.text, v)
    paid(db, d)
  })
  // What was queued and has nothing to embed: no text, deleted, or no longer
  // wearing a field. What has text that did not change is settled as it is.
  let taken = new Set(todo.map((t) => t.d))
  for (let d of owed) {
    if (taken.has(d)) continue
    if (!by.has(d.owner)) drop(db, d.owner)
    paid(db, d)
  }
  return { fresh: todo.length - refused.length, left: left(db), refused }
}
