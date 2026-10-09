// The object index: Git objects written into a graph, once each.
//
// An object's entity id is its SHA-1 object id, so the same object written by
// two deploys, two apps or two runs is one row — there is no lookup, no
// uniqueness constraint and nothing to reconcile. Beside each row goes an
// @yaks/key holding the same object's SHA-256 object id, so a client that asks
// for `object-format=sha256` is answered by a single read.
//
// What is A row and what is bytes. The body is the truth about a tree or a
// commit — byte for byte, because Git's ids are digests of it — so the body
// goes to the @yaks/blob store and the row keeps only what a query has to
// follow: the type and size a packfile entry header needs, the `blob{sha}`
// the bytes are stored under, `tree_entry` edges (tree → child, with the name
// on the link) and `parent` edges (commit → commit). Author, message, entry
// order and mode are all in the body already; a property for them would be a
// second copy free to drift.
//
// A git blob is the blob you already have. The bytes an app deployed are
// already in the store under their SHA-256 address; a Git blob object is those
// same bytes with a header hashed over them, so nothing is re-encoded and the
// row simply points at what is there. Naming a manifest's file twice, or
// across versions, costs an indexed read and no read of the bytes.
//
// A release is folded against the commit before it (`Base`): a directory
// whose files all stand as they did is that commit's tree again, read and
// written nowhere, and a changed one reads only its own entries. So a
// release reads and writes what it changed, not the whole manifest.
//
// This module writes objects and nothing else: it never reads a packfile,
// serves HTTP, or touches a branch. Landing a manifest on a branch is
// ./refs.ts, and the row joining a commit to whatever it was built from is the
// application's own, written there alongside the moved ref.

import type { Blobs } from '@yaks/blob'
import { EDGE, link } from '@yaks/edge'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph'
import { keyed, valueOf } from '@yaks/key'
import { type Commit, commitBody } from './commit.ts'
import { BLOB, COMPAT, GITOBJ, PARENT, TREE_ENTRY } from './comp.ts'
import { hex, type Kind, oid, oid256, type Oids } from './oid.ts'
import { DIR, type Dir, FILE, type Files, nest, treeBody } from './tree.ts'

/** One child of a tree, named both ways. */
export type Child = { name: string; mode: string } & Oids

/** A commit to write: the same as a {@link Commit}, but with every id given
 * under both hash algorithms, since the two bodies are built from the two. */
export type Mint = Omit<Commit, 'tree' | 'parents'> & {
  tree: Oids
  parents?: Oids[]
}

/**
 * What writing objects needs from a graph: a read and an apply, nothing else.
 *
 * Narrower than `Graph` on purpose. The object index is the same code whether
 * the graph is in this process or behind an HTTP API — a Durable Object's
 * `/query` and `/apply` endpoints satisfy both of these — and a parameter that
 * demanded a whole `Graph` would have forced a remote caller to invent a
 * storage layer and a vocabulary it has no use for.
 */
export type Writes = Pick<Graph, 'read' | 'apply'>

/** Writing objects into one graph and one byte store. */
export type Index = {
  /** the git blob object over bytes the store already holds */
  blob: (sha: string) => Promise<Oids>
  /** a tree over children already written */
  tree: (children: Child[]) => Promise<Oids>
  /** a commit over a tree and parents already written */
  commit: (mint: Mint) => Promise<Oids>
  /** a whole deploy manifest, bottom up: every blob, every directory, and the
   * root tree it returns. Given the commit before it (`base`), only what
   * moved since is read or written. */
  files: (manifest: Files, base?: Base) => Promise<Oids>
}

/** The commit a manifest follows: its tree, and the manifest that tree was
 * made from. */
export type Base = { tree: Oids; files: Files }

/**
 * Each object's SHA-256 id by its SHA-1 id, for those of `oids` the graph
 * holds: the compat keys off them, a hundred at a time. Asked by the key's
 * own index on `key.of`, so it reads one row per object named.
 */
