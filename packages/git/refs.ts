// Where a branch points, and how a manifest lands on it: the one step between
// "here are some files" and "this repository has a new commit".
//
// A ref is A row, one per repository and branch name ({@link refEid}), so
// moving a branch updates the row that is already there rather than adding a
// second row someone has to notice is stale. It is the one part of a
// repository that belongs to exactly one repository — objects are named by the
// digest of their own bytes and are therefore global — which is why the ref
// graph and the object graph are two separate arguments here ({@link Repo})
// and may be two separate stores.
//
// A landing holds what A commit needs and nothing else: the manifest, the two
// signatures, the message. The parent is not among them — it is read from the
// ref, so a commit written by whatever watches for releases and a commit
// written later by a repair pass are built the same way and land on the same
// chain.
//
// Writing A commit is repeatable, which is what makes a repair pass cheap:
// every id is a digest of the bytes, and the bytes are the manifest and the
// timestamps the caller hands over, so landing the same release twice produces
// the same objects. What it must not do twice is append — hence `beside`,
// where the caller writes the rows it has already checked are not there.

import type { Blobs } from '@yaks/blob'
import type { Bundle, Eid } from '@yaks/graph'
import { derivedEid } from '@yaks/graph'
import { valueOf } from '@yaks/key'
import type { Who } from './commit.ts'
import { COMPAT, REF } from './comp.ts'
import { MAIN } from './http.ts'
import { index, type Writes } from './index.ts'
import type { Oids } from './oid.ts'
import type { Files } from './tree.ts'

/**
 * The entity id of a ref, derived from the string `ref|<app>|<name>`.
 *
 * Derived rather than freshly generated, so writing where a branch points is
 * idempotent from anywhere: the hook that saw the release and the sweep that
 * missed it update the same row.
 */
export let refEid = (app: Eid, name: string): Eid =>
  derivedEid(`${REF}|${app}|${name}`)

// Reads a reference property in either of the two forms a store returns: the
// bare eid that a read inside a transaction gives, and the `{eid, name}`
// object that a read over a store's HTTP API gives, which names what the
// reference points at as it goes. One reader, so a branch reads the same
// however the graph was reached.
let id = (v: unknown): string =>
  typeof v == 'string' ? v : String((v as { eid?: unknown } | null)?.eid ?? '')

/**
 * The two graphs and the byte store a repository is kept in.
 *
 * `refs` and `objects` may be the same graph — nothing here needs them
 * separate — but they are two arguments because a server that decides read
 * access per repository keeps its branches where that decision is made, and
 * its objects, which are global, in a store of their own.
 */
export type Repo = {
  /** the graph the `ref` row lives in */
  refs: Writes
  /** the graph the objects live in */
  objects: Writes
  /** the bytes: a tree's and a commit's, and the file a blob names */
  bytes: Blobs
}

/** One release, as landing it on a branch needs it. */
export type Landing = {
  /** the entity the repository belongs to */
  app: Eid
  /** the branch; defaults to `refs/heads/main` */
  branch?: string
  /** the manifest: path → the SHA-256 the byte store holds that file under */
  files: Files
  /** who made the change */
  author: Who
  /** who recorded it — the platform writing the commit */
  committer: Who
  /** the commit message */
  message: string
  /**
   * Rows the caller wants recorded about this commit, written in the same
   * transaction as the moved ref. This package writes no row joining a commit
   * to whatever it was built from: those rows belong to whoever builds it.
   */
  beside?: (oids: Oids) => Bundle[]
}

/**
 * Where a branch points: the commit its ref names, or `null` before the first
 * commit. This is all of `ls-refs` on the server's side, so whatever mounts
 * the HTTP handlers reads a branch through this rather than by querying the
 * row itself.
 */
export let refAt = async (
  refs: Writes,
  app: Eid,
  name = MAIN,
): Promise<string | null> => {
  let [row] = await refs.read(`.eid=${refEid(app, name)}`)
  return id((row?.[REF] as Record<string, unknown> | undefined)?.commit) || null
}

/** An object already written, with both its ids: its SHA-1 id is the row's own
 * eid, and its SHA-256 id is in the @yaks/key beside it. */
let named = async (g: Writes, oid: string): Promise<Oids | null> => {
  let [key] = await g.read(`.${COMPAT}&.key.of=${oid}`)
  let value = key && valueOf(key)
  return value ? { oid, oid256: value } : null
}

/** The row that points a branch at a commit. */
export let moved = (app: Eid, name: string, commit: string): Bundle => ({
  entity: { eid: refEid(app, name) },
  [REF]: { app, name, commit },
})

/**
 * One manifest as a commit on a branch: every object it needs written, the
 * branch pointed at it, and whatever the caller passes in `beside` written in
 * that same transaction. Returns the commit's two ids.
 *
 * The parent is wherever the branch points now, read here rather than passed
 * in by the caller, so the chain follows the order the releases actually
 * happened in.
 */
export let commitOnto = async (
  repo: Repo,
  l: Landing,
): Promise<Oids> => {
  let name = l.branch ?? MAIN
  let git = index(repo.objects, repo.bytes)
  let at = await refAt(repo.refs, l.app, name)
  let parent = at ? await named(repo.objects, at) : null
  let commit = await git.commit({
    tree: await git.files(l.files),
    parents: parent ? [parent] : [],
    author: l.author,
    committer: l.committer,
    message: l.message,
  })
  await repo.refs.apply([
    ...l.beside?.(commit) ?? [],
    moved(l.app, name, commit.oid),
  ])
  return commit
}
