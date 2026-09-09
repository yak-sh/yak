// An app's deploy history, clonable: `git clone https://<space>.yaks.app/
// <app>/` — the address straight from the browser — or the same at
// `<app>.git`. The wire is @yaks/git's (http.ts, protocol v2, read only); this
// file is only the mount — which app a URL names, who may read it, and where
// its refs and its objects are.
//
// IT IS A ROOT DOOR (plugin.ts `routes`, git.ts), not an app's own, because a
// repository is not a page OF the app: `<app>.git` is a sibling address of
// `<app>/`, and route.ts admits no dot in a slug, so nothing an app can be
// called reaches here. Answering ahead of apps.ts is what keeps the home
// app's worker — which answers every address no app claims — from being
// handed a clone it cannot parse.
//
// THE BROWSER'S ADDRESS REDIRECTS, IT IS NOT A SECOND MOUNT. `<app>.git` stays
// the one implementation; a clone of `<app>/` is answered by a 301 on the
// advertisement alone, and git follows it and posts its fetch to the address it
// landed on (`http.followRedirects=initial`, git's default since 2.11). So the
// detector is the QUERY, never the user agent: `?service=git-upload-pack` is
// something no browser asks for, and an app that ships a static `info/refs`
// serves it to a browser exactly as before.
//
// THE REPOSITORY IS THE APP'S ACCESS, EXACTLY — asked of the same two words a
// page is (`mode`/`reads`, @yaks/member). But a clone has to be ASKED for its
// credential: git sends none unprompted, so a private app that simply said 404
// was a 404 to its own owner, whose token never left their client. So a
// private app answers `401 WWW-Authenticate: Basic`, and git comes back with a
// `yak login` grant as the PASSWORD (the username beside it is decoration).
//
// The three answers are the three questions a clone can be asking. No usable
// credential is 401 — ask again, this time with one. A credential that
// verified, held by somebody this app is not for, is 403: it is terminal,
// which is the point, since 401 would send git round to ask for the password
// they already gave correctly. A TRASHED app is 404 to everyone, credential or
// not, because it is not there to be refused (erase.ts). This is the one door
// that tells a proven caller an app exists — the pages answer 404 — and it is
// the price of a clone being able to end.
//
// THE TWO HALVES LIVE APART, and that is the whole shape of it: `ref` is the
// DIRECTORY's row, on the app, because access is decided there; the objects
// are one global graph in a store of their own, because an object is named by
// the digest of its own bytes and the same file deployed twice is one row
// (gitobj.ts). So this reads a branch from the directory and hands @yaks/git a
// reader over the other store.
import { advertise, objects, type Refs, uploadPack } from '@yaks/git'
import { mode, reads } from '@yaks/member'
import { r2Blobs } from '../../src/blobs_r2.ts'
import { type Directory, directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { prefixOf } from './files.ts'
import { bodies, graphOf, held, MAIN, refAt } from './gitobj.ts'
import { held as heldGrant, ledger, narrowed } from './grants.ts'
import { meta } from './meta.ts'
import type { Arrived } from './plugin.ts'
import { nobody, type Who, whoIs } from './session.ts'

// The two addresses smart HTTP knocks on, under a slug wearing `.git`. The
// slug may hold no dot of its own (route.ts), so the split is unambiguous.
let DOORS = /^\/([^/.]+)\.git\/(info\/refs|git-upload-pack)$/

// The advertisement asked for at the app's own address, which is where a clone
// of the browser's URL begins.
let BARE = /^\/([^/.]+)\/info\/refs$/

let SERVICE = 'git-upload-pack'

// What a clone hears when it is not getting one. Plain text, because the thing
// reading it is git and not a browser.
let refusal = (status: number, say: string, more: HeadersInit = {}) =>
  new Response(`git: ${say}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...more },
  })

let missing = () => refusal(404, 'no such repository')

// The challenge, and the whole reason a private app can be cloned at all. The
// realm is what git prints above its prompt, so it names the platform a person
// would think they are signing in to rather than the space's hostname.
let locked = () =>
  refusal(401, 'sign in to clone this repository', {
    'www-authenticate': 'Basic realm="yaks.app"',
  })

let denied = () => refusal(403, 'not your repository')

// The token out of a Basic credential. Basic is the only scheme git offers
// unprompted, and its two fields are one credential here: the password is the
// token, and the username is whatever the person typed in front of it (`x`,
// their address, nothing) because a token already says whose it is.
let password = (req: Request): string | null => {
  let said = /^Basic +(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  if (!said) return null
  let pair
  try {
    pair = atob(said[1])
  } catch {
    return null
  }
  let colon = pair.indexOf(':')
  return colon < 0 ? null : pair.slice(colon + 1) || null
}

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
  dir: Directory,
  space: Space,
): Promise<Who> => {
  let said = password(req)
  if (!said) {
    return await whoIs(req, env.SESSION_SECRET, (p) => dir.role(space, p))
  }
  let grant = env.SESSION_SECRET
    ? await heldGrant(said, env.SESSION_SECRET, ledger(env.OAUTH_KV))
    : null
  if (!grant) return nobody
  let reach = grant.space ? narrowed(dir, grant.space) : dir
  return { person: grant.person, role: await reach.role(space, grant.person) }
}

/** The one answer the browser's address gets: the same advertisement, at the
 * repository's own address. It says nothing about the app — whether it is
 * there and whether it may be read is the door below's to tell, in the words
 * it already has. */
let redirect = (at: Arrived): Response | null => {
  if (at.req.method != 'GET') return null
  let bare = BARE.exec(at.path)
  if (!bare) return null
  let url = new URL(at.req.url)
  if (url.searchParams.get('service') != SERVICE) return null
  url.pathname = `/${bare[1]}.git/info/refs`
  return Response.redirect(url, 301)
}

/** The door itself: a `Response` for a repository address on a space's
 * hostname, `null` for anything else, which apps.ts then answers. */
export let answer = async (at: Arrived): Promise<Response | null> => {
  if (at.space == null) return null
  let sent = redirect(at)
  if (sent) return sent
  let asked = DOORS.exec(at.path)
  if (!asked) return null
  let [, slug, door] = asked
  let env = at.env
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let space = await dir.space(at.space)
  if (!space) return missing()
  let app = await dir.app(space, slug)
  // A trashed app is gone as far as every address is concerned (erase.ts);
  // its history comes back with it, or not at all.
  if (!app || app.trashed) return missing()
  let who = await cloner(env, at.req, dir, space)
  // Ask, then judge: nobody proved anything is sent back to try again with a
  // credential, and somebody who did prove who they are is told no for good.
  if (!reads(mode(app.access), who.role)) {
    return who.person ? denied() : locked()
  }
  if (door == 'info/refs') return advertise(at.req)
  if (!env.BLOBS || !env.STORE) return missing()
  // One branch, and none before the first deploy — an app that has never been
  // released clones as an empty repository rather than a refusal.
  let commit = await refAt(held(meta(env)), app.eid)
  let refs: Refs = {
    list: () => Promise.resolve(commit ? [{ name: MAIN, oid: commit }] : []),
  }
  return uploadPack(
    at.req,
    refs,
    objects(
      graphOf(env.STORE),
      // The prefix a PIN key is built from, so it ends in the separator:
      // `pinned` (versions.ts) writes `<prefix>versions/<sha>`, where
      // `keyed` gets the same separator from a path's own leading slash.
      // Handed the slugs alone, the fallback that reads an unmigrated app's
      // bytes asks for `ada/recipesversions/<sha>`, finds nothing, and the
      // pack breaks mid-stream — which is a clone that fails after the
      // commits are already minted. gitobj.ts `placed` mints with this same
      // spelling, so the door reads what the commit was written from.
      bodies(r2Blobs(env.BLOBS), `${prefixOf(space, app)}/`),
    ),
  )
}