export let names = async (
  g: Pick<Writes, 'read'>,
  oids: string[],
): Promise<Map<string, string>> => {
  let out = new Map<string, string>()
  let unique = [...new Set(oids)]
  for (let i = 0; i < unique.length; i += 100) {
    let part = unique.slice(i, i + 100).join(',')
    for (let b of await g.read(`.key.of=${part}&?${COMPAT}`)) {
      let name = b[COMPAT] && valueOf(b)
      if (name) out.set(String((b.key as { of: string }).of), name)
    }
  }
  return out
}

// Whether two directories hold the same files under the same names, all the
// way down: such a directory is the tree it was.
let same = (a: Dir, b: Dir): boolean =>
  a.files.size == b.files.size && a.dirs.size == b.dirs.size &&
  [...a.files].every(([name, sha]) => b.files.get(name) == sha) &&
  [...a.dirs].every(([name, d]) => {
    let was = b.dirs.get(name)
    return !!was && same(d, was)
  })

/**
 * The entity id of a tree's link to one child, derived from the string
 * `tree_entry|<tree>|<name>`.
 *
 * Not @yaks/edge's own derivation, for a reason a duplicate file makes
 * obvious: two names in one tree may point at one blob (two empty files, say),
 * and `from|relation|to` is the same string for both, so one link would
 * overwrite the other. Within a tree it is the name that is unique, so the
 * name is what the id is derived from.
 */
export let entryEid = (tree: Eid, name: string): Eid =>
  derivedEid(`${TREE_ENTRY}|${tree}|${name}`)

let sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))

/**
 * An object index over a graph that carries this package's components and a
 * @yaks/blob store that holds the bytes.
 *
 * ```ts
 * // let git = index(g, store)
 * // let tree = await git.files({ 'index.html': sha })
 * // let head = await git.commit({ tree, author, committer, message: 'deploy 1' })
 * ```
 */
