// Reads held across commits. Each answer is kept, and the entities a commit
// touched are read once, routed through a network of the held queries
// (@yaks/match `net`) and cut to each answer they are in the way a
// subscription cuts what a commit pushes (./projection.ts), so asking again
// reads nothing: a pass that reads the same queries after every commit costs
// what the commit touched, not what its queries select.
//
// A query naming its entities (`.entity.eid=a,b&…`) is held per entity under
// the rest of the query, so asking it for another list reads only the
// entities neither held nor just touched. A query a network cannot hold (one
// that orders, pages, counts, follows a reference or asks about a moment
// relative to now) is read from storage every time.
//
// What moved is matched as storage holds it, so only `native` reads and
// lookups (./storage.ts ReadOpts), which no ask or answer hook rewrites, are
// held; any other is read from storage every time.

import { matcher, net, rows as matchRows } from '@yaks/match'
import type { Vocab } from '@yaks/vocab'
import {
  type And,
  and,
  type Clause,
  eq,
  list,
  parse,
  type Pred,
  stringify,
} from '@yaks/query/core'
import type { Bundle, Eid } from './bundle.ts'
import type { Graph } from './graph.ts'
import type { Query, ReadOpts } from './storage.ts'
import { flat, named, only, projection } from './projection.ts'

type Reads = Pick<Graph, 'read' | 'get'>

/** Reads answered from what was read before, kept by what moved since. */
export type Held = Reads & {
  /** The eids committed since the last look. Answers holding them, or that
   * they now join, take them as they stand; when anything was asked since
   * the last look, the answers it did not ask for are let go. Says whether
   * any answer held changed, so a caller whose reads all held can tell its
   * answer is the one it had. */
  moved: (eids: Iterable<Eid>) => Promise<boolean>
}

// One held query: the entities it was read for (`all` of them, or the ones
// asked by id), each one's row or `null` where it does not match, the ones
// that moved and must be read again, and how a bundle is cut to its row
// (absent where a projection reaches other entities).
type Answer = {
  rest: And
  opts: ReadOpts
  all: boolean
  rows: Map<Eid, Bundle | null>
  stale: Set<Eid>
  cut?: (b: Bundle) => Bundle | null
  used: boolean
}
// A query as held: the rest of it, the ids it names, and its answer's key.
type Shape = { q: And; rest: And; ids?: Pred; key: string }

let naming = (c: Clause): c is Pred =>
  c.kind == 'pred' && c.op == '=' && c.path.join('.') == 'entity.eid' &&
  (c.value?.kind == 'list' || c.value?.kind == 'scalar')
let eidsOf = ({ value: v }: Pred): Eid[] =>
  v?.kind == 'list'
    ? v.items.map((i) => (i as { raw: string }).raw)
    : [(v as { raw: string }).raw]
let within = (q: And, eids: Eid[]): And =>
  and(...q.clauses, eq('entity.eid', list(...eids)))
let copies = (rows: Iterable<Bundle | null>): Bundle[] =>
  [...rows].flatMap((b) => b ? [{ ...b }] : [])
let same = (a: Bundle | null | undefined, b: Bundle | null) =>
  JSON.stringify(a ?? null) == JSON.stringify(b)
// A whole bundle as a lookup of these components answers it.
let picked = (b: Bundle, comps: string[] | null): Bundle => {
  if (!comps) return b
  let out: Bundle = { entity: b.entity }
  for (let c of [...comps, 'tombstone']) if (b[c]) out[c] = b[c]
  return out
}

/** Hold `tx`'s native reads and lookups. `moved` must hear every eid
 * committed since the last look, or an answer goes stale. */
