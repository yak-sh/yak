// An app's deploys, kept so one word puts a working app back (T-32886,
// V-32361: "we want to prioritize error-correction over initial correctness").
// When an agent breaks a page the person was using, their own repair is "put
// it back" — so every `app_deploy` records the version it made and
// `app_rollback` restores one, as a new version, so history is never
// rewritten.
//
// A version is a manifest — path to the SHA-256 of that file's bytes — and
// never a copy of the bytes: the address is the person's. The bytes are pinned
// once, content-addressed, under one key space for the whole bucket (`sha/`,
// D-34942), so a file unchanged across twenty deploys is one object and the
// same file in two apps is one object as well. Everything a deploy plants is a
// file — vocab.json, worker.js, the seeds — so restoring the files and
// deploying them again is the whole of a rollback; tools.ts spends no second
// vocabulary on it.
//
// The key used to carry the app (`<prefix>versions/<sha>`), which is what made
// the storage the person's rather than the address. Dedup across apps is worth
// more than that reading, and nothing is weaker for it: a sha is unguessable,
// and no door serves bytes by bare sha — each resolves a referrer the caller
// may read first. `moved` carries the old keys across and `pins` reads them
// until it has, so nothing 404s mid-move.
//
// An app keeps every version it ever deployed: a manifest is a few hundred
// bytes, and git derives an app's commit chain from them (D-34942), so burying
// the twenty-first would cut the history that promises. What KEEP bounds is
// only how many a list shows at once.
//
// Bytes are kept by liveness instead (T-34952): a blob lives while anything
// names it — a deploy manifest, an entry in a path's history, a plugin's pins
// — and the sweep recomputes that set from the referrers every time rather
// than counting references, so a batch that died halfway is healed by the next
// run instead of drifting forever.
//
// And the same machinery a size down (T-34508): every draft edit pins what it
// replaced. A deploy is the release a person names; an edit waits privately
// until then. `replaced` puts the outgoing draft bytes in the same
// content-addressed store, notes them in that path's
// own history, and `app_files` op history and op restore are the two words that
// read it back. One store, one pin, and therefore one prune (`pruned`): the
// rule "delete only what nothing names any more" can only be right if the thing
// applying it can see everything that names — the kept versions and the kept
// history — which is why both live in this file. What a plugin names is the
// third (plugin.ts `pins`): the sweep asks the list rather than guessing, since
// a domain holding its own pinned bytes is the one thing this file cannot see.
// With one key space the sweep is one pass for the whole bucket rather than one
// per app: an object another app still names is not the first app's to free.
import type { Blobs as Pins, Objects } from '@yaks/blob'
import { mint, token } from '@yaks/graph'
import type { App, Directory, Space } from './directory.ts'
import type { Reload } from '@yaks/platform'
import { pinsOf } from './plugin.ts'
import { PLUGINS } from './plugins.ts'
import { vouched, type Who } from './session.ts'
import { refuse } from './tool.ts'
import { caught } from './sentry.ts'
import { indexOf, META } from './release_index.ts'

// A version's file set: the path the app serves it at, and the name of its
// bytes.
export type Files = Record<string, string>

// One app the sweep must read the referrers of: the row, and where its keys
// live in the bucket (erase.ts `under`). The key space it pins into is the
// bucket's, so the sweep takes a list of these rather than one of them.
export type Pinner = { prefix: string; app: App }

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
  script?: string
  source?: string | null
  reload?: Reload | null
}

// How many versions a list shows at once, and the floor under a path's history
// (`trimmed`). Twenty is a week of an agent's iterating and small enough that
// the page is one read and one answer.
export let KEEP = 20

// How long bytes nothing names are left alone anyway. A deploy pins its files
// before it writes the row that names them, so an object minutes old may
// belong to a deploy still in flight; a day is far longer than that gap and
// costs one more day of bytes nobody wants.
export let GRACE = 24 * 60 * 60_000

