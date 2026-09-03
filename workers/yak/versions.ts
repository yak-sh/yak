// An app's deploys, kept so one word puts a working app back (T-32886,
// V-32361: "we want to prioritize error-correction over initial correctness").
// When an agent breaks a page the person was using, their own repair is "put
// it back" — so every `app_deploy` records the version it made and
// `app_rollback` restores one, as a NEW version, so history is never
// rewritten.
//
// A version is a MANIFEST — path to the SHA-256 of that file's bytes — and
// never a copy of the bytes: the storage is the person's. The bytes are
// pinned once, content-addressed, under the app's own prefix (`versions/`),
// so a file unchanged across twenty deploys is one object, a rename carries
// them (tools.ts app_set copies the prefix) and a delete takes them
// (app_delete empties it). Everything a deploy plants is a FILE — vocab.json,
// tools.json, worker.js — so restoring the files and deploying them again is
// the whole of a rollback; tools.ts spends no second vocabulary on it.
//
// An app keeps its last KEEP versions. Pruning is the only thing that ever
// deletes a pinned blob, and it deletes only what no KEPT version names — so
// the oldest rollback an app still offers always has its bytes.
import type { Blobs } from '../../src/blobs.ts'
import type { App, Directory } from './directory.ts'
import { vouched, type Who } from './session.ts'

// A version's file set: the path the app serves it at, and the name of its
// bytes.
export type Files = Record<string, string>

export type Version = {
  eid: string
  version: number
  at: string
  files: Files
  // Cloudflare's own name for the script upload this deploy made, empty
  // where the app has no worker. Informational: a rollback re-uploads the
  // worker.js the manifest names, so putting an app back never depends on
  // Cloudflare having kept anything.
  worker: string
}

// How many an app keeps. Twenty is a week of an agent's iterating and small
// enough that the whole list is one read and one answer.
export let KEEP = 20

// What the platform keeps BESIDE an app's files, under the app's own prefix:
// the bytes a page uploaded (apps.ts `blobKey`) and the bytes a version pins.
// Both are content-addressed and neither is a file anyone wrote, so neither is
// listed, snapshotted, or restored.
let KEPT = ['blobs/', 'versions/']

let kept = (path: string) => KEPT.some((k) => path.startsWith(k))

// The app's OWN files among its keys — what a person wrote and what the app
// serves.
export let own = (paths: string[]) => paths.filter((p) => !kept(p))

// The bytes' own name: their SHA-256 in hex, the content address the fleet's
// attachments already use (src/blob.ts). apps.ts names an upload with this
// same function, so one file sent two ways is one name.
export let sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

// Where a version's bytes are pinned. Under the app, so they move and die
// with it.
let pinned = (prefix: string, sha: string) => `${prefix}versions/${sha}`

// One pass over the app's own files, naming each by its bytes — and, for a
// deploy, pinning those bytes where a later rollback can find them again.
// Reading and pinning are the same pass because the bytes are in hand either
// way; bytes already pinned are left alone, since the address IS the content.
let walk = async (blobs: Blobs, prefix: string, pin: boolean) => {
  let files: Files = {}
  for (let key of await blobs.list(prefix)) {
    let path = key.slice(prefix.length)
    if (kept(path)) continue
    let bytes = await blobs.get(key)
    let sha = await sha256(bytes)
    files[path] = sha
    if (pin && !(await blobs.has(pinned(prefix, sha)))) {
      await blobs.put(pinned(prefix, sha), bytes)
    }
  }
  return files
}

// What the app serves right now, named but not kept: a rollback reads this
// only to say what it changed, and pinning bytes no version will ever name
// would leave them behind forever.
export let manifest = (blobs: Blobs, prefix: string) =>
  walk(blobs, prefix, false)

// The version a deploy is making: the same manifest, with its bytes pinned.
export let snapshot = (blobs: Blobs, prefix: string) =>
  walk(blobs, prefix, true)

