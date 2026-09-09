// The object index: git objects as entities, written once.
//
// An object's entity id IS its SHA-1 object id, so the same object written by
// two deploys, two apps or two runs is one row — there is no lookup, no
// uniqueness constraint, and nothing to reconcile. Beside each row goes an
// @yaks/key naming the same object's SHA-256 id, so a client that asks for
// `object-format=sha256` is answered by a `get`.
//
// WHAT IS A ROW AND WHAT IS BYTES. The body is the truth about a tree or a
// commit — byte-for-byte, because git's ids are digests of it — so the body
// goes to the @yaks/blob store and the row keeps only what a query has to walk:
// the type and size a pack entry's header needs, the `blob{sha}` its bytes are
// under, `entry` edges (tree → child, the name on the link) and `parent` edges
// (commit → commit). Author, message, entry order and mode all live in the body
// already; a column for them would be a second copy free to drift.
//
// A GIT BLOB IS OUR BLOB. The bytes an app deployed are already in the store
// under their SHA-256; a git blob object is those same bytes with a header
// hashed over them, so nothing is re-encoded and the row simply points at what
// is there. Naming a manifest's file twice, or across versions, costs one query
// and no read at all.
//
// This module writes objects; it never reads a pack or speaks HTTP (T-34948,
// T-34946), and it writes no `commit{target}` row — joining a commit to the
// deploy it was minted from is the backfill's business (T-34950), on the same
// entity.

import type { Blobs } from '@yaks/blob'
import { EDGE, link } from '@yaks/edge'
import type { Bundle, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph'
import { keyed, valueOf } from '@yaks/key'
import { type Commit, commitBody } from './commit.ts'
import { BLOB, COMPAT, ENTRY, GITOBJ, PARENT } from './comp.ts'
import { hex, type Kind, oid, oid256, type Oids } from './oid.ts'
import { DIR, type Dir, FILE, type Files, nest, treeBody } from './tree.ts'

/** One child of a tree, named both ways. */
export type Child = { name: string; mode: string } & Oids

/** A commit to mint: the same as a {@link Commit}, with every id in both of
 * its names, since the two bodies are built from the two flavours. */
export type Mint = Omit<Commit, 'tree' | 'parents'> & {
  tree: Oids
  parents?: Oids[]
}

/**
 * What writing objects asks of a graph: a query and a batch, and nothing else.
 *
 * Narrower than `Graph` on purpose. The object index is the same code whether
 * the graph is in this process or behind a door — a Durable Object's `/query`
 * and `/apply` answer both of these — and a parameter that demanded a whole
 * `Graph` would have made a remote caller invent a storage and a vocabulary it
 * has no use for.
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
   * root tree it answers with */
  files: (manifest: Files) => Promise<Oids>
}

/**
 * The entity a tree's child link is: `sha256("entry|<tree>|<name>")`.
 *
 * Not @yaks/edge's own derivation, and for a reason a duplicate file makes
 * loud: two names in one tree may point at ONE blob (two empty files), and
 * `from|entry|to` is the same sentence for both, so one entry would overwrite
 * the other. Within a tree a NAME is unique — that is the sentence.
 */
export let entryEid = (tree: Eid, name: string): Eid =>
  derivedEid(`${ENTRY}|${tree}|${name}`)

let sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))

/**
 * An object index over a graph carrying this package's vocabulary and a
 * @yaks/blob store holding the bytes.
 *
 * ```ts
 * // let git = index(g, store)
 * // let tree = await git.files({ 'index.html': sha })
 * // let head = await git.commit({ tree, author, committer, message: 'deploy 1' })
 * ```
 */
export let index = (g: Writes, store: Blobs): Index => {
  // The bytes of a body we minted, under their own address. A blob object's
  // bytes are already there under the same address, which is why this is only
  // ever called for trees and commits.
  let put = async (body: Uint8Array<ArrayBuffer>): Promise<string> => {
    let sha = await sha256(body)
    if (!await store.has(sha)) await store.put(sha, body)
    return sha
  }

  // The row every object gets, plus its SHA-256 name and whatever walk it
  // contributes. Writing it again is a patch of what is already there.
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

  // The git blob object over these bytes, if we have already named it. This is
  // the whole of the caching story: a manifest repeating a file, or a second
  // version of the same app, reads a row instead of the bytes.
  let named = async (sha: string): Promise<Oids | undefined> => {
    let [obj] = await g.read(`.gitobj.type=blob&.blob.sha=${sha}`)
    if (!obj) return
    let [key] = await g.read(`.${COMPAT}!&.key.of=${obj.entity.eid}`)
    let name = key && valueOf(key)
    return name ? { oid: obj.entity.eid, oid256: name } : undefined
  }

  let blob = async (sha: string): Promise<Oids> => {
    let had = await named(sha)
    if (had) return had
    let bytes = await store.get(sha)
    if (!bytes) throw new Error(`git: no bytes stored under ${sha}`)
    // One body, two names: a blob's bytes are what both digests are over.
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
        [ENTRY]: { name: c.name, mode: c.mode },
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

  // Bottom up: a directory cannot be named until every child under it is.
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
