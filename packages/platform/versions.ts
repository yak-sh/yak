// An app's kept versions, so one word puts a working app back (T-32886,
// V-32361: "we want to prioritize error-correction over initial correctness").
// When an agent breaks a page the person was using, their own repair is "put
// it back", so every deploy records the version it made, a rollback selects
// one, and each move of the live pointer is recorded (./vocab.json `deploy`,
// `switched`).
//
// A version is a manifest, each path to the SHA-256 of that file's bytes, and
// never a copy of the bytes. The bytes are pinned once, content-addressed,
// under one key space for the whole bucket (`SHA`, D-34942), so a file
// unchanged across twenty deploys is one object and the same file in two apps
// is one object as well. Everything a deploy plants is a file (vocab.json,
// worker.js, the seeds), so restoring the files and deploying them again is
// the whole of a rollback.
//
// An app keeps every version it ever deployed: a manifest is a few hundred
// bytes, and git derives an app's commit chain from them (D-34942). What KEEP
// bounds is only how many a list shows at once.
//
// This is the versions' data and the rules read from them. Where they are
// kept and how a deploy writes one are the host's: yaks.app's directory
// (workers/yak/versions.ts `record`).
import type { Blobs, Objects } from '@yaks/blob'
import type { Reload } from './release.ts'

/** A version's file set: the path the app serves it at, and the name of its
 * bytes. */
export type Files = Record<string, string>

/** One deploy of an app, as its `deploy` row says it. */
export type Version = {
  eid: string
  version: number
  at: string
  files: Files
  /** Cloudflare's own name for the script upload this deploy made, empty
   * where the app has no worker. The script and source select this release. */
  worker: string
  script?: string
  source?: string | null
  reload?: Reload | null
  /** Everything the release changed and why, as whoever released it wrote it
   * (app_deploy `message`): what the next agent at the app reads first. */
  message?: string | null
  /** The sha of a picture of this release as a browser drew it, among the
   * app's uploads (app_preview `keep`). */
  screenshot?: string | null
  /** Who made it: the writer its row was created by, a person or an agent
   * writing for one. */
  by?: string | null
  /** Whether it passed yaks.app's code review (`code_review` on its row,
   * verdict approve). */
  reviewed?: boolean
}

/** One move of an app's live pointer, as its `switched` row says it: the
 * version it left and the one it selected, by eid. */
export type Switch = {
  switched?: {
    from?: string | null
    to: string
    source?: string | null
    at?: string | null
  }
}

/** How many versions a list shows at once, and the floor under a path's
 * history. Twenty is a week of an agent's iterating and small enough that the
 * page is one read and one answer. */
export let KEEP = 20

/** How many of the newest releases' messages an agent reading the app is
 * shown, whole: the changes it most likely has to build on. */
export let RECENT = 3

/** Where a compiled page script is kept, by its source's path: served at the
 * source's address, and made again by every deploy. */
export let BUILT = 'esbuild/'

// What the platform keeps beside an app's files, under the app's own prefix:
// the bytes a page uploaded and the page scripts a deploy compiled (`BUILT`).
// Neither is a file anyone wrote, so neither is listed or carried by an
// install.
let KEPT = ['blobs/', BUILT]

/** The app's own files among its keys: what a person wrote and what the app
 * serves. */
/// own(['index.html', 'blobs/ab', 'esbuild/app.js', 'app.ts']) -> ['index.html', 'app.ts']
export let own = (paths: string[]) =>
  paths.filter((p) => !KEPT.some((k) => p.startsWith(k)))

/** The one key space pinned bytes live in: the sha alone, so two apps holding
 * the same file hold one object (D-34942). */
export let SHA = 'sha/'

/** Where bytes with this address are pinned, for the whole bucket. */
/// addressed('ab12') -> 'sha/ab12'
export let addressed = (sha: string) => SHA + sha

// A release is named by a UUID: its files live under `.releases/<…>/<id>`,
// and a page of it loads each asset at `/assets/<id>/<path>` under the app's
// `/api/`, an address no later release answers differently.
let UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
let RELEASE = new RegExp(`(?:^|/)\\.releases/[^/]+/(${UUID})$`)
let ASSET = new RegExp(`^/assets/(${UUID})/(.+)$`)
let FINGERPRINT = /^\/assets\/([a-f0-9]{64})\/(.+)$/

/** The immutable release id, only where the app serves a release. */
/// releaseId('apps/ada/.releases/7/0b6b4f8c-fdcc-4a38-bcbd-15bad97cee69') -> '0b6b4f8c-fdcc-4a38-bcbd-15bad97cee69'
/// releaseId('apps/ada') -> null
export let releaseId = (source: string | null | undefined): string | null =>
  RELEASE.exec(source ?? '')?.[1] ?? null

/** An app API path naming one asset in one release. */
export let assetPath = (
  path: string,
): { release: string; path: string } | null => {
  let found = ASSET.exec(path)
  return found ? { release: found[1], path: `/${found[2]}` } : null
}

