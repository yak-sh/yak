// An app's deploy history, clonable: `git clone https://<space>.yaks.app/
// <app>/` — the address straight from the browser — or the same at
// `<app>.git`. The door is @yaks/git's (`door`: which address is which, the
// redirect from the browser's, the challenge and the refusals); this file is
// yaks.app's host for it — which app a name is, who is asking, and where its
// refs and its objects are.
//
// It is a hostname's door (kernel.ts), because a repository is not a page of
// the app: `<app>.git` is a sibling address of `<app>/`, and
// @yaks/platform/routes admits no dot in a slug, so nothing an app can be
// called reaches here. Answering ahead of apps.ts is what keeps the home
// app's worker — which answers every address no app claims — from being
// handed a clone it cannot parse.
//
// A repository includes the app's private files and every past release, so
// cloning requires a seat that writes in the space, regardless of the app's
// access. A `yak login` grant is the password git is asked for.
// A trashed app is not found by anyone, credential
// or not, because it is not there to be refused (erase.ts). This is the one
// door that tells a proven caller an app exists — the pages answer 404 — and
// it is the price of a clone being able to end.
//
// The two halves live apart, and that is the whole shape of it: `ref` is the
// directory's row, on the app, because access is decided there; the objects
// are one global graph in a store of their own, because an object is named by
// the digest of its own bytes and the same file deployed twice is one row
// (gitobj.ts). So this reads a branch from the directory and hands @yaks/git a
// reader over the other store.
import { objects } from '@yaks/git'
import { door, type Found } from '@yaks/git/door'
import { writes } from '@yaks/member'
import { r2Objects } from './lib/objects.ts'
import { type Directory, directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { bodies, graphOf, held, MAIN, refAt } from './gitobj.ts'
import { held as heldGrant, ledger, narrowed } from './grants.ts'
import { meta } from './meta.ts'
import type { Arrived } from '@yaks/platform/routes'
import { nobody, type Who, whoIs } from './session.ts'

// Who is cloning, and what they hold in this space. The password is a `yaks_`
// grant: the one credential the platform puts in a person's own hands, minted
// by `yak login`, sealed under the session secret and revocable by its ledger
// row (grants.ts). It is read here at its source rather than through
// identity.ts, which resolves the same token but carries the OAuth provider —
// `cloudflare:` modules only workerd can load — in with it (apps.ts
// `identity`). No new kind of token: a connector's OAuth bearer is simply not
// a clone credential, since nothing ever shows it to the person who would type
// it into a URL.
//
// With no Basic at all the request is asked as it arrived, which is how a
// browser's cookie still counts. A grant narrowed to one space reaches no
// other, which is what `narrowed` says at every door that takes one.
let cloner = async (
  env: Env,
  req: Request,
  said: string | null,
  dir: Directory,
  space: Space,
): Promise<Who> => {
  if (!said) {
    return await whoIs(
      req,
      env,
      (p) => dir.role(space, p),
      space.eid,
    )
  }
  let grant = env.SESSION_SECRET
    ? await heldGrant(said, env.SESSION_SECRET, ledger(env.OAUTH_KV, dir))
    : null
  if (!grant) return nobody
  let reach = grant.space ? narrowed(dir, grant.space, grant.spaceEid) : dir
  return { person: grant.person, role: await reach.role(space, grant.person) }
}

// The app a name is in this space, as the request may see it: none where the
// space or the app is not there, or the platform keeps no objects to serve.
let find = (env: Env, at: string) =>
async (
  slug: string,
  req: Request,
  said: string | null,
): Promise<Found | null> => {
  if (!env.BLOBS || !env.STORE) return null
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  // A clone made before the space or the app moved keeps its remote, so an
  // old address is served where it lands (directory.ts `answering`,
  // D-131924); a fetch from it is the same repository, named by eid.
  let space = await dir.answering(at)
  if (!space) return null
  let app = await dir.answeringApp(space, slug)
  if (!app || app.trashed) return null
  let who = await cloner(env, req, said, dir, space)
  return {
    reads: writes(who.role),
    proven: !!who.person,
    // One branch, and none before the first deploy — an app that has never
    // been released clones as an empty repository rather than a refusal.
    refs: {
      list: async () => {
        let commit = await refAt(held(meta(env)), app.eid)
        return commit ? [{ name: MAIN, oid: commit }] : []
      },
    },
    objects: objects(
      graphOf(env.STORE),
      // The prefix a pin key is built from, so it ends in the separator:
      // `pinned` (versions.ts) writes `<prefix>versions/<sha>`, where
      // `keyed` gets the same separator from a path's own leading slash.
      // Handed the slugs alone, the fallback that reads an unmigrated app's
      // bytes asks for `ada/recipesversions/<sha>`, finds nothing, and the
      // pack breaks mid-stream — which is a clone that fails after the
      // commits are already minted. gitobj.ts `placed` mints with this same
      // prefix, so the door reads what the commit was written from.
      bodies(r2Objects(env.BLOBS)),
    ),
  }
}

/** The door on a space's hostname: a `Response` for a repository's address,
 * `null` for anything else, which apps.ts then answers. The realm is what git
 * prints above its prompt, so it names the platform a person would think they
 * are signing in to rather than the space's hostname. */
export let answer = (at: Arrived<Env>): Promise<Response | null> =>
  at.space == null
    ? Promise.resolve(null)
    : door({ realm: 'yaks.app', find: find(at.env, at.space) })(at.req)