/** Where a compiled page script is kept, by its source's path (esbuild.ts):
 * served at the source's address (files.ts), and made again by every deploy. */
export let BUILT = 'esbuild/'

// Edits belong to the next version, while the app's source names the version
// visitors read. A failed release keeps its draft for correction and retry.
export let draftOf = (space: { slug: string }, app: App) =>
  `${space.slug}/.drafts/${app.eid}/${app.source ? 'delta-' : ''}v${
    (app.version ?? 0) + 1
  }-${crypto.randomUUID()}`

let delta = (draft: string) => draft.split('/').pop()?.startsWith('delta-v')

// A draft keeps only what differs from its immutable source. The old vN
// drafts are complete copies and remain readable until their next deploy.
// Deletions are keys outside the app's file set, so a missing draft file can
// still mean "read the source" without reviving a deleted path.
export let draftFiles = (
  blobs: Objects,
  draft: string | null | undefined,
  source: string,
): Objects => {
  if (!draft || !delta(draft)) return blobs
  let base = `${source}/`
  let at = `${draft}/`
  let gone = `${at}.deleted/`
  let path = (key: string) => key.slice(at.length)
  let original = (key: string) => base + path(key)
  let deleted = (key: string) => gone + path(key)
  let inDraft = (key: string) => key.startsWith(at) && !key.startsWith(gone)
  let known: { own: Set<string>; gone: Set<string> } | undefined
  let read = async (key: string) => {
    if (!inDraft(key)) return blobs.read(key)
    if (known) {
      if (known.own.has(path(key))) return blobs.read(key)
      return known.gone.has(path(key)) ? null : blobs.read(original(key))
    }
    let bytes = await blobs.read(key)
    if (bytes || await blobs.has(deleted(key))) return bytes
    return blobs.read(original(key))
  }
  return {
    read,
    load: async (key) => {
      if (!inDraft(key)) return blobs.load(key)
      if (known) {
        if (known.own.has(path(key))) return blobs.load(key)
        return known.gone.has(path(key)) ? null : blobs.load(original(key))
      }
      let own = await blobs.load(key)
      if (own || await blobs.has(deleted(key))) return own
      return blobs.load(original(key))
    },
    open: async (key) => {
      if (!inDraft(key)) return blobs.open(key)
      if (known) {
        if (known.own.has(path(key))) return blobs.open(key)
        return known.gone.has(path(key)) ? null : blobs.open(original(key))
      }
      let own = await blobs.open(key)
      if (own || await blobs.has(deleted(key))) return own
      return blobs.open(original(key))
    },
    get: async (key) => {
      let bytes = await read(key)
      if (!bytes) throw new Error(`no object at ${key}`)
      return bytes
    },
    has: async (key) => {
      if (!inDraft(key)) return blobs.has(key)
      if (known) {
        if (known.own.has(path(key))) return true
        return !known.gone.has(path(key)) && await blobs.has(original(key))
      }
      return await blobs.has(key) ||
        !await blobs.has(deleted(key)) && await blobs.has(original(key))
    },
    put: async (key, bytes) => {
      await blobs.put(key, bytes)
      if (inDraft(key)) {
        await blobs.delete(deleted(key))
        known?.own.add(path(key))
        known?.gone.delete(path(key))
      }
    },
    delete: async (key) => {
      if (!inDraft(key)) return blobs.delete(key)
      await blobs.put(deleted(key), new Uint8Array())
      await blobs.delete(key)
      known?.own.delete(path(key))
      known?.gone.add(path(key))
    },
    list: async (prefix) => {
      if (!prefix.startsWith(at)) return blobs.list(prefix)
      let [old, fresh] = await Promise.all([
        blobs.list(base + path(prefix)),
        blobs.list(at),
      ])
      let paths = new Set(
        old.map((key) => key.slice(base.length)).filter(
          (name) =>
            !['blobs/', 'versions/', 'history/'].some((kept) =>
              name.startsWith(kept)
            ),
        ),
      )
      let own = new Set<string>()
      let gone = new Set<string>()
      for (let key of fresh) {
        let name = path(key)
        if (name.startsWith('.deleted/')) gone.add(name.slice(9))
        else own.add(name)
      }
      for (let name of gone) paths.delete(name)
      for (let name of own) paths.add(name)
      known = { own, gone }
      return [...paths].filter((name) => name.startsWith(path(prefix))).map((
        name,
      ) => at + name).sort()
    },
    uploaded: (prefix) => blobs.uploaded(prefix),
  }
}

