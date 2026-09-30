// The vectors held in this process's memory, so a search compares without
// reading them: one copy per driver, loaded the first time a search asks for
// it, for a database only this process has open (a Durable Object's, or one in
// memory; @yaks/sql `Driver.file` says which). A file other processes write is
// ranked by the quantized index (./native.ts) or read row by row instead.
//
// The table stays the truth, and the copy is the table as of one build. It is
// kept current the way the quantized index is: the triggers on the table note
// every vector written or deleted, by anyone, in the same statement as the
// write (./ddl.ts, the dirty set), and a search scores what the set names from
// its rows beside the copy. After each sweep pass, the process that ran it
// folds the set into its copy and clears it ({@link absorb}), numbering a new
// build; a copy that sees a build it did not make loads again. So no write can
// leave a copy behind: a write another driver made, a migration, a rollback
// are all in the set or in the build number.
//
// Memory is the limit. A vector costs its width in float32 (1 KB at 256
// dimensions) and ~44 bytes beside it, and every object in a Worker's isolate
// shares its 128 MB, so all copies together stay within {@link HELD}: the
// least recently searched is dropped to make room, and a store whose vectors
// alone would pass it is not held at all and is read row by row. Today's
// largest store (24k vectors) holds 26 MB; ten times that would not fit.
//
// The scores are the scan's to the last bit: cosine over the same float32
// values in the same order, so a held search and a read one answer alike.

import {
  among,
  and,
  as,
  at,
  col,
  type Driver,
  each,
  eq,
  exists,
  fn,
  from,
  gt,
  lit,
  not,
  op,
  type Raw,
  select,
  table,
  tally,
  val,
} from '@yaks/sql'
import { BUILD, DIRTY, TABLE } from './ddl.ts'
import { admitted, current, installed } from './native.ts'
import type { Near } from './near.ts'
import { cosine, unpack } from './vector.ts'

/** How many bytes of vectors this process holds across every copy: 48 MB of
 * a Worker isolate's 128 MB, which every object in it shares. */
export let HELD = 48 * 2 ** 20

// Rows read to a statement while a copy loads.
let PAGE = 2048

// The bytes one vector costs held: its floats, its owner, its norm, and its
// entry in the owner index.
let cost = (dim: number) => 4 * dim + 4 + 8 + 32

/** One database's vectors under one model, as of one build. */
export type Held = {
  model: string
  dim: number
  /** the build this copy is current at; -1 once dropped */
  n: number
  size: number
  ids: Int32Array
  norms: Float64Array
  vecs: Float32Array
  slot: Map<number, number>
}

// Each driver's copy, gone with the driver. The copies are also listed, least
// recently searched first, to share one budget; the list holds them weakly, so
// an object the runtime let go of takes its copy with it.
let copies = new WeakMap<Driver, Held>()
let lru = new Set<WeakRef<Held>>()
let refs = new WeakMap<Held, WeakRef<Held>>()
// The drivers whose vectors would not fit.
let over = new WeakSet<Driver>()

let bytes = (h: Held) => h.ids.length * cost(h.dim)

let touch = (h: Held) => {
  let r = refs.get(h) ?? new WeakRef(h)
  refs.set(h, r)
  lru.delete(r)
  lru.add(r)
}

let listed = (): Held[] =>
  [...lru].flatMap((r) => {
    let h = r.deref()
    if (!h) lru.delete(r)
    return h ? [h] : []
  })

let drop = (h: Held) => {
  let r = refs.get(h)
  if (r) lru.delete(r)
  Object.assign(h, {
    n: -1,
    size: 0,
    ids: new Int32Array(0),
    norms: new Float64Array(0),
    vecs: new Float32Array(0),
    slot: new Map(),
  })
}

// Room for `need` more bytes, dropping the least recently searched copies
// other than `mine`; false when `need` could not fit even then.
let room = (need: number, mine: Held) => {
  let held = listed()
  let used = 0
  for (let h of held) used += bytes(h)
  for (let h of held) {
    if (used + need <= HELD) break
    if (h == mine) continue
    used -= bytes(h)
    drop(h)
  }
  return used + need <= HELD
}

