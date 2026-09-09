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
// THE REPOSITORY IS THE APP'S ACCESS, EXACTLY. A private app answers a clone
// the way it answers a page: nothing here, to anyone who is not a member. Not
// a 403 — whether an app exists at all is its owner's to tell, and a clone
// must not be the one door that says so.
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
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound } from './env.ts'
import { prefixOf } from './files.ts'
import { bodies, graphOf, held, MAIN, refAt } from './gitobj.ts'
import { meta } from './meta.ts'
import type { Arrived } from './plugin.ts'
import { whoIs } from './session.ts'

// The two addresses smart HTTP knocks on, under a slug wearing `.git`. The
// slug may hold no dot of its own (route.ts), so the split is unambiguous.
let DOORS = /^\/([^/.]+)\.git\/(info\/refs|git-upload-pack)$/

// The advertisement asked for at the app's own address, which is where a clone
// of the browser's URL begins.
let BARE = /^\/([^/.]+)\/info\/refs$/

let SERVICE = 'git-upload-pack'

// What a clone hears about an app that is not there, or is not theirs. Plain
// text, because the thing reading it is git and not a browser.
let missing = () =>
  new Response('git: no such repository\n', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })

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
  let who = await whoIs(at.req, env.SESSION_SECRET, (p) => dir.role(space, p))
  if (!reads(mode(app.access), who.role)) return missing()
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
      bodies(r2Blobs(env.BLOBS), prefixOf(space, app)),
    ),
  )
}
