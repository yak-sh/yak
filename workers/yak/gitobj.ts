// A deploy as a git commit — the ADAPTER, and only the adapter. @yaks/git owns
// the objects, the branch and the landing (`commitOnto`, refs.ts); what is left
// here is the four things that are yaks.app's and could not be anyone else's:
//
//   which stores    the objects' own (`GIT_STORE`, door.ts) and the directory
//   which bytes     `git/<sha>` for a body we minted, `pins()` for app files
//   what a deploy is  its manifest, its clock, and who signed it
//   what to record  the `commit{target}` row joining a commit to its release
//
// TWO STORES, AND WHICH IS WHICH. A git object is named by the digest of its
// own bytes, so the same file deployed by two apps in two spaces is one row —
// which a per-app graph could not say — and the objects live in a store of
// their own, reached over its door like any other. A REF belongs to one app,
// and access to an app is decided in the directory, so that is where it stays.
//
// A DEPLOY ALREADY SAYS EVERYTHING A COMMIT NEEDS. Its manifest is `path →
// sha256` over bytes the platform pinned (versions.ts), its `created` is the
// moment and the actor, and the version before it is the parent. So nothing
// here computes: it reads a deploy and hands @yaks/git a landing.
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
import {
  commitOnto,
  MAIN,
  refAt as branchAt,
  refEid,
  type Released,
  type Releases,
  type Repo,
  type Writes,
} from '@yaks/git'
import type { Bundle, Eid } from '@yaks/graph'
import { r2Blobs } from '../../src/blobs_r2.ts'
import type { Blobs } from '../../src/store/blobs.ts'
import { GIT_STORE, type Namespace, storeOf } from './door.ts'
import { spaceHost } from './host.ts'
import { KERNEL, type Meta, metaOf } from './meta.ts'
import { pins } from './versions.ts'

export { MAIN, refEid }

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
  write: (bundles: Bundle[]) => Promise<Bundle[]>
}

/** The directory as one of those, over its door. */
export let held = (m: Meta): Held => ({
  read: (line) => m.query(line),
  write: (bundles) => m.apply(bundles, KERNEL),
})

// The same pair said the way @yaks/git asks for a graph. A store answers
// `/query` and `/apply` whoever asks, so an index over a door is the same
// index as one over a graph in this process — which is the whole reason the
// package asks for {@link Writes} and not a `Graph`.
let writes = (dir: Held): Writes => ({
  read: (query) => dir.read(String(query)),
  apply: (change) => dir.write(change as Bundle[]),
})

/** The git object store, as one of those, over its own door. */
export let graphOf = (ns: Namespace): Writes =>
  writes(held(metaOf(storeOf(ns, GIT_STORE))))

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

// A deploy, as everything below reads one.
type Deploy = {
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
let deployOf = (b: Bundle): Deploy | null => {
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

/** Where an app's files are in the bucket, and what its repository is called
 * on the web. Both are ADDRESSES — they move when a slug does — which is why
 * they are read at mint time and not kept. */
let placed = async (dir: Held, env: Bound, app: Eid) => {
  let [row] = await dir.read(`.eid=${app}`)
  let a = row?.app as Record<string, unknown> | undefined
  if (!a) return null
  let [space] = await dir.read(`.eid=${id(a.space)}`)
  let s = space?.space as Record<string, unknown> | undefined
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

/**
 * Where an app's branch stands: the commit its ref names, or `null` before its
 * first deploy. This is the whole of `ls-refs` on our side, so the serving
 * half reads a branch through this and not by spelling the row.
 */
export let refAt = (dir: Held, app: Eid, name = MAIN): Promise<string | null> =>
  branchAt(writes(dir), app, name)

/**
 * One deploy as a landing, or `null` where there is nothing to land — no
 * bindings, no app to place it under, or a commit about that deploy already.
 * That last read is what makes running this over a whole history twice cost
 * one pass of reads and no writes.
 */
let landing = async (
  env: Bound,
  dir: Held,
  deploy: Deploy,
): Promise<Released | null> => {
  if (!env.BLOBS || !env.STORE) return null
  if ((await dir.read(`.commit.target=${deploy.eid}`)).length) return null
  let at = await placed(dir, env, deploy.app)
  if (!at) return null
  let message = `deploy ${deploy.version}\n`
  let repo: Repo = {
    refs: writes(dir),
    objects: graphOf(env.STORE),
    bytes: bodies(r2Blobs(env.BLOBS), at.prefix),
  }
  return {
    repo,
    app: deploy.app,
    files: deploy.files,
    author: await author(dir, deploy),
    committer: { ...COMMITTER, at: deploy.at },
    message,
    // The word the DIRECTORY gains about a release, written with the moved ref
    // (git.ts): `target` is what the commit is about, so a history joins to the
    // releases people already look at.
    beside: (oids) => [{
      entity: { eid: oids.oid },
      commit: {
        sha: oids.oid,
        repo: at.repo,
        message,
        target: deploy.eid,
      },
    }],
  }
}

/**
 * yaks.app's releases, as @yaks/git's plugin reads them (git.ts): a `deploy`
 * row is one, and the whole entity is what a landing is read from — a commit's
 * clock and author are the `created` stamp beside the component, not columns
 * of it.
 */
export let releases = (env: Bound, dir: Held): Releases => ({
  comp: 'deploy',
  of: async (b) => {
    let [row] = await dir.read(`.eid=${b.entity.eid}`)
    let deploy = row && deployOf(row)
    return deploy ? await landing(env, dir, deploy) : null
  },
})

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
        let l = await landing(env, dir, d)
        if (!l) continue
        await commitOnto(l.repo, l)
        made++
      } catch (e) {
        console.log(`yak-git: ${d.eid} — ${(e as Error).message}`)
        break
      }
    }
  }
  return made
}