// A released version already names every unchanged path. Only the draft's
// physical keys need hashing; the source manifest supplies the rest.
export let draftManifest = async (
  blobs: Objects,
  draft: string,
  base: Files,
): Promise<Files> => {
  if (!delta(draft)) return manifest(blobs, `${draft}/`)
  let prefix = `${draft}/`
  let paths = (await blobs.list(prefix)).map((key) => key.slice(prefix.length))
  let files = { ...base }
  for (let path of paths) {
    if (path.startsWith('.deleted/')) delete files[path.slice(9)]
  }
  await Promise.all(
    paths.filter((path) => !path.startsWith('.deleted/') && !kept(path)).map(
      async (path) => {
        files[path] = await sha256(await blobs.get(prefix + path))
      },
    ),
  )
  return files
}

export let releaseOf = (space: { slug: string }, app: App) =>
  `${space.slug}/.releases/${app.eid}/${crypto.randomUUID()}`

let latest = async (dir: Directory, space: Space, app: App) =>
  (await dir.apps(space)).find((row) => row.eid == app.eid) ?? app

/** A release fence holds new edits until its source switch or refusal. */
export let waiting = async (
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
) => {
  let until = Date.now() + 60_000
  for (;;) {
    let row = await latest(dir, space, app)
    if (!row.fence) return row
    let started = Number(row.fence.split(':')[0])
    if (Date.now() - started > 5 * 60_000) {
      try {
        await dir.stamp({
          entities: [{
            entity: { eid: app.eid },
            app: { fence: null },
            $was: { app: { fence: token(row.fence) } },
          }],
        }, vouched(who))
      } catch { /* another request moved the fence */ }
    }
    if (Date.now() > until) {
      throw refuse('unavailable', `release in progress for ${app.slug}; retry`)
    }
    await new Promise((done) => setTimeout(done, 25))
  }
}

/** Hold new edits while one release copies its selected draft. */
export let fenced = async (
  dir: Directory,
  app: App,
  draft: string | null,
  who: Who,
) => {
  let fence = `${Date.now()}:${crypto.randomUUID()}`
  await dir.stamp({
    entities: [{
      entity: { eid: app.eid },
      app: { fence },
      $was: {
        app: {
          fence: token(app.fence),
          draft: token(draft),
          source: token(app.source),
          version: token(app.version),
        },
      },
    }],
  }, vouched(who))
  return fence
}

/** Release a fence left by a refused deploy; a committed release cleared it. */
export let unfenced = async (
  dir: Directory,
  app: App,
  fence: string,
  who: Who,
) => {
  try {
    await dir.stamp({
      entities: [{
        entity: { eid: app.eid },
        app: { fence: null },
        $was: { app: { fence: token(fence) } },
      }],
    }, vouched(who))
  } catch { /* a committed release or a newer fence already moved it */ }
}

/** What the editor sees: this version's draft once one has been started. */
export let working = (
  app: App,
  source: string,
) => app.draft ?? source

/** Start this version's draft over the immutable source. */
export let editing = async (
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
) => {
  if (app.draft) return app.draft
  let draft = draftOf(space, app)
  // The directory chooses one before either contender writes its first file.
  try {
    await dir.stamp({
      entities: [{
        entity: { eid: app.eid },
        app: { draft },
        $was: {
          app: {
            draft: token(app.draft),
            source: token(app.source),
            version: token(app.version),
          },
        },
      }],
    }, vouched(who))
  } catch (error) {
    let current = (await dir.apps(space)).find((a) => a.eid == app.eid)
    if (
      current && current.source == app.source &&
      current.version == app.version &&
      current.draft
    ) return current.draft
    throw error
  }
  return draft
}