// Room for `cap` vectors, keeping the ones held.
let grow = (h: Held, cap: number): boolean => {
  if (!room((cap - h.ids.length) * cost(h.dim), h)) return false
  let ids = new Int32Array(cap), norms = new Float64Array(cap)
  let vecs = new Float32Array(cap * h.dim)
  ids.set(h.ids.subarray(0, h.size))
  norms.set(h.norms.subarray(0, h.size))
  vecs.set(h.vecs.subarray(0, h.size * h.dim))
  Object.assign(h, { ids, norms, vecs })
  return true
}

// Forget `owner`'s vector: the last slot moves into its place.
let lose = (h: Held, owner: number) => {
  let i = h.slot.get(owner)
  if (i == null) return
  let last = --h.size
  h.slot.delete(owner)
  if (i == last) return
  let moved = h.ids[last]
  h.ids[i] = moved
  h.norms[i] = h.norms[last]
  h.vecs.copyWithin(i * h.dim, last * h.dim, (last + 1) * h.dim)
  h.slot.set(moved, i)
}

// Hold `owner`'s vector, in the slot it had or a new one; false when there is
// no room for it.
let keep = (h: Held, owner: number, bytes: Uint8Array): boolean => {
  if (!h.dim) h.dim = bytes.byteLength / 4
  // A vector of another width is from another space; the model name says
  // which, so this is a row nothing should have written, and it is not held.
  if (bytes.byteLength != h.dim * 4) {
    lose(h, owner)
    return true
  }
  let i = h.slot.get(owner)
  if (i == null) {
    if (h.size == h.ids.length && !grow(h, h.size + (h.size >> 3) + 64)) {
      return false
    }
    i = h.size++
    h.slot.set(owner, i)
    h.ids[i] = owner
  }
  let v = unpack(bytes)
  let at = i * h.dim, lb = 0
  for (let j = 0; j < h.dim; j++) {
    h.vecs[at + j] = v[j]
    lb += v[j] * v[j]
  }
  h.norms[i] = Math.sqrt(lb)
  return true
}

// What the dirty set names, as each entity's vector stands now: its bytes
// under `model`, or null where it has none (deleted, or another model's).
let d = at('d'), e = at('e')
let dirty = (db: Driver, model: string): Map<number, Uint8Array | null> =>
  new Map(
    db.query(select({
      cols: [
        d('owner'),
        as(e('model'), 'model'),
        as(e('vec'), 'vec'),
      ],
      from: table(DIRTY, 'd'),
      joins: [{
        how: 'left',
        src: table(TABLE, 'e'),
        on: eq(e('owner'), d('owner')),
      }],
    })).map((r) => [
      Number(r.owner),
      r.model == model ? r.vec as Uint8Array : null,
    ]),
  )

// Where this process is the only one with the database open and no quantized
// index reads the dirty set, the set is the copies' alone: cleared, with a new
// build numbered so every other copy of it loads again.
let owned = (db: Driver) => !db.file && !installed(db)
let clear = (db: Driver): number => {
  db.query({ t: 'update', table: BUILD, set: { n: op('+', col('n'), lit(1)) } })
  db.query({ t: 'delete', from: DIRTY })
  return current(db).n
}