/** An app API path naming a file by the bytes the browser receives. */
export let fingerprintPath = (path: string) => {
  let found = FINGERPRINT.exec(path)
  return found ? { sha: found[1], path: `/${found[2]}` } : null
}

/**
 * The pin store: @yaks/blob's three addressed verbs over the bucket the app's
 * own files live in, so a caller pinning bytes names them and never a key.
 *
 * It is built from the key store rather than over the binding because the
 * sweep needs `list`, `uploaded` and `delete` over these same objects and the
 * addressed interface has none of them: one adapter over one bucket seam
 * beats two clients of one binding disagreeing about what is in it.
 */
export let pins = (blobs: Objects): Blobs => ({
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

/** What one version did to the one before it, in the words a person would
 * use: nothing is added or removed where there is no version before. */
/// changed({ a: '1', b: '2' }, { a: '3', c: '4' }) -> { added: ['c'], changed: ['a'], removed: ['b'] }
/// changed(null, { a: '1' }) -> { added: [], changed: [], removed: [] }
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

/** That, as one clause. A first deploy has nothing to compare against, so it
 * says how big it was. */
/// whatChanged({ 'index.html': 'a', 'worker.js': 'b' }, { 'index.html': 'c', 'worker.js': 'b', 'broken.js': 'd' }) -> 'added broken.js, changed index.html'
/// whatChanged({ a: '1' }, { a: '1' }) -> 'no files changed'
/// whatChanged(null, { a: '1' }) -> '1 file'
/// whatChanged(null, { a: '1', b: '2' }) -> '2 files'
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

/** Two versions with the same files are the same release: the manifest is
 * the whole of what a version is. */
/// same({ a: '1', b: '2' }, { b: '2', a: '1' }) -> true
/// same({ a: '1' }, { a: '1', b: '2' }) -> false
export let same = (a: Files, b: Files) => {
  let paths = Object.keys(a)
  return paths.length == Object.keys(b).length &&
    paths.every((p) => a[p] == b[p])
}

/** The number a new deploy takes, given every version newest first: above
 * the highest kept, not above the live pointer, so a deploy after a rollback
 * never reuses a number. */
/// nextVersion([]) -> 1
/// nextVersion([{ version: 4 }, { version: 2 }]) -> 5
export let nextVersion = (all: Pick<Version, 'version'>[]) =>
  (all[0]?.version ?? 0) + 1

/** A message set under the line that names its version, each line indented
 * so a list keeps its shape. */
/// indented('one\n\ntwo') -> '  one\n\n  two'
export let indented = (message: string) =>
  message.split('\n').map((line) => line ? `  ${line}` : line).join('\n')

/** The newest releases that say what they changed, newest first: the
 * changes an agent about to change the app most likely builds on. */
export let noted = (all: Version[], n = RECENT) =>
  all.slice(0, n).filter((v) => v.message)

/** Those releases' messages, whole, in the words an agent reads: what each
 * changed and why, so agents working one app stay in step. Empty where none
 * says anything. */
export let recent = (said: Version[]) =>
  said.length
    ? [
      'What the latest releases changed, as their deployers wrote it:',
      ...said.map((v) =>
        `v${v.version}${v.at ? ` ${v.at}` : ''}:\n${v.message}`
      ),
    ].join('\n\n')
    : ''

/** The same releases as a tool's value carries them. */
export let releases = (said: Version[]) =>
  said.map(({ version, at, message }) => ({ version, at, message }))

/** What a copy's release says when it goes out from its publisher's: the
 * messages of the publisher's versions it crossed, after `was` up to `to`,
 * oldest first, each under its version where there are several (app_install,
 * app_update). */
export let crossed = (theirs: Version[], was: number, to: number) => {
  let said = theirs
    .filter((v) => v.message && v.version > was && v.version <= to)
    .sort((a, b) => a.version - b.version)
  return said.length == 1
    ? said[0].message!
    : said.map((v) => `v${v.version}:\n${v.message}`).join('\n\n')
}

/** The version `live` replaced when it went out: the `from` of its own
 * deploy's pointer move, the earliest move to it from its source. A deploy
 * made after a rollback goes out over an older version, so the next number
 * down can be the very version a person already left. Undefined when no move
 * names `live`, or it replaced nothing. */
export let deployedOver = (
  all: Version[],
  moves: Switch[],
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

/** The version a rollback from `now` selects: the one `asked` for, or, with
 * none asked, what was live before `now` went out. That is the pointer's
 * history, not the next number down, which after a rollback is the version
 * the person already left; an app with no recorded move falls back to the
 * number. Undefined where there is no such version. */
export let backTo = (
  all: Version[],
  moves: Switch[],
  now: number,
  asked?: number,
): Version | undefined => {
  if (asked != null) return all.find((v) => v.version == asked)
  let live = all.find((v) => v.version == now)
  return (live && deployedOver(all, moves, live)) ??
    all.find((v) => v.version < now)
}
