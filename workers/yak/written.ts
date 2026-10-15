// What an app's files hold between deploys, and what each path has held
// (T-124791, D-124238). Bytes are stored once, under their SHA-256 (`sha/`,
// versions.ts `addressed`), and a path names a sha: every write puts the bytes
// it brings at their address and writes one `written` row per file in the
// directory, naming the path, the sha (none for a delete), who and when.
//
// The rows are both things a person asks about files. An app's draft, the
// edits its next deploy releases, is the newest row per path among the rows
// carrying `app.draft`, laid over the serving release's files (`overlaid`).
// A path's history is every row for it, newest first, each naming the sha it
// replaced too. So a write reads no old bytes and copies none: what it
// replaced is a sha the draft already named, whose bytes are already at their
// address. A restore writes a sha the path held, and a deploy names the shas
// the draft holds.
//
// A write costs one bucket round trip, every file's put at once, and the rows
// follow in one directory write once the bytes have landed. The order is the
// point: a row never names bytes that are not stored, so a write sent again
// after it was cut off finds every file that landed already recorded and puts
// only the rest (`modifying`). Two writers serialize in the directory: the
// rows are appended, never rewritten, so neither loses the other's, and the
// guard on the app row sends a write that crossed a deploy back to read the
// draft the deploy left.
import type { Objects } from '@yaks/blob'
import { lanes } from '@yaks/fp'
import { Stale } from '@yaks/graph/errors'
import { mint } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import type { App, Directory, Space } from './directory.ts'
import { adopted, old } from './carried.ts'
import { filesOf, prepare, promoted, viewOf } from './release.ts'
import { vouched, type Who } from './session.ts'
import { refuse } from './tool.ts'
import { indexOf, META } from './release_index.ts'
import {
  addressed,
  type Files,
  GRACE,
  KEEP,
  LANES,
  latest,
  type Pinner,
  SHA,
  versions,
  waiting,
} from './versions.ts'

/** One file written into an app (the directory's `written` row): the sha it
 * left at the path, null where it deleted the file, and the sha it replaced,
 * null where there was none. */
export type Written = {
  eid: string
  draft: string | null
  path: string
  sha: string | null
  was: string | null
  size: number | null
  at: string | null
  by: string | null
}

/**
 * How long a path's history keeps a write: thirty days, and never fewer than
 * the newest {@link KEEP}, so a file rewritten twenty times in an afternoon
 * still remembers all twenty a month later, and a file written once a year
 * still remembers the write before this one. The same thirty days the trash
 * keeps a deleted app (erase.ts `GRACE`) and Cloudflare keeps a store
 * (recover.ts `WINDOW`): three promises that happen to agree.
 */
export let AGE = 30 * 24 * 60 * 60_000

// Which of two writes came last: the later time, and between two in the same
// millisecond the greater eid, so every reader folds them the same way.
let after = (a: Written, b: Written) =>
  (a.at ?? '') != (b.at ?? '') ? (a.at ?? '') > (b.at ?? '') : a.eid > b.eid

/** Writes newest first. */
export let newest = (rows: Written[]) =>
  [...rows].sort((a, b) => after(a, b) ? -1 : after(b, a) ? 1 : 0)

/** The files `base` holds once `rows` are laid over it: each path as its
 * newest row left it, and gone where that row deleted it. */
export let overlaid = (base: Files, rows: Written[]): Files => {
  let files = { ...base }
  for (let row of newest(rows).reverse()) {
    if (row.sha) files[row.path] = row.sha
    else delete files[row.path]
  }
  return files
}

/** Where an app's draft is read, as a key prefix (release.ts `viewOf`): a
 * name no key in the bucket starts with, since a space's slug never begins
 * with a dot. */
export let draftRoot = (app: Pick<App, 'eid'>) => `.drafts/${app.eid}`

/** The files the serving release names, path to sha; none for an app never
 * released. A release's index never changes, so this is read once per
 * isolate (release.ts `indexed`). */
export let served = async (raw: Objects, app: App): Promise<Files> =>
  app.source ? filesOf(await prepare(raw, app.source)) : {}

/** An app's draft as a write or a read finds it. */
export type Draft = {
  /** where its files are read, in `view` */
  root: string
  /** path to sha: the serving release, with the draft's writes over it */
  files: Files
  /** the draft's own writes */
  rows: Written[]
  view: Objects
  /** the app as it stands, its draft among its files' rows */
  app: App
}

/**
 * An app as it stands once its files are in the shape a write keeps them: one
 * still served in place from its own prefix given a release (release.ts
 * `promoted`), and a draft still kept as its own bytes, its edits over those
 * same files, moved into rows (carried.ts `adopted`). Each happens once, on
 * the first touch or the daily sweep; one that crossed another write reads
 * the app again and goes round. An app made since has a source from its
 * first deploy, so this costs it nothing.
 */