export let held = (tx: Reads, vocab: Vocab): Held => {
  let answers = new Map<string, Answer>()
  let watching = net<string>(vocab, { timeless: true })
  // Lookups by id, under the components asked for (`null`: every one).
  let got = new Map<string, Map<Eid, Bundle | null>>()
  // The entities the last look found moved, as they stand.
  let seen = new Map<Eid, Bundle | null>()
  // Query text as held under each set of options, this look's and the
  // last's.
  type Texts = Map<string, Map<string, Shape>>
  let shapes: Texts = new Map(), shaped: Texts = new Map()
  // Whether anything was asked since the last look.
  let asked = false

  let shapeOf = (query: Query, opts: ReadOpts): Shape => {
    let how = JSON.stringify(opts)
    let texts = typeof query == 'string'
      ? shapes.get(how) ?? shapes.set(how, new Map()).get(how)!
      : undefined
    let s = texts &&
      (texts.get(query as string) ?? shaped.get(how)?.get(query as string))
    if (!s) {
      let q = typeof query == 'string' ? parse(query) : query
      let ids = q.clauses.filter(naming)
      let rest = ids.length == 1
        ? and(...q.clauses.filter((c) => c != ids[0]))
        : q
      s = {
        q,
        rest,
        ids: ids.length == 1 ? ids[0] : undefined,
        key: stringify(rest) + '\0' + how,
      }
    }
    texts?.set(query as string, s)
    return s
  }

  // One bundle's row in an answer, as storage would answer it.
  let cutter = (q: And, opts: ReadOpts): Answer['cut'] => {
    let p = projection(vocab, q)
    if (p) {
      if (p.reaches.length) return undefined
      let select = matchRows(p.query, vocab, opts)
      return (b) => flat(p.fold(select([b])))[0] ?? null
    }
    let select = matcher(q, vocab, opts)
    let shape = only(named(vocab, q, true))
    return (b) => {
      let [m] = select([b])
      return m ? shape(m) : null
    }
  }

  let refresh = async (a: Answer, eids: Eid[]) => {
    if (!eids.length) return
    let found = new Map(
      (await tx.read(within(a.rest, eids), a.opts))
        .map((b) => [b.entity.eid, b]),
    )
    for (let eid of eids) {
      a.stale.delete(eid)
      let b = found.get(eid) ?? null
      if (a.all && !b) a.rows.delete(eid)
      else a.rows.set(eid, b)
    }
  }

  let read = async (query: Query, opts?: ReadOpts): Promise<Bundle[]> => {
    if (!opts?.native) return tx.read(query, opts)
    asked = true
    let { q, rest, ids, key } = shapeOf(query, opts)
    let a = answers.get(key)
    if (!a) {
      if (!watching.add(key, rest)) return tx.read(q, opts)
      a = {
        rest,
        opts,
        all: !ids,
        rows: new Map(),
        stale: new Set(),
        cut: cutter(rest, opts),
        used: true,
      }
      answers.set(key, a)
      if (!ids) {
        for (let b of await tx.read(q, opts)) a.rows.set(b.entity.eid, b)
      }
    }
    a.used = true
    if (!ids) {
      await refresh(a, [...a.stale])
      return copies(a.rows.values())
    }
    let wanted = [...new Set(eidsOf(ids))]
    for (let eid of wanted) {
      if (a.rows.has(eid) || !seen.has(eid) || !a.cut) continue
      let b = seen.get(eid)
      a.rows.set(eid, b ? a.cut(b) : null)
    }
    await refresh(
      a,
      wanted.filter((eid) => !a.rows.has(eid) || a.stale.has(eid)),
    )
    return copies(wanted.map((eid) => a.rows.get(eid) ?? null))
  }

  let get = async (
    eids: Eid[],
    comps?: string[],
    opts?: ReadOpts,
  ): Promise<Bundle[]> => {
    if (!opts?.native) return tx.get(eids, comps, opts)
    let key = JSON.stringify([comps ?? null, opts])
    let rows = got.get(key) ?? got.set(key, new Map()).get(key)!
    let asked = [...new Set(eids)]
    for (let eid of asked) {
      if (rows.has(eid) || !seen.has(eid)) continue
      let b = seen.get(eid)
      rows.set(eid, b ? picked(b, comps ?? null) : null)
    }
    let missing = asked.filter((eid) => !rows.has(eid))
    if (missing.length) {
      let found = new Map(
        (await tx.get(missing, comps, opts)).map((b) => [b.entity.eid, b]),
      )
      for (let eid of missing) rows.set(eid, found.get(eid) ?? null)
    }
    return copies(asked.map((eid) => rows.get(eid) ?? null))
  }

  let moved = async (eids: Iterable<Eid>): Promise<boolean> => {
    if (asked) {
      for (let [key, a] of answers) {
        if (a.used) a.used = false
        else {
          answers.delete(key)
          watching.drop(key)
        }
      }
      shaped = shapes
      shapes = new Map()
      asked = false
    }
    seen = new Map()
    let touched = [...new Set(eids)]
    if (!touched.length || !answers.size && !got.size) return false
    let now = new Map(
      (await tx.get(touched, undefined, { native: true }))
        .map((b) => [b.entity.eid, b]),
    )
    let changed = false
    let put = (a: Answer, eid: Eid, row: Bundle | null) => {
      if (same(a.rows.get(eid), row)) return
      changed = true
      if (a.all && !row) a.rows.delete(eid)
      else a.rows.set(eid, row)
    }
    for (let eid of touched) {
      let b = now.get(eid) ?? null
      seen.set(eid, b)
      for (let [key, rows] of got) {
        if (!rows.has(eid)) continue
        let row = b && picked(b, JSON.parse(key)[0])
        if (!same(rows.get(eid), row)) changed = true
        rows.set(eid, row)
      }
      let into = new Set(b ? watching.route(b) : [])
      for (let [key, a] of answers) {
        if (!into.has(key)) {
          if (!a.rows.get(eid)) continue
          a.stale.delete(eid)
          put(a, eid, null)
        } else if (a.all || a.rows.has(eid)) {
          // A row it holds, or one joining an answer of every match, is cut
          // from the entity as it stands; an id no one asked this query for
          // waits until asked.
          let row = a.cut?.(b!)
          if (row !== undefined) put(a, eid, row)
          else {
            changed = true
            a.stale.add(eid)
          }
        }
      }
    }
    return changed
  }

  return { read, get, moved }
}
