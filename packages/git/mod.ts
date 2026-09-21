/**
 * @yaks/git — Git objects stored as graph entities, so a deploy history is a
 * repository anyone can clone.
 *
 * A yaks.app version is a file manifest — `path → sha256`, over bytes already
 * in a @yaks/blob store. This package turns one into the objects Git asks for
 * and keeps them in a graph:
 *
 * ```ts
 * import { index } from '@yaks/git'
 *
 * // let git = index(g, store)
 * // let tree = await git.files({ 'index.html': sha, 'lib/app.js': other })
 * // let head = await git.commit({
 * //   tree,
 * //   author: { name: 'ada', email: 'ada@users.yaks.app', at: deployedAt },
 * //   committer: { name: 'yaks.app', email: 'git@yaks.app', at: deployedAt },
 * //   message: 'deploy 7',
 * // })
 * ```
 *
 * What it is made of:
 *
 * - **An object's entity id IS its Git object id.** {@link oid} computes Git's
 *   SHA-1 id over `"<type> <size>\0<body>"`, so the same object written by two
 *   apps is one row, and a `want` line in a fetch request is a lookup by id.
 * - **Every object also has a SHA-256 object id**, from the first write:
 *   {@link oid256} over the same object with its children's ids translated,
 *   stored as an @yaks/key of kind `compat`. A client that asks for
 *   `object-format=sha256` is answered from that key rather than by converting
 *   the repository.
 * - **Bodies are bytes; rows are the links a walk follows.**
 *   {@link treeBody} and {@link commitBody} write Git's own bytes; the graph
 *   keeps `gitobj{type, size}`, `blob{sha}`, and the two edge types a pack
 *   follows — `tree_entry` and `parent`.
 * - **A Git blob is the blob you already have.** The bytes an app deployed are
 *   already stored under their SHA-256 address; the Git object is those bytes
 *   with a header hashed over them, and nothing is re-encoded or copied.
 * - **A clone is those walks, packed.** {@link objects} lists every object
 *   reachable from a set of wants, minus what the client already has, and
 *   {@link pack} streams them as a version 2 packfile — whole objects, no
 *   deltas.
 * - **A branch is a row.** {@link refEid} derives its entity id,
 *   {@link refAt} reads where it points, and {@link commitOnto} lands one
 *   manifest on it: objects written, then the branch moved, in an order that
 *   makes running it twice cost reads and no writes. {@link commits} is that
 *   same step packaged as a plugin hooked on the `effect` phase.
 * - **And a clone is HTTP.** {@link advertise} and {@link uploadPack}
 *   implement Git's smart HTTP protocol, version 2, read-only: a `Request` in,
 *   a `Response` out, over a {@link Refs} and an {@link Objects} that the
 *   caller mounting them supplies.
 *
 * The only platform APIs it uses are `crypto.subtle`, `CompressionStream` and
 * `Request`/`Response`, so the same code runs on a server, in a worker and in
 * a browser tab. It does no routing: which repository a URL names, and who may
 * read it, are decided by whatever mounts it.
 *
 * @module
 */

export * from './comp.ts'
export * from './oid.ts'
export * from './tree.ts'
export * from './commit.ts'
export * from './index.ts'
export * from './sha1.ts'
export * from './pack.ts'
export * from './objects.ts'
export * from './pkt.ts'
export * from './http.ts'
export * from './refs.ts'
export * from './plugin.ts'
