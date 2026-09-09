// A deploy as a git commit: the objects it makes, and where the app's branch
// stands afterwards. The shape is D-34943; git.ts is the plugin that runs it.
//
// ONE GLOBAL OBJECT GRAPH. A git object is named by the digest of its own
// bytes, so the same file deployed by two apps in two spaces is one row — which
// a per-app graph could not say. The objects therefore live in a store of their
// own (`yak/git`, door.ts), reached over its door like any other store. REFS
// are the exception and stay in the directory, on the app: a ref is the one
// part of a repository that belongs to one app, and access to an app is decided
// in the directory.
//
// A DEPLOY ALREADY SAYS EVERYTHING A COMMIT NEEDS. Its manifest is `path →
// sha256` over bytes the platform pinned (versions.ts), its `created` is the
// moment and the actor, and the version before it is the parent. So nothing
// here computes: it reads a deploy, hands @yaks/git the manifest, and writes
// down the two facts the directory did not have — the `commit` beside the
// deploy, and where `refs/heads/main` now points.
//
// IDENTITY. The author is the actor who deployed, at a pseudonym —
// `<actor>@users.yaks.app` — until somebody opts into their own address
// standing in a public history. The committer is always the platform. Both
// clocks are the deploy's own `created.at`, which is what makes minting
// REPEATABLE: the same deploys make the same object ids however often this
// runs, so the backfill below is idempotent by construction and not by a flag.
//
// NOTHING HERE MAY FAIL A DEPLOY. It runs as an effect — post-commit, isolated
// by @yaks/effects — so a bucket that will not answer costs the release its
// commit and nothing else, and the daily sweep mints whatever was missed.
import type { Blobs as Bytes } from '@yaks/blob'
import { index, type Oids, type Writes } from '@yaks/git'
import type { Bundle, Eid } from '@yaks/graph'
import { derivedEid } from '@yaks/graph'
import { valueOf } from '@yaks/key'
import { r2Blobs } from '../../src/blobs_r2.ts'
import type { Blobs } from '../../src/store/blobs.ts'
import { GIT_STORE, type Namespace, storeOf } from './door.ts'
import { spaceHost } from './host.ts'
import { KERNEL, type Meta, metaOf } from './meta.ts'
import { pins } from './versions.ts'

/** The branch a yaks.app repository answers with, and the only one it has
 * (D-34943). Git's own default, so `git clone` needs no `-b`. */
export let MAIN = 'refs/heads/main'

/**
 * Where a body we MINTED is kept — a tree's or a commit's — in its own key
 * space, two segments deep so no app file key (`<space>/<app>/<path>`) can
 * reach it.
 *
 * Not the app pins' `sha/` (versions.ts, D-34942), and for one reason: that
 * key space is swept against what the APPS name, and a tree is nobody's file.
 * A body under it would be deleted the day after it was written. Nothing
 * sweeps this space yet — an object graph's own retention is its own question,
 * for when a deleted app's orphaned objects are worth collecting.
 */
export let BODY = 'git/'

/** Who the platform signs a commit as. The author is the person who deployed;
 * this is the machine that wrote it down. */
export let COMMITTER = { name: 'yaks.app', email: 'git@yaks.app' }

/** The domain an actor's pseudonymous address is under. A history is public,
 * so nobody's own address goes into one until they say so. */
export let PSEUDONYM = 'users.yaks.app'

/** The bindings minting needs: the bucket the bytes are in, the namespace the
 * object store answers on, and the apex its clone URLs are written at. */
export type Bound = {
  BLOBS?: Parameters<typeof r2Blobs>[0]
  STORE?: Namespace
  APEX?: string
}

/**
 * The directory, as the two calls this module makes of it. An effect has the
 * transaction its own batch committed against; the sweep has the store's door
 * (meta.ts). One seam, so minting is the same code from either.
 */
export type Held = {
  read: (line: string) => Promise<Bundle[]>
  write: (bundles: Bundle[]) => Promise<unknown>
}

/** The directory as one of those, over its door. */
export let held = (m: Meta): Held => ({
  read: (line) => m.query(line),
  write: (bundles) => m.apply(bundles, KERNEL),
})