/** An edit crossing a release fence is replayed into the next draft. */
export let modifying = async <T>(
  blobs: Objects,
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
  source: (app: App) => string,
  act: (draft: string, app: App, attempt: number, files: Objects) => Promise<T>,
): Promise<T> => {
  let row = app
  for (let n = 0; n < 3; n++) {
    row = await waiting(dir, space, row, who)
    let draft = await editing(dir, space, row, who)
    let result = await act(
      draft,
      row,
      n,
      draftFiles(blobs, draft, source(row)),
    )
    let after = await waiting(dir, space, row, who)
    if (
      after.version == row.version && after.source == row.source &&
      after.draft == draft
    ) return result
    row = after
  }
  throw refuse('conflict', `app ${app.slug} changed during edit; retry`)
}

// What the platform keeps beside an app's files, under the app's own prefix:
// the bytes a page uploaded (apps.ts `blobKey`), what each path has held
// (`history/`), the page scripts a deploy compiled (`esbuild/`), and — until
// `moved` has emptied it — the pins that used to live per app. None is a file
// anyone wrote, so none is listed, snapshotted, restored, or carried by an
// install.
let KEPT = ['blobs/', 'versions/', 'history/', BUILT]

let kept = (path: string) => KEPT.some((k) => path.startsWith(k))

// The app's own files among its keys — what a person wrote and what the app
// serves.
export let own = (paths: string[]) => paths.filter((p) => !kept(p))

// The bytes' own name: their SHA-256 in hex, the content address the fleet's
// attachments already use (src/blob.ts). apps.ts names an upload with this
// same function, so one file sent two ways is one name.
export let sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

// The one key space pinned bytes live in: the sha alone, so two apps holding
// the same file hold one object (D-34942).
export let SHA = 'sha/'

/** Where bytes with this address are pinned, for the whole bucket. */
export let addressed = (sha: string) => SHA + sha

// Where bytes were pinned, per app. Read-only from here on: `pins` falls back
// to it so an app not yet carried across still answers, and `moved` is what
// empties it.
export let pinned = (prefix: string, sha: string) => `${prefix}versions/${sha}`

/**
 * The pin store: @yaks/blob's three addressed verbs (packages/blob/store.ts)
 * over the same bucket the app's own files live in, so a caller pinning bytes
 * names them and never a key.
 *
 * It is built from the key store rather than `objectBlobs` on the binding
 * because the sweep needs `list`, `uploaded` and `delete` over these same
 * objects and the addressed interface has none of them — one adapter over one
 * bucket seam beats two clients of one binding disagreeing about what is in it.
 *
 * `prefix` is the app's own, and is read for the old key only: `put` writes the
 * global key alone, and `has`/`get` try it first and fall back, which is what
 * keeps a rollback working for an app the migration has not reached. A hit on
 * the global key costs exactly what the old key cost, so nothing pays for the
 * fallback but a miss.
 */
export let pins = (blobs: Objects, prefix: string): Pins => ({
  has: async (sha) =>
    await blobs.has(addressed(sha)) || await blobs.has(pinned(prefix, sha)),
  get: async (sha) =>
    await blobs.read(addressed(sha)) ?? await blobs.read(pinned(prefix, sha)) ??
      undefined,
  // The address is the content, so bytes already there are the bytes being
  // written: one head, and a put only where there is nothing.
  put: async (sha, bytes) => {
    if (!(await blobs.has(addressed(sha)))) {
      await blobs.put(addressed(sha), bytes)
    }
  },
})