export let index = (g: Writes, store: Blobs): Index => {
  // Stores a body we built, under its own address. A blob object's bytes are
  // already in the store under that same address, which is why this is only
  // ever called for trees and commits.
  let put = async (body: Uint8Array<ArrayBuffer>): Promise<string> => {
    let sha = await sha256(body)
    if (!await store.has(sha)) await store.put(sha, body)
    return sha
  }

  // The row every object gets, plus its SHA-256 object id and whatever edges
  // it contributes. Writing it again updates what is already there.
  let rows = (
    oids: Oids,
    type: Kind,
    size: number,
    sha: string,
    walk: Bundle[] = [],
  ): Bundle[] => [
    { entity: { eid: oids.oid }, [GITOBJ]: { type, size }, [BLOB]: { sha } },
    keyed(COMPAT, oids.oid, oids.oid256),
    ...walk,
  ]

  let write = async (
    oids: Oids,
    type: Kind,
    size: number,
    sha: string,
    walk: Bundle[] = [],
  ): Promise<Oids> => {
    await g.apply(rows(oids, type, size, sha, walk))
    return oids
  }

  // A manifest's files are independent. Read their existing names in bounded
  // batches and write new names together, so a large deploy does not make two
  // serial graph round trips for every file it already committed before.
  let blobs = async (shas: string[]): Promise<Map<string, Oids>> => {
    let out = new Map<string, Oids>()
    let unique = [...new Set(shas)]
    for (let i = 0; i < unique.length; i += 100) {
      let part = unique.slice(i, i + 100)
      let found = await g.read(`.gitobj.type=blob&.blob.sha=${part.join(',')}`)
      let byId = await names(g, found.map((b) => b.entity.eid))
      for (let b of found) {
        let sha = String((b[BLOB] as { sha: string }).sha)
        let oid256 = byId.get(b.entity.eid)
        if (oid256) out.set(sha, { oid: b.entity.eid, oid256 })
      }
      let fresh = await Promise.all(
        part.filter((sha) => !out.has(sha))
          .map(async (sha) => {
            let bytes = await store.get(sha)
            if (!bytes) throw new Error(`git: no bytes stored under ${sha}`)
            let oids = {
              oid: await oid('blob', bytes),
              oid256: await oid256('blob', bytes),
            }
            return { sha, bytes, oids }
          }),
      )
      if (fresh.length) {
        await g.apply(
          fresh.flatMap(({ sha, bytes, oids }) =>
            rows(oids, 'blob', bytes.length, sha)
          ),
        )
        for (let { sha, oids } of fresh) out.set(sha, oids)
      }
    }
    return out
  }

  // The Git blob object over these bytes. A manifest that repeats a file, or
  // a second version of the same app, reads a row instead of the bytes.
  let blob = async (sha: string): Promise<Oids> =>
    (await blobs([sha])).get(sha)!

  let tree = async (children: Child[]): Promise<Oids> => {
    let body = treeBody(children)
    let body256 = treeBody(children.map((c) => ({ ...c, oid: c.oid256 })))
    let oids = {
      oid: await oid('tree', body),
      oid256: await oid256('tree', body256),
    }
    return write(
      oids,
      'tree',
      body.length,
      await put(body),
      children.map((
        c,
        i,
      ) => ({
        entity: { eid: entryEid(oids.oid, c.name) },
        [EDGE]: { from: oids.oid, to: c.oid, ord: i },
        [TREE_ENTRY]: { name: c.name, mode: c.mode },
      })),
    )
  }

  let commit = async (mint: Mint): Promise<Oids> => {
    let parents = mint.parents ?? []
    let body = commitBody({
      ...mint,
      tree: mint.tree.oid,
      parents: parents.map((p) => p.oid),
    })
    let body256 = commitBody({
      ...mint,
      tree: mint.tree.oid256,
      parents: parents.map((p) => p.oid256),
    })
    let oids = {
      oid: await oid('commit', body),
      oid256: await oid256('commit', body256),
    }
    return write(
      oids,
      'commit',
      body.length,
      await put(body),
      parents.map((p, i) => link(oids.oid, PARENT, p.oid, i)),
    )
  }

  // The children a tree holds, by name: its edges, through their index on
  // `edge.from`. A tree's only edges are its entries.
  let entries = async (tree: string): Promise<Map<string, string>> =>
    new Map(
      (await g.read(`.edge.from=${tree}&?${TREE_ENTRY}`)).flatMap((b) => {
        let entry = b[TREE_ENTRY] as { name: string } | undefined
        return entry ? [[entry.name, String((b[EDGE] as Comp).to)]] : []
      }),
    )

  // Bottom up: a directory has no id until every child under it has one.
  // Folded against what it was (`was`), a directory that stands is its old
  // tree, and a changed one takes each child that stands from its old
  // entries. The files that moved are named by their bytes (`fresh`).
  let fold = async (
    at: Dir,
    fresh: Map<string, Oids>,
    was?: { dir: Dir; oids: Oids },
  ): Promise<Oids> => {
    if (was && same(at, was.dir)) return was.oids
    let held = was ? await entries(was.oids.oid) : new Map<string, string>()
    let stood = (name: string, sha?: string) =>
      held.has(name) &&
      (sha == null ? was?.dir.dirs.has(name) : was?.dir.files.get(name) == sha)
    let known = await names(
      g,
      [
        ...[...at.files].filter(([n, sha]) => stood(n, sha)),
        ...[...at.dirs].filter(([n]) => stood(n)),
      ].map(([n]) => held.get(n)!),
    )
    let kept = (name: string): Oids | undefined => {
      let oid = held.get(name)
      let oid256 = oid && known.get(oid)
      return oid && oid256 ? { oid, oid256 } : undefined
    }
    let children: Child[] = []
    for (let [name, sha] of at.files) {
      let oids = (stood(name, sha) && kept(name)) || fresh.get(sha) ||
        await blob(sha)
      children.push({ name, mode: FILE, ...oids })
    }
    for (let [name, dir] of at.dirs) {
      let oids = stood(name) && kept(name)
      let before = oids ? { dir: was!.dir.dirs.get(name)!, oids } : undefined
      children.push({ name, mode: DIR, ...await fold(dir, fresh, before) })
    }
    return tree(children)
  }

  return {
    blob,
    tree,
    commit,
    files: async (m, base) =>
      fold(
        nest(m),
        await blobs(
          Object.entries(m).filter(([path, sha]) => base?.files[path] != sha)
            .map(([, sha]) => sha),
        ),
        base && { dir: nest(base.files), oids: base.tree },
      ),
  }
}