/**
 * The object store, as the two calls @yaks/git makes of a graph. A store
 * answers `/query` and `/apply` whoever asks, so an index over a door is the
 * same index as one over a graph in this process — which is the whole reason
 * `index()` asks for {@link Writes} and not a `Graph`.
 */
export let graphOf = (ns: Namespace): Writes => {
  let door = metaOf(storeOf(ns, GIT_STORE))
  return {
    read: (query) => door.query(String(query)),
    apply: (change) => door.apply(change, KERNEL),
  }
}

/**
 * Bytes by their sha, in @yaks/blob's terms — every body a git object could
 * ask for, whoever wrote it.
 *
 * Two key spaces, because there are two kinds of body and only one of them is
 * ours. A BLOB's bytes are the app's own file, already pinned by the deploy
 * that named it, so they are read through versions.ts's `pins` and never
 * written here. A TREE's or a COMMIT's bytes are ours, so they are written to
 * {@link BODY} and read from there first. Serving a pack reads through this
 * same door (@yaks/git `objects`), which is why it is exported.
 */
export let bodies = (blobs: Blobs, prefix: string): Bytes => {
  let app = pins(blobs, prefix)
  return {
    has: async (sha) => await blobs.has(BODY + sha) || await app.has(sha),
    get: async (sha) => await blobs.read(BODY + sha) ?? await app.get(sha),
    put: (sha, bytes) => blobs.put(BODY + sha, bytes),
  }
}

/** A deploy, as everything below reads one. */
export type Deploy = {
  eid: Eid
  app: Eid
  version: number
  files: Record<string, string>
  at: string
  by: Eid | null
}

let str = (v: unknown): string => typeof v == 'string' ? v : ''

// A REFERENCE column, in either spelling a store answers with: the bare eid a
// read inside the transaction gives (the effect's own door), and the `{eid,
// name}` a read over the store's HTTP door gives, which names what it points
// at as it goes (listing.ts). One reader, so minting is the same act from the
// deploy that woke it and from the sweep that missed it.
let id = (v: unknown): string =>
  typeof v == 'string' ? v : str((v as { eid?: unknown } | null)?.eid)

/** A directory row as a deploy, or nothing where it is not one. A manifest
 * that will not parse is a version nothing can restore and therefore nothing
 * can commit (directory.ts `deployOf` reads it the same way). */
export let deployOf = (b: Bundle): Deploy | null => {
  let d = b.deploy as Record<string, unknown> | undefined
  let made = b.created as Record<string, unknown> | undefined
  if (!d || !id(d.app)) return null
  try {
    return {
      eid: b.entity.eid,
      app: id(d.app) as Eid,
      version: Number(d.version ?? 0),
      files: JSON.parse(str(d.files) || '{}') as Record<string, string>,
      at: str(made?.at),
      by: (id(made?.by) || null) as Eid | null,
    }
  } catch {
    return null
  }
}

/** The entity a ref IS: one row per app and branch name, so moving a branch is
 * a patch of the row that was already there rather than a second row somebody
 * has to notice is stale. @yaks/git names a tree's entries the same way. */
export let refEid = (app: Eid, name: string): Eid =>
  derivedEid(`ref|${app}|${name}`)

/** Where an app's files are in the bucket, and what its repository is called
 * on the web. Both are ADDRESSES — they move when a slug does — which is why
 * they are read at mint time and not kept. */
let placed = async (dir: Held, env: Bound, app: Eid) => {
  let [row] = await dir.read(`.eid=${app}`)
  let a = row?.app as Record<string, unknown> | undefined
  if (!a) return null
  let [held] = await dir.read(`.eid=${id(a.space)}`)
  let s = held?.space as Record<string, unknown> | undefined
  if (!s) return null
  return {
    prefix: `${str(s.slug)}/${str(a.slug)}/`,
    repo: `https://${spaceHost(env, str(s.slug))}/${str(a.slug)}.git`,
  }
}

/** Who deployed, as a git author. A deploy nobody signed — a seeded app, a
 * restore — is authored by the platform that wrote it. */
