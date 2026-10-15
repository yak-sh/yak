// An app's deploys, kept so one word puts a working app back (T-32886,
// V-32361: "we want to prioritize error-correction over initial correctness").
// When an agent breaks a page the person was using, their own repair is "put
// it back" — so every `app_deploy` records the version it made and
// `app_rollback` selects one, and each live pointer move is recorded.
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
// names it, a deploy or a write a path's history keeps, and the sweep
// (written.ts `pruned`) recomputes that set from the referrers every time.
// The edits between deploys, and each path's history, are written.ts's.
import type { Blobs as Pins, Objects } from '@yaks/blob'
import { mint } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import type { App, Directory, Space } from './directory.ts'
import type { Reload } from '@yaks/platform'
import { vouched, type Who } from './session.ts'
import { refuse } from './tool.ts'

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
  // where the app has no worker. The script and source select this release.
  worker: string
  script?: string
  source?: string | null
  reload?: Reload | null
}

// How many versions a list shows at once, and the floor under a path's history
// (written.ts `kept`). Twenty is a week of an agent's iterating and small
// enough that the page is one read and one answer.
export let KEEP = 20

// How long bytes nothing names are left alone anyway. A write or a deploy puts
// its bytes before it writes the row that names them, so an object minutes old
// may belong to one still in flight; a day is far longer than that gap and
// costs one more day of bytes nobody wants.
export let GRACE = 24 * 60 * 60_000

// How many bucket calls a pass over many keys keeps in flight. One request
// holds six open at a time and queues the rest, so six is the most that helps.
// One at a time, the daily sweep's reads ran end to end for minutes, long
// enough for a deploy to cut it off (T-123781).
export let LANES = 6

/** Where a compiled page script is kept, by its source's path (esbuild.ts):
 * served at the source's address (files.ts), and made again by every deploy. */
export let BUILT = 'esbuild/'

export let releaseOf = (space: { slug: string }, app: App) =>
  `${space.slug}/.releases/${app.eid}/${crypto.randomUUID()}`

let latest = async (dir: Directory, space: Space, app: App) => {
  // Reuse the addressed app's request-local read until a directory write
  // invalidates it. A rename or reused slug still resolves by identity.
  let current = await dir.app(space, app.slug)
  return current?.eid == app.eid
    ? current
    : (await dir.apps(space)).find((row) => row.eid == app.eid) ?? app
}

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

// What the platform keeps beside an app's files, under the app's own prefix:
// the bytes a page uploaded (apps.ts `blobKey`) and the page scripts a deploy
// compiled (`esbuild/`). Neither is a file anyone wrote, so neither is listed
// or carried by an install.
let KEPT = ['blobs/', BUILT]

let kept = (path: string) => KEPT.some((k) => path.startsWith(k))

// The app's own files among its keys — what a person wrote and what the app
// serves.
export let own = (paths: string[]) => paths.filter((p) => !kept(p))

// The bytes' own name: their SHA-256 in hex, the content address the fleet's
// attachments already use (src/blob.ts). apps.ts names an upload with this
// same function, so one file sent two ways is one name.
export let sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).toHex()

// The one key space pinned bytes live in: the sha alone, so two apps holding
// the same file hold one object (D-34942).
export let SHA = 'sha/'

/** Where bytes with this address are pinned, for the whole bucket. */
export let addressed = (sha: string) => SHA + sha

/**
 * The pin store: @yaks/blob's three addressed verbs (packages/blob/store.ts)
 * over the same bucket the app's own files live in, so a caller pinning bytes
 * names them and never a key.
 *
 * It is built from the key store rather than `objectBlobs` on the binding
 * because the sweep needs `list`, `uploaded` and `delete` over these same
 * objects and the addressed interface has none of them — one adapter over one
 * bucket seam beats two clients of one binding disagreeing about what is in it.
 */
export let pins = (blobs: Objects): Pins => ({
  has: (sha) => blobs.has(addressed(sha)),
  get: async (sha) => await blobs.read(addressed(sha)) ?? undefined,
  // The address is the content, so bytes already there are the bytes being
  // written: one head, and a put only where there is nothing.
  put: async (sha, bytes) => {
    if (!(await blobs.has(addressed(sha)))) {
      await blobs.put(addressed(sha), bytes)
    }
  },
})

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

// Every version of an app, newest first.
export let versions = (dir: Directory, app: App) => dir.deploys(app)

type Move = {
  switched?: {
    from?: string | null
    to: string
    source?: string | null
    at?: string | null
  }
}

/** The version `live` replaced when it went out: the `from` of its own
 * deploy's pointer move, the earliest move to it from its source. A deploy
 * made after a rollback goes out over an older version, so the next number
 * down can be the very version a person already left (`record` writes the
 * moves). Undefined when no move names `live`, or it replaced nothing. */
export let deployedOver = (
  all: Version[],
  moves: Move[],
  live: Version,
): Version | undefined => {
  let own = moves
    .filter((m) =>
      m.switched?.to == live.eid && m.switched.source == live.source
    )
    .sort((a, b) =>
      String(a.switched?.at).localeCompare(String(b.switched?.at))
    )[0]
  return all.find((v) => v.eid == own?.switched?.from)
}

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
  target?: Version,
  declaration = String(version),
) => {
  let all = await dir.deploys(app)
  let prior = all.find((v) => v.version == app.version)
  let eid = target?.eid ?? mint()
  return await dir.stamp({
    entities: [
      {
        entity: { eid: app.eid },
        app: {
          version,
          declaration,
          source: app.source,
          draft: null,
          fence: null,
          script: app.script,
          worker,
          ...(app.lenses ? { lenses: app.lenses } : {}),
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
      ...target ? [] : [{
        entity: { eid },
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
      }],
      {
        entity: { eid: mint() },
        switched: {
          app: app.eid,
          from: prior?.eid ?? null,
          to: eid,
          source: app.source,
          at: new Date().toISOString(),
          by: who.person || null,
          via: null,
        },
      },
    ],
  }, vouched(who))
}
