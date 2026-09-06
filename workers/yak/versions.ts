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
//
// And the same machinery a size down (T-34508): every WRITE pins what it
// replaced. A deploy is the release a person names; a write is the thing that
// actually breaks a file, and the twenty minutes between two deploys is where
// an agent overwrites the page somebody was using. So `replaced` puts the
// outgoing bytes in the same content-addressed store, notes them in that path's
// own history, and `app_files` op history and op restore are the two words that
// read it back. One store, one pin, and therefore ONE prune (`pruned`): the
// rule "delete only what nothing names any more" can only be right if the thing
// applying it can see everything that names — the kept versions AND the kept
// history — which is why both live in this file.
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
// the bytes a page uploaded (apps.ts `blobKey`), the bytes a version or a write
// pins, and what each path has held (`history/`). None is a file anyone wrote,
// so none is listed, snapshotted, restored, or carried by an install — and all
// of it dies with the app, because it is under the app's own prefix.
let KEPT = ['blobs/', 'versions/', 'history/']

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

// Where bytes are pinned. Under the app, so they move and die with it, and
// content-addressed, so a deploy and a write that name the same bytes name one
// object.
export let pinned = (prefix: string, sha: string) => `${prefix}versions/${sha}`

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
//
// It does NOT write the per-path history (`replaced`), on purpose: a rollback's
// way back is the deploy list itself — every version it could land on is
// already kept, so a rollback is undone by another — and noting each file it
// moved would be the same fact written down twice, in two grains, free to
// disagree.
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

// This deploy written down, and the versions past the last KEEP buried — then
// the prune, which is the one place a pinned blob is ever deleted. The row and
// the app's version counter go in one batch: the number an error names and the
// number a rollback picks are the same number.
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
        entity: { eid: '$deploy' },
        deploy: {
          app: app.eid,
          version,
          files: JSON.stringify(files),
          worker,
        },
      },
    ],
  }, vouched(who))
  let old = (await versions(dir, app)).slice(KEEP)
  if (old.length) {
    await dir.apply({
      entities: old.map((v) => ({ entity: { eid: v.eid }, tombstone: {} })),
    }, vouched(who))
  }
  await pruned(dir, blobs, prefix, app)
}

// ---- what a write replaced (T-34508) ---------------------------------------

/**
 * One write, as this app remembers it.
 *
 * The `sha` is the bytes the path held UNTIL this write — what a restore puts
 * back — and `at` and `by` are the write that took their place, which is the
 * same moment those bytes stopped being what the app served. So an entry reads
 * "index.html was these bytes until Ada wrote over them at 14:20", and the
 * newest entry is the state one step back from now.
 */
export type Wrote = {
  path: string
  sha: string
  size: number
  at: string
  by: string
}

/**
 * How long a replaced file's bytes are kept, and the same thirty days the trash
 * keeps a deleted app (erase.ts `GRACE`) and Cloudflare keeps a store
 * (recover.ts `WINDOW`) — three separate promises that happen to agree, which
 * is why each says its own.
 *
 * The floor under it is {@link KEEP}: an entry survives if it is inside the
 * thirty days OR among the newest KEEP, so a file rewritten twenty times in an
 * afternoon still remembers all twenty a month later, and a file written once a
 * year still remembers the write before this one.
 */
export let AGE = 30 * 24 * 60 * 60_000

// Where one path's history lives: under a prefix the platform keeps, so it is
// not one of the app's own files, and keyed BY THE PATH, so reading a file's
// history is one get rather than a walk. Per path is also what keeps two
// concurrent writes from losing each other's entry — the only race left is two
// writes to the same file, where the bytes themselves are already
// last-one-wins.
let logKey = (prefix: string, path: string) => `${prefix}history/${path}.json`

// What survives a trim: the newest KEEP always, and anything inside AGE. The
// list is newest first and its times only go one way, so this is a prefix.
let trimmed = (all: Wrote[], now: number) =>
  all.filter((w, i) => i < KEEP || now - Date.parse(w.at) <= AGE)

