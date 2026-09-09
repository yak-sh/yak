// What a clone has to carry: every object reachable from the commits a client
// asked for, each once, and the bytes of each one — the other half of a pack,
// which ./pack.ts writes but never looks anything up for.
//
// TWO WALKS AND A READ. Commits go along `parent` edges, trees along `entry`
// edges, and a commit's own tree is the first line of its body (`treeOf`,
// ./commit.ts), because that is where a commit writes it down. Blobs are
// whatever the entries reach that is not a tree. Each object is named once:
// the same tree under two commits, or one blob under two names, is one entry
// in the pack.
//
// `have` IS SUBTRACTION, NOT NEGOTIATION. Everything the client says it holds
// is walked first into the same seen set, so it is simply missing from the
// answer. One round, no deltas, no shallow: a first clone is the full
// reachable set, and a fetch after it is the difference (D-34943). A `have`
// naming an object this graph never had is ignored — the client may know
// objects we do not.
//
// The frontier is read in bites because a query's any-of list becomes bound
// parameters, and a database counts those; the walk is otherwise one query per
// level, not one per object.

import type { Blobs } from '@yaks/blob'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { treeOf } from './commit.ts'
import { BLOB, ENTRY, GITOBJ, PARENT } from './comp.ts'
import type { Kind } from './oid.ts'
import { type Obj, pack } from './pack.ts'

/**
 * What reading objects asks of a graph: a query, and nothing else — the read
 * half of {@link Writes}, for the same reason (./index.ts). Serving a pack
 * happens wherever the request landed, which may be nowhere near the graph.
 */
export type Reads = Pick<Graph, 'read'>

/** Reading a graph's git objects out, in the order a pack states them. */
export type Objects = {
  /** every object these commits need, each once: commits, then trees, then
   * blobs — less whatever the client already has */
  reach: (wants: string[], haves?: string[]) => Promise<string[]>
  /** those objects' bytes, one at a time, in the order given */
  read: (oids: string[]) => AsyncIterable<Obj>
  /** both at once: the pack a clone of these commits is */
  pack: (
    wants: string[],
    haves?: string[],
  ) => Promise<ReadableStream<Uint8Array>>
}

// How many ids ride in one query's any-of list.
let BITE = 100

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

/** An object reader over a graph carrying this package's vocabulary and the
 * @yaks/blob store holding the bytes — the same pair the index writes to. */
export let objects = (g: Reads, store: Blobs): Objects => {
  // One query per bite of the frontier, the answers appended.
  let some = async (
    query: (list: string) => string,
    oids: string[],
  ): Promise<Bundle[]> => {
    let out: Bundle[] = []
    for (let i = 0; i < oids.length; i += BITE) {
      out.push(...await g.read(query(oids.slice(i, i + BITE).join(','))))
    }
    return out
  }

  // What each of these objects is — and, by its absence, which we never had.
  let kinds = async (oids: string[]): Promise<Map<string, Kind>> =>
    new Map(
      (await some((l) => `.${GITOBJ}!&.entity.eid=${l}`, oids))
        .map((r) => [r.entity.eid, comp(r, GITOBJ).type as Kind]),
    )

  // The far end of every edge of one relation leaving these objects.
  let out = async (relation: string, from: string[]): Promise<string[]> =>
    (await some(
      (l) => `.${relation}!&.edge.from=${l}&.order=ord`,
      from,
    )).map((r) => String(comp(r, 'edge').to))

  let read = async function* (oids: string[]): AsyncIterable<Obj> {
    for (let i = 0; i < oids.length; i += BITE) {
      let bite = oids.slice(i, i + BITE)
      // `.blob?` is not decoration: a query answers the comps it NAMES, and a
      // graph behind a door (@yaks/api's read door) answers exactly those —
      // so a read that only said `.gitobj!` got rows with nowhere to read the
      // bytes from, and every object was missing.
      let rows = new Map(
        (await some((l) => `.${GITOBJ}!&.${BLOB}?&.entity.eid=${l}`, bite))
          .map((r) => [r.entity.eid, r]),
      )
      for (let oid of bite) {
        let row = rows.get(oid)
        if (!row) throw new Error(`git: no object ${oid}`)
        let sha = String(comp(row, BLOB).sha)
        let bytes = await store.get(sha)
        if (!bytes) throw new Error(`git: no bytes stored under ${sha}`)
        yield { type: comp(row, GITOBJ).type as Kind, bytes }
      }
    }
  }

  // The walk itself. `seen` comes in holding what the client has and goes out
  // holding that plus everything this answer names.
  let walk = async (roots: string[], seen: Set<string>): Promise<string[]> => {
    let fresh = (oids: string[]) =>
      oids.filter((o) => !seen.has(o) && (seen.add(o), true))
    let kind = await kinds(roots)
    let missing = roots.find((o) => !kind.has(o))
    if (missing) throw new Error(`git: no object ${missing}`)

    let found = fresh(roots.filter((o) => kind.get(o) == 'commit'))
    let front = found
    while (front.length) {
      front = fresh(await out(PARENT, front))
      found.push(...front)
    }

    // A commit's tree is in its body; a want that IS a tree is its own root.
    let tops = roots.filter((o) => kind.get(o) == 'tree')
    for await (let o of read(found)) {
      let tree = treeOf(o.bytes)
      if (tree) tops.push(tree)
    }

    let blobs = fresh(roots.filter((o) => kind.get(o) == 'blob'))
    front = fresh(tops)
    while (front.length) {
      found.push(...front)
      let next = fresh(await out(ENTRY, front))
      let under = await kinds(next)
      front = next.filter((o) => under.get(o) == 'tree')
      blobs.push(...next.filter((o) => under.get(o) != 'tree'))
    }
    return [...found, ...blobs]
  }

  let reach = async (wants: string[], haves: string[] = []) => {
    let seen = new Set<string>()
    // Only the haves we recognise: a client may hold objects we never had.
    if (haves.length) await walk([...(await kinds(haves)).keys()], seen)
    return walk(wants, seen)
  }

  return {
    reach,
    read,
    pack: async (wants, haves) => {
      let oids = await reach(wants, haves)
      return pack(oids.length, read(oids))
    },
  }
}