export let current = async (
  raw: Objects,
  dir: Directory,
  space: Space,
  app: App,
): Promise<App> => {
  for (let n = 0;; n++) {
    try {
      if (!app.source && (app.version || old(app))) {
        app = await promoted(raw, dir, `${space.slug}/${app.slug}/`, app)
      }
      return old(app) ? await adopted(raw, dir, app) : app
    } catch (e) {
      if (!(e instanceof Stale) || n >= 4) throw e
      app = await latest(dir, space, app)
    }
  }
}

export let drafting = async (
  raw: Objects,
  dir: Directory,
  space: Space,
  app: App,
): Promise<Draft> => {
  app = await current(raw, dir, space, app)
  let [base, rows] = await Promise.all([
    served(raw, app),
    app.draft ? dir.written(app, app.draft) : Promise.resolve([]),
  ])
  let files = overlaid(base, rows)
  let root = draftRoot(app)
  return { root, files, rows, view: viewOf(raw, root, files), app }
}

/** One path a write changes: to new bytes, to a sha already stored (a restore,
 * an install), or to nothing (a delete). `sha` is the bytes' own when they
 * are sent. */
export type Change = {
  path: string
  bytes?: Uint8Array
  sha?: string
  size?: number | null
}

/**
 * A write into an app's draft. `act` is handed the draft as it stands and
 * answers the changes it makes and whatever its caller wants back; it runs
 * again if the draft moved under it (a deploy began or ended, another write
 * opened the draft), so it decides and does nothing it cannot repeat.
 *
 * A change that leaves a path as the draft already holds it is left out: a
 * write sent again after it was cut off puts and records only what did not
 * land, and says which were there (`already`). Answers which paths it wrote.
 */
export let modifying = async <T>(
  raw: Objects,
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
  act: (
    draft: Draft,
    app: App,
    attempt: number,
  ) => Promise<{ changes: Change[]; value: T }>,
): Promise<{ value: T; wrote: string[]; already: string[] }> => {
  // Bytes this call already put, so a write that goes round again does not
  // send them twice.
  let stored = new Set<string>()
  let row = app
  for (let n = 0; n < 5; n++) {
    row = await waiting(dir, space, row, who)
    try {
      let draft = await drafting(raw, dir, space, row)
      row = draft.app
      let { changes, value } = await act(draft, row, n)
      // A batch naming one path twice keeps the last, as a person would
      // expect.
      let last = [...new Map(changes.map((c) => [c.path, c])).values()]
      let todo = last.filter((c) =>
        (c.sha ?? null) != (draft.files[c.path] ?? null)
      )
      let already = last.filter((c) => !todo.includes(c)).map((c) => c.path)
      await Promise.all(
        todo.filter((c) => c.bytes && c.sha && !stored.has(c.sha)).map(
          async (c) => {
            await raw.put(addressed(c.sha!), c.bytes!)
            stored.add(c.sha!)
          },
        ),
      )
      if (!todo.length) return { value, wrote: [], already }
      let id = row.draft ?? mint()
      let at = new Date().toISOString()
      await dir.stamp({
        entities: [
          {
            entity: { eid: row.eid },
            app: { draft: id },
            $was: {
              app: {
                draft: token(row.draft ?? null),
                fence: token(null),
                source: token(row.source ?? null),
                version: token(row.version ?? null),
              },
            },
          },
          ...todo.map((c) => ({
            entity: { eid: mint() },
            written: {
              app: row.eid,
              draft: id,
              path: c.path,
              ...c.sha ? { sha: c.sha } : {},
              ...draft.files[c.path] ? { was: draft.files[c.path] } : {},
              ...c.size != null ? { size: c.size } : {},
              at,
              by: who.person || null,
            },
          })),
        ],
      }, vouched(who))
      return { value, wrote: todo.map((c) => c.path), already }
    } catch (e) {
      if (!(e instanceof Stale)) throw e
    }
  }
  throw refuse('conflict', `app ${app.slug} changed during edit; retry`)
}

/** What one path has held, newest first: every write to it the app keeps. */
export let history = async (dir: Directory, app: App, path: string) =>
  newest((await dir.written(app)).filter((row) => row.path == path))

/** What each write to a path took away, newest first, from its history
 * newest first: the bytes it replaced, until when and by whom. A write that
 * put a file where there was none took nothing. */
export let replaced = (rows: Written[]) =>
  rows.flatMap((w) => w.was ? [{ sha: w.was, at: w.at, by: w.by }] : [])

/** What a path held at a moment, from its history newest first: what the
 * first write after it took away, null where it took nothing because there
 * was no file. Undefined where nothing has been written since, so the path
 * already holds what it held then. */
export let heldAt = (rows: Written[], at: number) =>
  rows.filter((w) => w.at != null && Date.parse(w.at) > at).at(-1)?.was

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