// A version's files back where the app serves them — and only its files: a
// path this version did not name goes, which is what "put it back" means for
// a file a later deploy added. The app's data, the pins and everything a page
// uploaded are untouched.
export let restore = async (blobs: Blobs, prefix: string, files: Files) => {
  for (let [path, sha] of Object.entries(files)) {
    await blobs.put(prefix + path, await blobs.get(pinned(prefix, sha)))
  }
  for (
    let path of own(
      (await blobs.list(prefix)).map((k) => k.slice(prefix.length)),
    )
  ) {
    if (!(path in files)) await blobs.delete(prefix + path)
  }
}

// What one version did to the one before it, in the words a person would use.
export let changed = (before: Files | null, after: Files) => {
  let was = before ?? {}
  let paths = (pick: (path: string) => boolean) =>
    Object.keys(after).filter(pick).sort()
  return {
    added: before ? paths((p) => !(p in was)) : [],
    changed: paths((p) => p in was && was[p] != after[p]),
    removed: before ? Object.keys(was).filter((p) => !(p in after)).sort() : [],
  }
}

// That, as one clause: "added style.css, changed index.html". A first deploy
// has nothing to compare against, so it says how big it was.
export let whatChanged = (before: Files | null, after: Files) => {
  let d = changed(before, after)
  let parts = [
    d.added.length ? `added ${d.added.join(', ')}` : '',
    d.changed.length ? `changed ${d.changed.join(', ')}` : '',
    d.removed.length ? `removed ${d.removed.join(', ')}` : '',
  ].filter(Boolean)
  if (parts.length) return parts.join(', ')
  let n = Object.keys(after).length
  return before ? 'no files changed' : `${n} ${n == 1 ? 'file' : 'files'}`
}

// Two versions with the same files are the same release: the manifest is the
// whole of what a version IS.
let same = (a: Files, b: Files) => {
  let paths = Object.keys(a)
  return paths.length == Object.keys(b).length &&
    paths.every((p) => a[p] == b[p])
}

// The version this one PUT BACK, or 0 where it put nothing back — what a
// rollback did, said in the list rather than only in the moment (C-32905 item
// 6). Read off the manifests, because restoring files is the whole of a
// rollback and the files are therefore its own record: this version's files
// are not the ones under it, and are exactly some earlier version's. `all` is
// the list newest first, `i` the one being said.
export let restored = (all: Version[], i: number) => {
  let now = all[i]
  let before = all[i + 1]
  if (!before || same(before.files, now.files)) return 0
  for (let j = i + 2; j < all.length; j++) {
    if (same(all[j].files, now.files)) return all[j].version
  }
  return 0
}

// Every version of an app, newest first.
export let versions = (dir: Directory, app: App) => dir.deploys(app)

// This deploy written down, and the versions past the last KEEP buried with
// the bytes they alone pinned. The row and the app's version counter go in
// one batch: the number an error names and the number a rollback picks are
// the same number.
export let record = async (
  dir: Directory,
  blobs: Blobs,
  prefix: string,
  who: Who,
  app: App,
  version: number,
  files: Files,
  worker: string,
) => {
  await dir.apply({
    entities: [
      { entity: { eid: app.eid }, app: { version } },
      {
        deploy: {
          app: app.eid,
          version,
          files: JSON.stringify(files),
          worker,
        },
      },
    ],
  }, vouched(who))
  let all = await versions(dir, app)
  let old = all.slice(KEEP)
  if (!old.length) return
  // A blob a kept version still names is never removed — that is what makes
  // the oldest rollback an app offers work at all.
  let live = new Set(all.slice(0, KEEP).flatMap((v) => Object.values(v.files)))
  for (let sha of new Set(old.flatMap((v) => Object.values(v.files)))) {
    if (!live.has(sha)) await blobs.delete(pinned(prefix, sha))
  }
  await dir.apply({
    entities: old.map((v) => ({ entity: { eid: v.eid }, tombstone: {} })),
  }, vouched(who))
}