let entries = (bytes: Uint8Array | null): Wrote[] => {
  if (!bytes) return []
  try {
    let held = JSON.parse(new TextDecoder().decode(bytes))
    return Array.isArray(held) ? held as Wrote[] : []
  } catch {
    // A log we cannot read is a log with nothing in it. The bytes it named are
    // still pinned; what is lost is the sentence about them, and losing that
    // must never take a write down with it.
    return []
  }
}

/** What this path has held, newest first — every write that replaced it. */
export let history = async (blobs: Blobs, prefix: string, path: string) =>
  entries(await blobs.read(logKey(prefix, path)))

/**
 * The bytes at `path` right now, pinned and noted in that path's history,
 * before something else takes their place. Nothing at all when the path is
 * empty: a file that did not exist has no previous version.
 *
 * This runs at every door bytes arrive by (tools.ts `wrote`), which is why it
 * is one round trip on a miss and why a log that cannot be read is treated as
 * empty rather than thrown: the write is the thing that must not fail.
 */
export let replaced = async (
  blobs: Blobs,
  prefix: string,
  path: string,
  by: string,
  at = new Date(),
) => {
  let bytes = await blobs.read(prefix + path)
  if (!bytes) return null
  let sha = await sha256(bytes)
  if (!(await blobs.has(pinned(prefix, sha)))) {
    await blobs.put(pinned(prefix, sha), bytes)
  }
  let was: Wrote = {
    path,
    sha,
    size: bytes.byteLength,
    at: at.toISOString(),
    by,
  }
  let all = trimmed(
    [was, ...await history(blobs, prefix, path)],
    at.getTime(),
  )
  await blobs.put(
    logKey(prefix, path),
    new TextEncoder().encode(JSON.stringify(all)),
  )
  return was
}

/**
 * What the path held at a moment: the bytes the first write AFTER that moment
 * took away. Null when no write has happened since, which means the file
 * already is what it was then — the truthful answer, and not a restore that
 * changes nothing.
 *
 * A moment before the oldest entry answers that oldest entry, since that is the
 * furthest back this app still remembers; the caller says so rather than
 * pretending it is exact.
 */
/** The moment a caller asked for, or the refusal that says how to write one. */
export let when = (said: string): Date => {
  let at = new Date(said)
  if (isNaN(at.getTime())) {
    throw new Error(
      `at: ${said} is not a time — write it as 2026-09-06T14:20:00Z`,
    )
  }
  return at
}

export let held = (all: Wrote[], at: number): Wrote | null => {
  let after = all.filter((w) => Date.parse(w.at) > at)
  return after[after.length - 1] ?? null
}

/**
 * Every pinned blob nothing names any more, gone — the ONE place a pinned byte
 * is ever deleted, run on a deploy (above) and on the daily sweep (erase.ts).
 *
 * It trims each path's history as it reads it, because what a blob is still
 * named by is exactly what the trim decides: the two cannot be separate passes
 * without one of them working from a stale answer.
 *
 * A file's LIVE bytes are never at risk here. They sit at the path's own key,
 * not under `versions/`, so this loop cannot reach them — and its pinned copy,
 * if nothing else names it, is a copy of bytes the app still has.
 */
export let pruned = async (
  dir: Directory,
  blobs: Blobs,
  prefix: string,
  app: App,
  now = Date.now(),
) => {
  let named = new Set<string>()
  for (let key of await blobs.list(`${prefix}history/`)) {
    let all = entries(await blobs.read(key))
    let keep = trimmed(all, now)
    if (keep.length != all.length) {
      if (keep.length) {
        await blobs.put(
          key,
          new TextEncoder().encode(JSON.stringify(keep)),
        )
      } else await blobs.delete(key)
    }
    for (let w of keep) named.add(w.sha)
  }
  // And every version the app still offers to put back, which is what makes
  // the oldest rollback it offers work at all.
  for (let v of (await versions(dir, app)).slice(0, KEEP)) {
    for (let sha of Object.values(v.files)) named.add(sha)
  }
  let at = `${prefix}versions/`
  let gone = 0
  for (let key of await blobs.list(at)) {
    if (named.has(key.slice(at.length))) continue
    await blobs.delete(key)
    gone++
  }
  return gone
}