/** Which of one path's rows, newest first, the history keeps at `now`: the
 * newest {@link KEEP}, every one inside {@link AGE}, and every one of the
 * draft still open, which is not history yet. */
export let kept = (rows: Written[], now: number, draft?: string | null) =>
  rows.filter((row, i) =>
    i < KEEP || (row.at != null && now - Date.parse(row.at) <= AGE) ||
    (!!draft && row.draft == draft)
  )

/**
 * Every stored blob nothing names any more, gone — the one place bytes at a
 * content address are ever deleted, run on the daily sweep (erase.ts
 * `collected`) and nowhere else.
 *
 * Mark and sweep, not reference counts (D-34942). The live set is recomputed
 * from the referrers on every run: a count kept beside each write and delete
 * drifts the first time a batch dies halfway, while a sweep that reads the
 * referrers heals whatever the last one got wrong. Two things name a blob:
 * a deploy (its manifest and its release's index) and a written row the
 * history keeps. The rows it no longer keeps go first, in the same pass,
 * since what a blob is still named by is exactly what that trim decides.
 *
 * The key space is the whole bucket's, so the mark set is too: an object one
 * app stopped naming may be the very file another app serves. The caller
 * hands every app still standing (a trashed one inside its thirty days and
 * the platform's own space included), and the sweep marks from all of them
 * before it deletes anything. What frees an app's bytes is its erasure.
 *
 * {@link GRACE} is the other half of "only what nothing names": a write puts
 * its bytes before the row that names them, so an object minutes old may be
 * named by a row still in flight; anything younger than a day is left alone.
 *
 * An upload's bytes live under the app's own `blobs/` prefix, which this
 * sweep does not list.
 */
export let pruned = async (
  dir: Directory,
  blobs: Objects,
  apps: Pinner[],
  now = Date.now(),
) => {
  let named = new Set<string>()
  for (let { prefix, app } of apps) {
    let space = `${prefix.split('/')[0]}/`
    let stage = `${space}.releases/${app.eid}/`
    let releases = await versions(dir, app)
    let moves = await dir.switches(app)
    let sources = new Set(
      [
        app.source,
        ...releases.map((v) => v.source),
        ...moves.map((r) => r.switched?.source),
      ]
        .filter((source): source is string =>
          typeof source == 'string' && !!source
        )
        .map((source) => space + source.slice(source.indexOf('/') + 1)),
    )
    let namedFiles = new Set<string>()
    let legacy: string[] = []
    await lanes(LANES)([...sources], async (source) => {
      namedFiles.add(source + META)
      let index = await indexOf(blobs, `${source}/`)
      if (!index) return void legacy.push(`${source}/`)
      for (let file of Object.values(index)) {
        namedFiles.add(file.key.startsWith(SHA) ? file.key : space + file.key)
        if (file.sha) named.add(file.sha)
      }
    })
    await blobs.delete(
      Object.entries(await blobs.uploaded(stage)).filter(([key, landed]) =>
        !namedFiles.has(key) &&
        !legacy.some((source) => key.startsWith(source)) &&
        now - landed >= GRACE
      ).map(([key]) => key),
    )
    // What is left of drafts kept as their own bytes, once nothing reads them.
    let drafts = `${space}.drafts/${app.eid}/`
    let active = old(app) ? `${app.draft}/` : null
    await blobs.delete(
      Object.entries(await blobs.uploaded(drafts)).filter(([key, landed]) =>
        !(active && key.startsWith(active)) && now - landed >= GRACE
      ).map(([key]) => key),
    )
    let paths = new Map<string, Written[]>()
    for (let row of await dir.written(app)) {
      paths.set(row.path, [...paths.get(row.path) ?? [], row])
    }
    let gone: string[] = []
    for (let rows of paths.values()) {
      let all = newest(rows)
      let keep = new Set(kept(all, now, app.draft))
      for (let row of all) {
        if (!keep.has(row)) gone.push(row.eid)
        else for (let sha of [row.sha, row.was]) if (sha) named.add(sha)
      }
    }
    for (let at = 0; at < gone.length; at += 200) {
      await dir.stamp({
        entities: gone.slice(at, at + 200).map((eid) => ({
          entity: { eid },
          $delete: true,
        })),
      })
    }
    // And every version the app can be put back to — all of them, since none
    // is ever buried: the oldest rollback it offers has to have its bytes.
    for (let v of releases) {
      for (let sha of Object.values(v.files)) named.add(sha)
    }
  }
  let unnamed = Object.entries(await blobs.uploaded(SHA)).filter((
    [key, landed],
  ) => !named.has(key.slice(SHA.length)) && now - landed >= GRACE)
    .map(([key]) => key)
  await blobs.delete(unnamed)
  return unnamed.length
}
