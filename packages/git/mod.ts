/**
 * @yaks/git — git objects as entities, so a deploy history is a repository
 * anybody can clone.
 *
 * A yaks.app version is a manifest — `path → sha256`, over bytes already in a
 * @yaks/blob store. This package turns one into the objects git asks for, and
 * keeps them in a graph:
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
 * Four things it is made of:
 *
 * - **An object's entity id IS its object id.** {@link oid} is git's SHA-1
 *   name, taken over `"<type> <size>\0<body>"` — so the same object written by
 *   two apps is one row, and a `want` off the wire is a `get`.
 * - **Every object has a SHA-256 name too**, from the first day: {@link oid256}
 *   over the same object with its children translated, kept as an @yaks/key of
 *   kind `oid256`. A client asking for `object-format=sha256` is answered by a
 *   lookup, never a migration.
 * - **Bodies are bytes, rows are walks.** {@link treeBody} and
 *   {@link commitBody} write git's own bytes; the graph keeps `gitobj{type,
 *   size}`, `blob{sha}`, and the two edges a pack walks — `entry` and `parent`.
 * - **A git blob is our blob.** The bytes an app deployed are already stored
 *   under their SHA-256; the object is a header hashed over them, and nothing
 *   is re-encoded or copied.
 * - **A clone is those walks, packed.** {@link objects} names every object
 *   reachable from a set of wants, minus what the client has, and
 *   {@link pack} streams them as a v2 packfile — whole objects, no deltas.
 *
 * It imports no platform API beyond `crypto.subtle` and `CompressionStream`,
 * so the same code runs on a server, in a worker, and in a browser tab. It
 * speaks no HTTP: the wire that carries a pack is somebody else's.
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