// Every vector under `model`, a page at a time, into a copy made to their
// count; null where they will not fit.
let load = (db: Driver, model: string): Held | null => {
  let was = copies.get(db)
  if (was) drop(was)
  let h: Held = {
    model,
    dim: 0,
    n: current(db).n,
    size: 0,
    ids: new Int32Array(0),
    norms: new Float64Array(0),
    vecs: new Float32Array(0),
    slot: new Map(),
  }
  touch(h)
  copies.set(db, h)
  let [first] = db.query(select({
    cols: [as(fn('length', col('vec')), 'bytes')],
    from: table(TABLE),
    where: eq(col('model'), val(model)),
    limit: lit(1),
  }))
  h.dim = Number(first?.bytes ?? 0) / 4
  if (!grow(h, tally(db, TABLE, eq(col('model'), val(model))))) {
    drop(h)
    copies.delete(db)
    over.add(db)
    return null
  }
  for (let after = 0;;) {
    let rows = db.query(select({
      cols: [col('owner'), col('vec')],
      from: table(TABLE),
      where: and(gt(col('owner'), val(after)), eq(col('model'), val(model))),
      order: [col('owner')],
      limit: lit(PAGE),
    }))
    for (let r of rows) {
      if (!keep(h, Number(r.owner), r.vec as Uint8Array)) {
        drop(h)
        copies.delete(db)
        over.add(db)
        return null
      }
    }
    if (rows.length < PAGE) break
    after = Number(rows[rows.length - 1].owner)
  }
  // The copy is the table now, so what the set named is in it.
  if (owned(db) && dirty(db, model).size) h.n = clear(db)
  return h
}

/**
 * This process's copy of `db`'s vectors under `model`, loaded if it has none
 * or its copy is from an older build; null where the vectors are not held:
 * a file other processes may write, or more than {@link HELD} of them.
 */
export let hold = (db: Driver, model: string): Held | null => {
  if (db.file || over.has(db)) return null
  let had = copies.get(db)
  let h = had && had.model == model && had.n == current(db).n
    ? had
    : load(db, model)
  if (!h) return null
  touch(h)
  return h
}

/**
 * Fold what the dirty set names into this process's copy and clear the set:
 * what a sweep pass wrote, from the process that wrote it (./sweep.ts
 * `drain`). Nothing where the set is not the copies' alone.
 */
export let absorb = (db: Driver): void => {
  if (!owned(db)) return
  let h = copies.get(db)
  let now = current(db).n
  let set = dirty(db, h?.model ?? '')
  if (!set.size) return
  if (h && h.n == now) {
    for (let [owner, vec] of set) {
      if (!vec) lose(h, owner)
      else if (!keep(h, owner, vec)) {
        drop(h)
        copies.delete(db)
        over.add(db)
        break
      }
    }
  }
  let n = clear(db)
  if (h && h.n == now) h.n = n
}

// The `m` best of the scored, best first: the highest similarity, and for
// equal ones the lower owner id, as the scan breaks a tie.
let top = (owners: Int32Array, sims: Float64Array, m: number): number[] => {
  let worse = (a: number, b: number) =>
    sims[a] < sims[b] || (sims[a] == sims[b] && owners[a] > owners[b])
  let heap: number[] = []
  let sift = (i: number) => {
    for (;;) {
      let c = 2 * i + 1
      if (c >= heap.length) return
      if (c + 1 < heap.length && worse(heap[c + 1], heap[c])) c++
      if (!worse(heap[c], heap[i])) return
      ;[heap[c], heap[i]] = [heap[i], heap[c]]
      i = c
    }
  }
  for (let k = 0; k < owners.length; k++) {
    if (heap.length < m) {
      heap.push(k)
      for (let i = heap.length - 1; i;) {
        let p = (i - 1) >> 1
        if (!worse(heap[i], heap[p])) break
        ;[heap[i], heap[p]] = [heap[p], heap[i]]
        i = p
      }
    } else if (worse(heap[0], k)) {
      heap[0] = k
      sift(0)
    }
  }
  return heap.sort((a, b) => worse(a, b) ? 1 : worse(b, a) ? -1 : 0)
}

// Which of `owners` stand as neighbours, and their eids: an entity that is
// not buried, and one the screen admits, each tested by its own key.
let o = at('o')
let standing = (db: Driver, owners: number[], within?: Raw) =>
  new Map(
    db.query(select({
      cols: [as(o('id'), 'owner'), as(o('eid'), 'eid')],
      from: table('entity', 'o'),
      where: and(
        among(o('id'), each(owners)),
        not(exists(select({
          cols: [lit(1)],
          from: table('tombstone', 't'),
          where: eq(col('entity', 't'), o('id')),
        }))),
        ...(within ? [admitted(within, o('id'))] : []),
      ),
    })).map((r) => [Number(r.owner), String(r.eid)]),
  )