// The pinned bytes a caller cannot do without, or a refusal naming what is
// gone. `Pins.get` answers `undefined` for a miss because most readers have
// something else to do about one; a rollback does not.
let must = async (store: Pins, sha: string) => {
  let bytes = await store.get(sha)
  if (!bytes) throw refuse('missing', `no blob for ${sha}`)
  return bytes
}

// One pass over the app's own files, naming each by its bytes — and, for a
// deploy, pinning those bytes where a later rollback can find them again.
// Reading and pinning are the same pass because the bytes are in hand either
// way; bytes already pinned are left alone, since the address is the content.
//
// The files are walked at once: each is its own chain of round trips to the
// bucket, and one file's chain has nothing to wait on in another's, so a
// deploy's snapshot costs one file's time rather than every file's added up
// (T-34986: pinning three files took three times one).
let walk = async (blobs: Objects, prefix: string, pin: boolean) => {
  let store = pins(blobs, prefix)
  let files: Files = {}
  let paths = (await blobs.list(prefix))
    .map((key) => key.slice(prefix.length))
    .filter((path) => !kept(path))
  await Promise.all(paths.map(async (path) => {
    let bytes = await blobs.get(prefix + path)
    let sha = await sha256(bytes)
    files[path] = sha
    if (pin) await store.put(sha, bytes)
  }))
  return files
}

// What the app serves right now, named but not kept: a rollback reads this
// only to say what it changed, and pinning bytes no version will ever name
// would leave them behind forever.
export let manifest = (blobs: Objects, prefix: string) =>
  walk(blobs, prefix, false)

// The version a deploy is making: the same manifest, with its bytes pinned.
export let snapshot = (blobs: Objects, prefix: string) =>
  walk(blobs, prefix, true)

// A version's files back where the app serves them — and only its files: a
// path this version did not name goes, which is what "put it back" means for
// a file a later deploy added. The app's data, the pins and everything a page
// uploaded are untouched.
//
// It does not write the per-path history (`replaced`), on purpose: a rollback's
// way back is the deploy list itself — every version it could land on is
// already kept, so a rollback is undone by another — and noting each file it
// moved would be the same fact written down twice, in two grains, free to
// disagree.
export let restore = async (
  blobs: Objects,
  prefix: string,
  files: Files,
  archive = prefix,
) => {
  let store = pins(blobs, archive)
  await Promise.all(
    Object.entries(files).map(async ([path, sha]) =>
      await blobs.put(prefix + path, await must(store, sha))
    ),
  )
  let paths = own(
    (await blobs.list(prefix)).map((k) => k.slice(prefix.length)),
  )
  await Promise.all(
    paths.filter((path) => !(path in files)).map((path) =>
      blobs.delete(prefix + path)
    ),
  )
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
export let same = (a: Files, b: Files) => {
  let paths = Object.keys(a)
  return paths.length == Object.keys(b).length &&
    paths.every((p) => a[p] == b[p])
}

// The version this one PUT back, or 0 where it put nothing back — what a
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

// This deploy written down, and nothing else: no version is ever buried, and
// the bytes are the daily sweep's to reckon about (`pruned`), not a deploy's —
// a deploy that pruned its own pins would be deciding about bytes while it is
// itself the reason the answer is about to change. The row and the app's
// version counter go in one batch: the number an error names and the number a
// rollback picks are the same number. A home's borrowed declaration pointer
// moves in that same batch, so a refused release selects none of it.
//
// The row is minted at an eid chosen here, never an alias, so the batch says
// the same thing however often it arrives: a store restarted after it
// committed and before it answered is asked again (door.ts `storeOf`), and
// the second arrival finds its own row rather than a second one at that
// version (T-40726). Another deploy racing for the same number mints another
// eid, and the unique version refuses it.
export let record = async (
  dir: Directory,
  who: Who,
  app: App,
  version: number,
  files: Files,
  worker: string,
  homes: { app: App; release: string }[] = [],
  sourceWas = app.source,
  draftWas = app.draft,
  fenceWas = app.fence,
  seeded = false,
  reload?: Reload,
) => {
  let prior = sourceWas
    ? (await dir.deploys(app)).find((v) =>
      v.version == app.version && !v.source
    )
    : null
  return await dir.stamp({
    entities: [
      {
        entity: { eid: app.eid },
        app: {
          version,
          declaration: String(version),
          source: app.source,
          draft: null,
          fence: null,
          script: app.script,
        },
        ...seeded ? { seeded: { at: new Date().toISOString(), version } } : {},
        $was: {
          app: {
            version: token(app.version),
            declaration: token(app.declaration),
            source: token(sourceWas),
            draft: token(draftWas),
            fence: token(fenceWas),
          },
        },
      },
      ...homes.map(({ app, release }) => ({
        entity: { eid: app.eid },
        app: { declaration: release },
        $was: { app: { declaration: token(app.declaration) } },
      })),
      ...(prior
        ? [{
          entity: { eid: prior.eid },
          deploy: { source: sourceWas },
          $was: { deploy: { source: token(prior.source) } },
        }]
        : []),
      {
        entity: { eid: mint() },
        deploy: {
          app: app.eid,
          version,
          files: JSON.stringify(files),
          worker,
          script: app.script ?? '',
          source: app.source,
          // Optional is derived; the stored mark can only raise severity.
          ...reload == 'required' ? { reload } : {},
        },
      },
    ],
  }, vouched(who))
}

// ---- what a write replaced (T-34508) ---------------------------------------

/**
 * One write, as this app remembers it.
 *
 * The `sha` is the bytes the path held until this write — what a restore puts
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
 * thirty days or among the newest KEEP, so a file rewritten twenty times in an
 * afternoon still remembers all twenty a month later, and a file written once a
 * year still remembers the write before this one.
 */
export let AGE = 30 * 24 * 60 * 60_000

// Where one path's history lives: under a prefix the platform keeps, so it is
// not one of the app's own files, and keyed by the path, so reading a file's
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
  } catch (e) {
    // A log we cannot read is a log with nothing in it. The bytes it named are
    // still pinned; what is lost is the sentence about them, and losing that
    // must never take a write down with it — but it is ours, so Sentry hears.
    caught(e, { request: 'version log' })
    return []
  }
}

