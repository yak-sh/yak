// Where a branch stands, and how a manifest lands on it: the one step between
// "here are some files" and "this repository has a new commit".
//
// A REF IS A ROW, one per repository and branch name ({@link refEid}), so
// moving a branch is a patch of the row that was already there rather than a
// second row somebody has to notice is stale. It is the one part of a
// repository that belongs to exactly one repository — objects are named by the
// digest of their own bytes and are therefore global — which is why the ref
// graph and the object graph are two arguments here ({@link Repo}) and may be
// two stores.
//
// A LANDING SAYS WHAT A COMMIT NEEDS AND NOTHING ELSE: the manifest, the two
// signatures, the message. The PARENT is not among them — it is read from the
// ref, so a commit minted by whatever watches for releases and a commit minted
// by a repair pass are made the same way and follow the same chain.
//
// MINTING IS REPEATABLE, which is what makes a repair pass cheap: every id is a
// digest of the bytes, and the bytes are the manifest and the clocks the caller
// hands over, so landing the same release twice makes the same objects. What it
// must not do twice is APPEND — hence `beside`, where the caller writes down
// what it already looked for before calling.

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
 * The entity a ref IS: `sha256("ref|<app>|<name>")`.
 *
 * Derived rather than minted, so writing where a branch stands is idempotent
 * from anywhere — the effect that saw the release and the sweep that missed it
 * patch one row.
 */
export let refEid = (app: Eid, name: string): Eid =>
  derivedEid(`${REF}|${app}|${name}`)

// A REFERENCE column, in either spelling a store answers with: the bare eid a
// read inside a transaction gives, and the `{eid, name}` a read over a store's
// HTTP door gives, which names what it points at as it goes. One reader, so a
// branch is read the same however the graph was reached.
let id = (v: unknown): string =>
  typeof v == 'string' ? v : String((v as { eid?: unknown } | null)?.eid ?? '')

/**
 * The two graphs and the byte store a repository is kept in.
 *
 * `refs` and `objects` may be the same graph — nothing here needs them apart —
 * but they are two arguments because a host that decides ACCESS per repository
 * keeps its branches where that decision is made and its objects, which are
 * global, in a store of their own.
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
  /** the branch, `refs/heads/main` unsaid */
  branch?: string
  /** the manifest: path → the SHA-256 the byte store holds that file under */
  files: Files
  /** who made the change */
  author: Who
  /** who recorded it — the platform doing the minting */
  committer: Who
  /** the commit message */
  message: string
  /**
   * What the caller records ABOUT this commit, written in the same batch as
   * the moved ref. This package writes no row joining a commit to whatever it
   * was minted from: that word belongs to whoever mints it.
   */
  beside?: (oids: Oids) => Bundle[]
}

/**
 * Where a branch stands: the commit its ref names, or `null` before the first
 * one. This is the whole of `ls-refs` on the server's side, so a mount reads a
 * branch through this and never by spelling the row.
 */
export let refAt = async (
  refs: Writes,
  app: Eid,
  name = MAIN,
): Promise<string | null> => {
  let [row] = await refs.read(`.eid=${refEid(app, name)}`)
  return id((row?.[REF] as Record<string, unknown> | undefined)?.commit) || null
}

/** An object already written, named both ways: its SHA-1 id is the row's own
 * eid, and its SHA-256 id is the @yaks/key beside it. */
let named = async (g: Writes, oid: string): Promise<Oids | null> => {
  let [key] = await g.read(`.${COMPAT}!&.key.of=${oid}`)
  let value = key && valueOf(key)
  return value ? { oid, oid256: value } : null
}

/** The bundle that moves a branch onto a commit. */
export let moved = (app: Eid, name: string, commit: string): Bundle => ({
  entity: { eid: refEid(app, name) },
  [REF]: { app, name, commit },
})

/**
 * One manifest as a commit on a branch: every object it needs written, the
 * branch moved onto it, and whatever the caller says beside it in that same
 * batch. It answers the commit's two ids.
 *
 * The parent is the branch as it stands, read here rather than carried by the
 * caller, so a chain is the order the releases actually happened in.
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