let author = async (dir: Held, deploy: Deploy) => {
  if (!deploy.by) return { ...COMMITTER, at: deploy.at }
  let [row] = await dir.read(`.eid=${deploy.by}`)
  let doc = row?.doc as Record<string, unknown> | undefined
  return {
    name: str(doc?.title) || deploy.by,
    email: `${deploy.by}@${PSEUDONYM}`,
    at: deploy.at,
  }
}

/** An object already written, named both ways: its SHA-1 id is the row's own
 * eid, and its SHA-256 id is the @yaks/key beside it (@yaks/git `compat`). */
let named = async (g: Writes, oid: string): Promise<Oids | null> => {
  let [key] = await g.read(`.compat!&.key.of=${oid}`)
  let value = key && valueOf(key)
  return value ? { oid, oid256: value } : null
}

/**
 * Where an app's branch stands: the commit its ref names, or `null` before its
 * first deploy. This is the whole of `ls-refs` on our side, so the serving
 * half (T-34946) reads a branch through this and not by spelling the row.
 */
export let refAt = async (
  dir: Held,
  app: Eid,
  name = MAIN,
): Promise<string | null> => {
  let [row] = await dir.read(`.eid=${refEid(app, name)}`)
  return id((row?.ref as Record<string, unknown> | undefined)?.commit) || null
}

/** That commit named both ways, which is what a new one follows. */
let head = async (dir: Held, g: Writes, app: Eid) => {
  let at = await refAt(dir, app)
  return at ? await named(g, at) : null
}

/**
 * One deploy as a commit, and the app's branch moved onto it — or `null` where
 * there is already a commit about that deploy, which is what makes running this
 * over a whole history twice cost one pass of reads and no writes.
 *
 * The parent is read from the REF rather than carried by the caller, so a
 * commit minted by a deploy and one minted by the sweep are made the same way.
 */
export let minted = async (
  env: Bound,
  dir: Held,
  deploy: Deploy,
): Promise<string | null> => {
  if (!env.BLOBS || !env.STORE) return null
  if ((await dir.read(`.commit.target=${deploy.eid}`)).length) return null
  let at = await placed(dir, env, deploy.app)
  if (!at) return null
  let g = graphOf(env.STORE)
  let git = index(g, bodies(r2Blobs(env.BLOBS), at.prefix))
  let parent = await head(dir, g, deploy.app)
  let message = `deploy ${deploy.version}\n`
  let commit = await git.commit({
    tree: await git.files(deploy.files),
    parents: parent ? [parent] : [],
    author: await author(dir, deploy),
    committer: { ...COMMITTER, at: deploy.at },
    message,
  })
  await dir.write([
    {
      entity: { eid: commit.oid },
      commit: {
        sha: commit.oid,
        repo: at.repo,
        message,
        target: deploy.eid,
      },
    },
    {
      entity: { eid: refEid(deploy.app, MAIN) },
      ref: { app: deploy.app, name: MAIN, commit: commit.oid },
    },
  ])
  return commit.oid
}

/**
 * Every deploy of every app that has no commit yet, oldest first — the one
 * sweep, run daily (git.ts) rather than once, because a deploy whose effect
 * failed is exactly the same hole as a deploy from before any of this existed.
 *
 * Per app, in `version` order, so the chain a clone walks is the order the
 * versions actually happened in. An app whose commit fails is skipped and left
 * for tomorrow: one app's bucket is never another app's problem.
 */
export let backfilled = async (env: Bound, dir: Held): Promise<number> => {
  let deploys = (await dir.read('.deploy!&.created?'))
    .map(deployOf)
    .filter((d): d is Deploy => !!d)
  let apps = new Map<Eid, Deploy[]>()
  for (let d of deploys) apps.set(d.app, [...apps.get(d.app) ?? [], d])
  let made = 0
  for (let all of apps.values()) {
    for (let d of all.sort((a, b) => a.version - b.version)) {
      try {
        if (await minted(env, dir, d)) made++
      } catch (e) {
        console.log(`yak-git: ${d.eid} — ${(e as Error).message}`)
        break
      }
    }
  }
  return made
}