/** What this path has held, newest first — every write that replaced it. */
export let history = async (blobs: Objects, prefix: string, path: string) =>
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
  blobs: Objects,
  prefix: string,
  path: string,
  by: string,
  at = new Date(),
  archive = prefix,
) => {
  let bytes = await blobs.read(prefix + path)
  if (!bytes) return null
  let sha = await sha256(bytes)
  let was: Wrote = {
    path,
    sha,
    size: bytes.byteLength,
    at: at.toISOString(),
    by,
  }
  // Pinning the bytes and extending the log are two chains with nothing to
  // wait on in each other, so they go out together: three round trips to the
  // bucket where there were five (T-34986).
  await Promise.all([
    pins(blobs, archive).put(sha, bytes),
    (async () => {
      let all = trimmed(
        [was, ...await history(blobs, archive, path)],
        at.getTime(),
      )
      await blobs.put(
        logKey(archive, path),
        new TextEncoder().encode(JSON.stringify(all)),
      )
    })(),
  ])
  return was
}

/**
 * What the path held at a moment: the bytes the first write after that moment
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
    throw refuse(
      'arguments',
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
 * Every pinned blob nothing names any more, gone — the one place a pinned byte
 * is ever deleted, run on the daily sweep (erase.ts `collected`) and nowhere
 * else.
 *
 * Mark and sweep, not reference counts (D-34942). The live set is recomputed
 * from the referrers on every run: a count kept beside each write and delete
 * drifts the first time a batch dies halfway and nothing can tell that it has,
 * while a sweep that reads the referrers heals whatever the last one got
 * wrong. Three things name a blob, and all three are asked here — every deploy
 * manifest, every entry in a path's history, and every sha a plugin still
 * points at (plugin.ts `pins`), which is the one a custom domain could
 * hold and neither of the others could say. A plugin that throws takes the
 * sweep with it: not knowing what is named is never a reason to delete.
 *
 * The GRACE is the other half of "only what nothing names". A deploy pins its
 * bytes and then writes the row that names them, so an object put moments ago
 * may be a manifest still in flight; anything younger than a day is left
 * alone whatever the mark says.
 *
 * It trims each path's history as it reads it, because what a blob is still
 * named by is exactly what the trim decides: the two cannot be separate passes
 * without one of them working from a stale answer.
 *
 * A file's live bytes are never at risk here. They sit at the path's own key,
 * not under `sha/`, so this loop cannot reach them — and its pinned copy, if
 * nothing else names it, is a copy of bytes the app still has.
 *
 * The key space is the bucket's now (T-34953), so the mark set has to be too:
 * an object one app stopped naming may be the very file another app serves, and
 * an app cannot decide alone about a key it does not own. So the caller hands
 * every app still standing — erase.ts `collected` walks the directory for
 * them — and the sweep marks from all of them before it deletes anything.
 * Missing one app from that list is missing its referrers, which is why a
 * trashed app inside its thirty days and the platform's own space are in it:
 * what frees an app's bytes is its erasure, not its trash mark.
 *
 * The fourth referrer D-34942 names — an app's `blob` attachment rows — is
 * still not asked, and still cannot matter: an upload's bytes live under the
 * app's own `blobs/` prefix, which this sweep does not list. The move that
 * carries those into `sha/` is the one that must add it.
 *
 * `plugins` is the list it asks, which a test hands its own.
 */
