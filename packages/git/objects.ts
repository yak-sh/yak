// What a clone has to carry: every object reachable from the commits a client
// asked for, each one once, and the bytes of each — the other half of a
// packfile, which ./pack.ts writes without looking anything up.
//
// Two walks and A read. Commits are followed along `parent` edges, trees along
// `tree_entry` edges, and a commit's own tree is read from the first line of
// its body (`treeOf`, ./commit.ts), because that is where a commit records it.
// Blobs are whatever the tree entries reach that is not itself a tree. Each
// object is listed once: the same tree under two commits, or one blob under
// two names, is one entry in the packfile.
//
// A `have` is subtraction, not negotiation. Everything the client reports it
// holds is walked first into the same seen set, so those objects are simply
// absent from the answer. One round, no deltas, no shallow clones: a first
// clone is the full reachable set, and a fetch after it is the difference
// (D-34943). A `have` naming an object this graph never held is ignored — the
// client may hold objects we do not.
//
// The frontier is read in batches because a query's any-of list becomes bound
// parameters and a database limits how many there may be; the walk is
// otherwise one query per level, not one per object.

import type { Blobs } from '@yaks/blob'
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { treeOf } from './commit.ts'
import { BLOB, GITOBJ, PARENT, TREE_ENTRY } from './comp.ts'
import type { Kind } from './oid.ts'
import { type Obj, pack } from './pack.ts'

/**
 * What reading objects needs from a graph: a read, and nothing else — the read
 * half of {@link Writes}, for the same reason (./index.ts). A packfile is
 * served wherever the request arrived, which may be nowhere near the graph.
 */
export type Reads = Pick<Graph, 'read'>

/** Reading a graph's Git objects out, in the order a packfile lists them. */
export type Objects = {
  /** every object these commits need, each once: commits, then trees, then
   * blobs — minus whatever the client already has */
  reach: (wants: string[], haves?: string[]) => Promise<string[]>
  /** those objects' bytes, one at a time, in the order given */
  read: (oids: string[]) => AsyncIterable<Obj>
  /** both at once: the packfile that a clone of these commits consists of */
  pack: (
    wants: string[],
    haves?: string[],
  ) => Promise<ReadableStream<Uint8Array>>
}

// How many ids go into one query's any-of list.
let BITE = 100

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

/** An object reader over a graph that carries this package's components and
 * the @yaks/blob store that holds the bytes — the same pair the index writes
 * to. */
export let objects = (g: Reads, store: Blobs): Objects => {
  // One query per batch of the frontier, with the results appended.
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

  // The type of each of these objects — and, by absence, which we never had.
  let kinds = async (oids: string[]): Promise<Map<string, Kind>> =>
    new Map(
      (await some((l) => `.${GITOBJ}&.entity.eid=${l}`, oids))
        .map((r) => [r.entity.eid, comp(r, GITOBJ).type as Kind]),
    )

  // The far end of every edge of one relation leaving these objects.
  let out = async (relation: string, from: string[]): Promise<string[]> =>
    (await some(
      (l) => `.${relation}&.edge.from=${l}&.order=ord`,
      from,
    )).map((r) => String(comp(r, 'edge').to))

  let read = async function* (oids: string[]): AsyncIterable<Obj> {
    for (let i = 0; i < oids.length; i += BITE) {
      let bite = oids.slice(i, i + BITE)
      // `?blob` is not decoration: a query returns the components it names,
      // and a graph reached over @yaks/api's read endpoint returns exactly
      // those — so a read that asked only for `.gitobj` came back with rows
      // that did not include where the bytes were, and every object was
      // reported missing.
      let rows = new Map(
        (await some((l) => `.${GITOBJ}&?${BLOB}&.entity.eid=${l}`, bite))
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
  // holding that plus every object this answer lists.
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

    // A commit's tree is in its body; a `want` that is a tree is its own root.
    let tops = roots.filter((o) => kind.get(o) == 'tree')
    for await (let o of read(found)) {
      let tree = treeOf(o.bytes)
      if (tree) tops.push(tree)
    }

    let blobs = fresh(roots.filter((o) => kind.get(o) == 'blob'))
    front = fresh(tops)
    while (front.length) {
      found.push(...front)
      let next = fresh(await out(TREE_ENTRY, front))
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
