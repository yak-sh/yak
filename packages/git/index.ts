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
// across versions, costs one query and no read of the bytes.
//
// This module writes objects and nothing else: it never reads a packfile,
// serves HTTP, or touches a branch. Landing a manifest on a branch is
// ./refs.ts, and the row joining a commit to whatever it was built from is the
// application's own, written there alongside the moved ref.

import type { Blobs } from '@yaks/blob'
import { EDGE, link } from '@yaks/edge'
import type { Bundle, Eid, Graph } from '@yaks/graph'
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
   * root tree it returns */
  files: (manifest: Files) => Promise<Oids>
}

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
  let write = async (
    oids: Oids,
    type: Kind,
    size: number,
    sha: string,
    walk: Bundle[] = [],
  ): Promise<Oids> => {
    await g.apply([
      { entity: { eid: oids.oid }, [GITOBJ]: { type, size }, [BLOB]: { sha } },
      keyed(COMPAT, oids.oid, oids.oid256),
      ...walk,
    ])
    return oids
  }

  // The Git blob object over these bytes, if we have computed its id before.
  // This is the whole of the caching: a manifest that repeats a file, or a
  // second version of the same app, reads a row instead of the bytes.
  let named = async (sha: string): Promise<Oids | undefined> => {
    let [obj] = await g.read(`.gitobj.type=blob&.blob.sha=${sha}`)
    if (!obj) return
    let [key] = await g.read(`.${COMPAT}&.key.of=${obj.entity.eid}`)
    let name = key && valueOf(key)
    return name ? { oid: obj.entity.eid, oid256: name } : undefined
  }

  let blob = async (sha: string): Promise<Oids> => {
    let had = await named(sha)
    if (had) return had
    let bytes = await store.get(sha)
    if (!bytes) throw new Error(`git: no bytes stored under ${sha}`)
    // One body, two ids: a blob's bytes are what both digests are taken over.
    return write(
      {
        oid: await oid('blob', bytes),
        oid256: await oid256('blob', bytes),
      },
      'blob',
      bytes.length,
      sha,
    )
  }

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

  // Bottom up: a directory has no id until every child under it has one.
  let fold = async (at: Dir): Promise<Oids> => {
    let children: Child[] = []
    for (let [name, sha] of at.files) {
      children.push({ name, mode: FILE, ...await blob(sha) })
    }
    for (let [name, sub] of at.dirs) {
      children.push({ name, mode: DIR, ...await fold(sub) })
    }
    return tree(children)
  }

  return { blob, tree, commit, files: (m) => fold(nest(m)) }
}