export let pruned = async (
  dir: Directory,
  blobs: Objects,
  apps: Pinner[],
  now = Date.now(),
  plugins = PLUGINS,
) => {
  let named = new Set<string>()
  let gone = 0
  for (let { prefix, app } of apps) {
    let space = `${prefix.split('/')[0]}/`
    let stage = `${space}.releases/${app.eid}/`
    let releases = await versions(dir, app)
    let sources = new Set(
      [app.source, ...releases.map((v) => v.source)]
        .filter((source): source is string => !!source)
        .map((source) => space + source.slice(source.indexOf('/') + 1)),
    )
    let namedFiles = new Set<string>()
    let legacy: string[] = []
    for (let source of sources) {
      namedFiles.add(source + META)
      let index = await indexOf(blobs, `${source}/`)
      if (!index) {
        legacy.push(`${source}/`)
        continue
      }
      for (let file of Object.values(index)) {
        namedFiles.add(file.key.startsWith(SHA) ? file.key : space + file.key)
        if (file.sha) named.add(file.sha)
      }
    }
    for (let [key, landed] of Object.entries(await blobs.uploaded(stage))) {
      if (namedFiles.has(key)) continue
      if (legacy.some((source) => key.startsWith(source))) continue
      if (now - landed < GRACE) continue
      await blobs.delete(key)
    }
    let drafts = `${prefix.split('/')[0]}/.drafts/${app.eid}/`
    let active = app.draft
    for (let [key, landed] of Object.entries(await blobs.uploaded(drafts))) {
      if (active && key.startsWith(`${active}/`)) continue
      if (now - landed < GRACE) continue
      await blobs.delete(key)
    }
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
    // And every version the app can be put back to — all of them, since none is
    // ever buried: the oldest rollback it offers has to have its bytes.
    for (let v of releases) {
      for (let sha of Object.values(v.files)) named.add(sha)
    }
    for (let sha of await pinsOf(plugins, { dir, blobs, prefix, app, now })) {
      named.add(sha)
    }
  }
  for (let [key, landed] of Object.entries(await blobs.uploaded(SHA))) {
    if (named.has(key.slice(SHA.length))) continue
    if (now - landed < GRACE) continue
    await blobs.delete(key)
    gone++
  }
  return gone
}