// Every held vector's similarity to `query`, as cosine scores it: the same
// terms added in the same order, four to a turn of the loop. A query of
// another width is unrelated to every vector.
let similarities = (h: Held, query: Float32Array): Float64Array => {
  let out = new Float64Array(h.size)
  if (query.length != h.dim) return out
  let { norms, vecs, dim } = h
  let la = 0
  for (let j = 0; j < dim; j++) la += query[j] * query[j]
  let qn = Math.sqrt(la)
  let four = dim - dim % 4
  for (let i = 0; i < h.size; i++) {
    let dot = 0, at = i * dim, j = 0
    for (; j < four; j += 4) {
      dot += query[j] * vecs[at + j]
      dot += query[j + 1] * vecs[at + j + 1]
      dot += query[j + 2] * vecs[at + j + 2]
      dot += query[j + 3] * vecs[at + j + 3]
    }
    for (; j < dim; j++) dot += query[j] * vecs[at + j]
    let len = qn * norms[i]
    out[i] = len ? dot / len : 0
  }
  return out
}

/**
 * The `limit` nearest to `query` in a copy, most similar first: every held
 * vector scored in memory, what the dirty set names scored from its rows, and
 * the best tested against the graph a few at a time, reaching further while
 * too few stand.
 */
export let ranked = (
  db: Driver,
  h: Held,
  query: Float32Array,
  opts: { limit: number; floor: number; without?: number; within?: Raw },
): Near[] => {
  let fresh = dirty(db, h.model)
  let all = similarities(h, query)
  let owners = new Int32Array(h.size + fresh.size)
  let sims = new Float64Array(h.size + fresh.size)
  let count = 0
  let score = (owner: number, sim: number) => {
    if (owner == opts.without || !(sim >= opts.floor)) return
    owners[count] = owner
    sims[count++] = sim
  }
  for (let i = 0; i < h.size; i++) {
    if (!fresh.has(h.ids[i])) score(h.ids[i], all[i])
  }
  for (let [owner, vec] of fresh) {
    if (vec) score(owner, cosine(query, unpack(vec)))
  }
  owners = owners.subarray(0, count)
  sims = sims.subarray(0, count)
  let out: Near[] = []
  let within = opts.within
  for (let seen = 0, reach = opts.limit; out.length < opts.limit;) {
    let best = top(owners, sims, Math.min(reach, owners.length))
    if (best.length == seen) break
    let batch = best.slice(seen)
    let eids = standing(db, batch.map((k) => owners[k]), within)
    for (let k of batch) {
      let entity = eids.get(owners[k])
      if (entity == null || out.length == opts.limit) continue
      out.push({ entity, owner: owners[k], similarity: sims[k] })
    }
    seen = best.length
    reach *= 4
    // A screen that admits few costs a walk through most of the ranking. Once
    // the rate so far says the walk would test more than half of it, the
    // screen is read whole, and the rest of the ranking is what it admits,
    // all of it below everything already tested.
    let rate = Math.max(out.length, 1) / seen
    if (
      within && out.length < opts.limit && opts.limit / rate > owners.length / 2
    ) {
      let admits = new Set(
        db.query(select({ cols: [col('id', 's')], from: from(within, 's') }))
          .map((r) => Number(r.id)),
      )
      let tested = new Set(best)
      let rest = [...owners.keys()].filter((k) =>
        !tested.has(k) && admits.has(owners[k])
      )
      ;[owners, sims] = [
        Int32Array.from(rest, (k) => owners[k]),
        Float64Array.from(rest, (k) => sims[k]),
      ]
      within = undefined
      seen = 0
      reach = opts.limit - out.length
    }
  }
  return out
}