/**
 * The old per-app pins carried into the one key space, and the old keys let go
 * (D-34942 §Migration). It rides the same daily wake the sweep does (erase.ts
 * `collected`) and runs before it, so nothing is ever marked from a key space
 * the sweep no longer reads.
 *
 * Idempotent and resumable, because each object is its own step: bytes already
 * at the global key mean the copy is done and only the old key is left to drop,
 * and an object still under `versions/` means the pass that should have carried
 * it did not finish. So a run that dies halfway leaves the rest for tomorrow,
 * and a run over an app already carried costs one listing and nothing else.
 *
 * The bytes are re-addressed before they are trusted. An old key was written by
 * `sha256` of its own bytes and should agree, but this is the one moment those
 * bytes become an object other apps will read, so a key that lies about its
 * content is left exactly where it is rather than published under a name it
 * does not have.
 *
 * `dry` counts what a run would carry and writes nothing.
 */
export let moved = async (blobs: Objects, prefix: string, dry = false) => {
  let at = `${prefix}versions/`
  let carried = 0
  for (let key of await blobs.list(at)) {
    let sha = key.slice(at.length)
    if (dry) {
      carried++
      continue
    }
    if (!(await blobs.has(addressed(sha)))) {
      let bytes = await blobs.get(key)
      if (await sha256(bytes) != sha) continue
      await blobs.put(addressed(sha), bytes)
      // Proven there before the only copy of it goes.
      if (!(await blobs.has(addressed(sha)))) continue
    }
    await blobs.delete(key)
    carried++
  }
  return carried
}

/**
 * One path of an app's files renamed where it is stored: the bytes, the path's
 * history, and every deploy manifest that names it, so a rollback puts the file
 * back under the new name too (T-37888). It rides the daily sweep (erase.ts
 * `collected`) the way `moved` does, and for the same reasons it is idempotent
 * and resumable: each of the three is its own step, and a run over an app with
 * nothing under `from` costs two reads and the manifest list.
 *
 * Where both paths hold bytes the newer name wins, which is what a reader that
 * tried `to` first already served, and the old bytes stay in `to`'s history so
 * nothing is lost. Answers whether anything moved.
 */
export let renamed = async (
  blobs: Objects,
  dir: Directory,
  { prefix, app }: Pinner,
  from: string,
  to: string,
) => {
  let bytes = await blobs.read(prefix + from)
  let old = await history(blobs, prefix, from)
  let moves = !!bytes || old.length > 0
  if (bytes && await blobs.has(prefix + to)) {
    old = [...await pinnedAs(blobs, prefix, from, bytes), ...old]
  } else if (bytes) await blobs.put(prefix + to, bytes)
  if (old.length) {
    let all = [
      ...old.map((w) => ({ ...w, path: to })),
      ...await history(blobs, prefix, to),
    ].sort((a, b) => b.at.localeCompare(a.at))
    await blobs.put(
      logKey(prefix, to),
      new TextEncoder().encode(JSON.stringify(all)),
    )
    await blobs.delete(logKey(prefix, from))
  }
  if (bytes) await blobs.delete(prefix + from)
  let entities = (await versions(dir, app))
    .filter((v) => from in v.files)
    .map((v) => {
      let { [from]: sha, ...files } = v.files
      return {
        entity: { eid: v.eid },
        deploy: { files: JSON.stringify({ [to]: sha, ...files }) },
      }
    })
  if (entities.length) await dir.apply({ entities })
  return moves || entities.length > 0
}

// The bytes about to be dropped from `from`, pinned and said as an entry, so
// the newer file winning never loses the older one.
let pinnedAs = async (
  blobs: Objects,
  prefix: string,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Wrote[]> => {
  let sha = await sha256(bytes)
  await pins(blobs, prefix).put(sha, bytes)
  return [{
    path,
    sha,
    size: bytes.byteLength,
    at: new Date().toISOString(),
    by: '',
  }]
}
