// What an app's files hold between deploys, and what each path has held
// (T-124791, D-124238). Bytes are stored once, under their SHA-256 (`sha/`,
// versions.ts `addressed`), and a path names a sha: every write puts the bytes
// it brings at their address and writes one `written` row per file in the
// directory, naming the path, the sha (none for a delete), who and when.
//
// The rows are both things a person asks about files. An app holds a draft
// for each writer (D-414): a row of its own (`app_draft`, {@link AppDraft}),
// whose edits are the newest row per path among the rows naming it, laid over
// the serving release's files (`overlaid`). Each connector session writes in
// drafts of its own, and a person's own hands in the browser share one, so
// one writer's release never ships another's edits.
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
// rows are appended, never rewritten, so neither loses the other's. A row is
// named for the row it supersedes, so two writes of one path from the same
// state collide and the second goes round to write over the first; the guard
// on the app row sends a write that crossed a deploy back to read the live
// files the deploy left, and the guard on the draft's row sends one whose
// draft a release closed back to choose again.
import type { Objects } from '@yaks/blob'
import { groupBy, lanes } from '@yaks/fp'
import { Stale } from '@yaks/graph/errors'
import { derivedEid, mint } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import type { App, Directory, Space } from './directory.ts'
import { filesAt, filesIn, viewOf } from './release.ts'
import { same } from './versions.ts'
import { vouched, type Who } from './session.ts'
import { refuse } from './tool.ts'
import { META } from './release_index.ts'
import {
  addressed,
  type Files,
  GRACE,
  KEEP,
  LANES,
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
// millisecond the greater eid, so every reader folds them the same way. New
// edits advance past their draft's last stamp; this tie-break still resolves
// historical rows written before that guarantee.
let after = (a: Written, b: Written) =>
  (a.at ?? '') != (b.at ?? '') ? (a.at ?? '') > (b.at ?? '') : a.eid > b.eid

/** One open draft of an app, the directory's `app_draft` row: the live
 * version it opened on, the person whose it is and the connector session
 * that opened it. Neither names the draft an app held before drafts were rows
 * (`app.draft`, read as one of these until the store mover writes its row:
 * `legacy`); anyone with a seat may release it. A release or a discard
 * deletes the row. */
export type AppDraft = {
  eid: string
  base: number | null
  by: string | null
  via: string | null
  at: string | null
  /** When its preview link was first asked for; none where nobody has
   * previewed it, so a write to it tells no preview's pages. */
  previewed: string | null
  legacy?: true
}

/** What a call names to open a draft of its own beside the ones it holds:
 * an agent trying several directions at once holds one per direction. */
export let NEW = 'new'

/** An app's open drafts: its `app_draft` rows, and the draft its row still
 * names as `app.draft` where no row stands for it yet. Never cached: a write
 * chooses among them. */
export let draftsOf = async (dir: Directory, app: App) =>
  withLegacy(app, await dir.drafts(app))

/** An app's `app_draft` rows, with the draft `app.draft` still names where
 * no row stands for it. */
export let withLegacy = (app: App, rows: AppDraft[]): AppDraft[] =>
  app.draft && !rows.some((d) => d.eid == app.draft)
    ? [...rows, {
      eid: app.draft,
      base: app.version,
      by: null,
      via: null,
      at: null,
      previewed: null,
      legacy: true,
    }]
    : rows

/** Whether a draft is the caller's own: one its connector session opened,
 * or, for a person at their own browser, the one their hands share. */
export let ownBy = (who: Who) => (d: AppDraft) =>
  who.agent && who.via
    ? d.via == who.via
    : !!who.person && d.by == who.person && !d.via

let listed = (drafts: AppDraft[]) => drafts.map((d) => d.eid).join(', ')

/** The draft a call works in: the one it names, else the caller's own; none
 * where it has none, which a read sees as live and a write opens. Several of
 * its own and none named is refused with their ids: a conversation holding
 * several on purpose says which each call means. */
export let chosen = (
  app: App,
  drafts: AppDraft[],
  who: Who,
  asked?: string | null,
): AppDraft | null => {
  if (asked == NEW) return null
  if (asked) {
    let named = drafts.find((d) => d.eid == asked)
    if (!named) {
      throw refuse(
        'missing',
        `no open draft ${asked} of ${app.slug}: it was released or ` +
          `discarded${
            drafts.length ? `; its open drafts are ${listed(drafts)}` : ''
          }`,
      )
    }
    return named
  }
  let own = drafts.filter(ownBy(who))
  if (own.length > 1) {
    throw refuse(
      'arguments',
      `draft: this conversation holds ${own.length} drafts of ${app.slug} ` +
        `(${listed(own)}); name the one this call means`,
    )
  }
  return own[0] ?? null
}

/** The draft a release takes: the one named, else the caller's own, else,
 * for a caller with none of its own (a new chat, a reconnect), the person's
 * one open draft or the one no author holds. Several to choose from is
 * refused with their ids. None is a release of the live files again. */
export let releasing = (
  app: App,
  drafts: AppDraft[],
  who: Who,
  asked?: string | null,
): AppDraft | null => {
  let mine = chosen(app, drafts, who, asked == NEW ? null : asked)
  if (mine || asked) return mine
  let theirs = drafts.filter((d) => !d.by || d.by == who.person)
  if (theirs.length > 1) {
    throw refuse(
      'arguments',
      `draft: ${app.slug} has ${theirs.length} open drafts (${
        listed(theirs)
      }); name the one to release`,
    )
  }
  return theirs[0] ?? null
}

/** The draft a page shows a person when nothing names one: their own
 * newest, else the one no author holds; none where they have neither. */
export let theirs = (drafts: AppDraft[], who: Who) =>
  [...drafts.filter(ownBy(who))].sort(byAt).at(-1) ??
    [...drafts.filter((d) => d.by == who.person)].sort(byAt).at(-1) ??
    drafts.find((d) => !d.by) ?? null

let byAt = (a: AppDraft, b: AppDraft) =>
  (a.at ?? '') < (b.at ?? '') ? -1 : (a.at ?? '') > (b.at ?? '') ? 1 : 0

/** Where a draft's preview link serves from and is told: its own eid, or
 * for the draft no author holds, the app's link from before each draft had
 * its own (`app.followed`), so a link sealed then keeps showing it. */
export let linkFor = (app: App, d: AppDraft) =>
  !d.by && app.followed ? app.followed : d.eid

/** What a write into `d` carries on the app's row: for the draft
 * `app.draft` names, that pointer gone, since the draft's row is written in
 * the same write (`opening`). */
export let unpointed = (
  d: AppDraft,
): { app?: { draft: null }; was: Record<string, string | null> } =>
  d.legacy
    ? { app: { draft: null }, was: { draft: token(d.eid) } }
    : { was: {} }

/** What a write into `d` carries for its row: the row written where it has
 * none yet (a new draft, or the one `app.draft` names), or a guard that it
 * is still open. */
export let opening = (
  app: App,
  d: AppDraft,
  fresh: boolean,
  extra: Partial<Pick<AppDraft, 'previewed'>> = {},
) =>
  fresh || d.legacy
    ? {
      entity: { eid: d.eid },
      app_draft: {
        app: app.eid,
        ...d.base != null ? { base: d.base } : {},
        ...d.by ? { by: d.by } : {},
        ...d.via ? { via: d.via } : {},
        ...d.at ? { at: d.at } : {},
        ...extra.previewed ?? d.previewed
          ? { previewed: extra.previewed ?? d.previewed }
          : {},
      },
      $was: { app_draft: { app: token(null) } },
    }
    : {
      entity: { eid: d.eid },
      ...extra.previewed ? { app_draft: { previewed: extra.previewed } } : {},
      $was: { app_draft: { app: token(app.eid) } },
    }

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
 * isolate (release.ts `filesAt`). */
export let served = async (raw: Objects, app: App): Promise<Files> =>
  app.source ? await filesAt(raw, app.source) : {}

/** What a draft holds, as a write or a read finds it; with no draft
 * (`of` none), the live files. */
export type Draft = {
  /** the draft's row; none where the caller has no draft */
  of: AppDraft | null
  /** where its files are read, in `view` */
  root: string
  /** path to sha: the serving release, with the draft's writes over it */
  files: Files
  /** the draft's own writes */
  rows: Written[]
  /** whether those writes leave files other than the serving release's */
  unreleased: boolean
  view: Objects
}

/** A draft as it stands: the serving release's files with the draft's own
 * writes laid over them; the serving release's alone with no draft. */
export let drafting = async (
  raw: Objects,
  dir: Directory,
  app: App,
  of: AppDraft | null,
): Promise<Draft> => {
  let { files, rows, base } = await over(dir, app, of, served(raw, app))
  let root = draftRoot(app)
  return {
    of,
    root,
    files,
    rows,
    unreleased: !same(base, files),
    view: viewOf(raw, root, files),
  }
}

/** The paths an app's release and every open draft hold, for what an
 * erasure says it took. A release an erasure that died partway already swept
 * holds nothing now, so asking again finishes the erasure instead of refusing
 * to read it. */
export let holding = async (raw: Objects, dir: Directory, app: App) => {
  let [base, drafts] = await Promise.all([
    app.source
      ? filesIn(raw, app.source).then((files) => files ?? {})
      : Promise.resolve({}),
    draftsOf(dir, app),
  ])
  let paths = new Set(Object.keys(base))
  for (let d of drafts) {
    let { files } = await over(dir, app, d, Promise.resolve(base))
    for (let path of Object.keys(files)) paths.add(path)
  }
  return [...paths]
}

// The draft's own writes laid over `base`.
let over = async (
  dir: Directory,
  app: App,
  of: AppDraft | null,
  base: Promise<Files>,
) => {
  let [files, rows] = await Promise.all([
    base,
    of ? dir.written(app, of.eid) : Promise.resolve([]),
  ])
  return { files: overlaid(files, rows), rows, base: files }
}

/** One change to what a draft's preview link serves, as its pages hear it:
 * a write to the draft, naming the files it left, each at its sha, null for a
 * delete; or its release, `draft` null and no files, after which the link
 * serves what was released. `link` is the draft's (`linkFor`). */
export type Drafted = {
  app: string
  link: string
  draft: string | null
  files: { path: string; sha: string | null; entries?: string[] }[]
  at: string
}

/** Where a draft's writes are told: its preview link's pages (preview.ts
 * `watching`), with the draft before the write so the notice can name the
 * page entries it reaches. Never refuses: the write has already landed. */
export type Tell = (news: Drafted, before?: Draft) => Promise<void>

/** A draft marked as previewed the first time its link is asked for
 * (preview.ts), so its writes are told to the link's pages from then on; a
 * draft nobody previewed costs a write nothing more. Answers the draft as it
 * stands after. */
export let previewed = async (
  dir: Directory,
  space: Space,
  app: App,
  d: AppDraft,
  who: Who,
): Promise<AppDraft> => {
  let row = app
  let now = d
  for (let n = 0; n < 5; n++) {
    if (now.previewed || (!now.by && row.followed)) return now
    row = await waiting(dir, space, row, who)
    let at = new Date().toISOString()
    try {
      let { app: pointer, was } = unpointed(now)
      await dir.stamp({
        entities: [
          ...pointer
            ? [{ entity: { eid: row.eid }, app: pointer, $was: { app: was } }]
            : [],
          opening(row, now, false, { previewed: at }),
        ],
      }, vouched(who))
      return { ...now, previewed: at, legacy: undefined }
    } catch (e) {
      if (!(e instanceof Stale)) throw e
      let found = (await draftsOf(dir, row)).find((o) => o.eid == d.eid)
      if (!found) {
        throw refuse('missing', `draft ${d.eid} of ${app.slug} was released`)
      }
      now = found
    }
  }
  throw refuse('conflict', `app ${app.slug} changed while opening its link`)
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
 * A write into one of an app's drafts: the one `asked` names, else the
 * writer's own (`chosen`), else a new one, which `asked` {@link NEW} opens
 * beside those it holds. `act` is handed the draft as it stands and answers
 * the changes it makes and whatever its caller wants back; it runs again if
 * the draft moved under it (a deploy began or ended, another write to the
 * same draft), so it decides and does nothing it cannot repeat.
 *
 * A change that leaves a path as the draft already holds it is left out: a
 * write sent again after it was cut off puts and records only what did not
 * land, and says which were there (`already`). Answers which paths it wrote,
 * and the draft they landed in, and once they have landed tells `tell`, if
 * the draft has a preview link. `now` is the writer's clock; persisted draft
 * stamps order edits even when that clock stops or moves backwards.
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
  tell: Tell,
  asked?: string | null,
  now = () => new Date().toISOString(),
): Promise<{
  value: T
  wrote: string[]
  already: string[]
  /** the draft the write landed in, none where it changed nothing */
  draft: string | null
  /** the app's open drafts once it landed */
  drafts: AppDraft[]
}> => {
  // Bytes this call already put, so a write that goes round again does not
  // send them twice.
  let stored = new Set<string>()
  // The eid a draft opened on purpose takes ({@link NEW}), the same however
  // often the write goes round.
  let opened = mint()
  let row = app
  for (let n = 0; n < 5; n++) {
    row = await waiting(dir, space, row, who)
    try {
      let drafts = await draftsOf(dir, row)
      let into = chosen(row, drafts, who, asked)
      // A writer with no draft of its own names the one it opens for the
      // app's newest write, read before its drafts are read again: a draft
      // another write of its opened since is then either seen, or opened
      // on the same head, so the two race for one eid.
      let head = ''
      if (!into && asked != NEW) {
        head = newest(await dir.written(row))[0]?.eid ?? ''
        drafts = await draftsOf(dir, row)
        into = chosen(row, drafts, who, asked)
      }
      let draft = await drafting(raw, dir, row, into)
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
      if (!todo.length) {
        return { value, wrote: [], already, draft: into?.eid ?? null, drafts }
      }
      let fresh = !into
      let via = who.agent && who.via ? who.via : null
      let d: AppDraft = into ?? {
        // A writer's own draft is named for the writer and the app's newest
        // write, so two first writes of one conversation at once race for
        // one eid and the second lands in the draft the first opened.
        eid: asked == NEW ? opened : derivedEid(
          `app_draft|${row.eid}|${via ?? who.person ?? ''}|${head}`,
        ),
        base: row.version,
        by: who.person || null,
        via,
        at: null,
        previewed: null,
      }
      let id = d.eid
      // A retry has reread the winner. Its rows must sort after that winner
      // even if the clock has not ticked: derived eids are not write order.
      // Advance only from this draft's persisted stamp, never an isolate-wide
      // counter (which would keep pushing unrelated apps into the future).
      let lastAt = draft.rows.reduce((last, w) => {
        let at = Date.parse(w.at ?? '')
        return Number.isFinite(at) ? Math.max(last, at) : last
      }, -Infinity)
      let at = new Date(Math.max(Date.parse(now()), lastAt + 1)).toISOString()
      if (fresh || d.legacy) {
        d = {
          ...d,
          at: d.at ??
            (newest(draft.rows).at(-1)?.at ?? at),
        }
      }
      // Each row is named for the row it supersedes, so two writers who read
      // the same state of a path race for one eid: the first lands, and the
      // guard sends the other round to write over it.
      let heads = new Map<string, string>()
      for (let w of newest(draft.rows)) {
        if (!heads.has(w.path)) heads.set(w.path, w.eid)
      }
      let pointer = unpointed(d)
      await dir.stamp({
        entities: [
          {
            entity: { eid: row.eid },
            ...pointer.app ? { app: pointer.app } : {},
            $was: {
              app: {
                fence: token(null),
                source: token(row.source ?? null),
                version: token(row.version ?? null),
                ...pointer.was,
              },
            },
          },
          opening(row, d, fresh),
          ...todo.map((c) => ({
            entity: {
              eid: derivedEid(
                `written|${row.eid}|${id}|${c.path}|${heads.get(c.path) ?? ''}`,
              ),
            },
            $was: { written: { path: token(null) } },
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
      if (d.previewed || (!d.by && row.followed)) {
        await tell({
          app: row.eid,
          link: linkFor(row, d),
          draft: id,
          files: todo.map((c) => ({ path: c.path, sha: c.sha ?? null })),
          at,
        }, draft)
      }
      return {
        value,
        wrote: todo.map((c) => c.path),
        already,
        draft: id,
        drafts: [
          ...drafts.filter((o) => o.eid != id),
          { ...d, legacy: undefined },
        ],
      }
    } catch (e) {
      if (!(e instanceof Stale)) throw e
    }
  }
  throw refuse('conflict', `app ${app.slug} changed during edit; retry`)
}

/** A draft closed unreleased (app_files op: discard): its row gone, or
 * for the one `app.draft` names, that pointer. What it wrote stays in each
 * path's history, as a released draft's does. */
export let discarded = (dir: Directory, app: App, d: AppDraft, who: Who) =>
  dir.stamp({
    entities: d.legacy
      ? [{
        entity: { eid: app.eid },
        app: { draft: null },
        $was: { app: { draft: token(d.eid) } },
      }]
      : [{ entity: { eid: d.eid }, $delete: true }],
  }, vouched(who))

/** A delete sent again is already done if this draft records its deletion,
 * or if a competing writer deleted it while the caller retried. */
export let deleting = (draft: Draft, path: string, attempt = 0) => {
  if (path in draft.files) return { changes: [{ path }], value: true }
  if (attempt || draft.rows.some((w) => w.path == path && !w.sha)) {
    return { changes: [], value: false }
  }
  throw refuse('missing', `no file ${path}`)
}

/** The sha a restore selects: an explicit sha the path held, its value at a
 * moment, or the most recent value different from what stands now. The
 * caller supplies the door's parsed time and words its own missing answer. */
export let restoring = (
  rows: Written[],
  now: string | null,
  asked: { sha?: string; at?: number } = {},
) => {
  let gone = replaced(rows)
  let then = asked.at != null ? heldAt(rows, asked.at) : undefined
  let want = asked.sha != null
    ? [...gone.map((w) => w.sha), ...rows.map((w) => w.sha)]
      .find((sha) => sha == asked.sha)
    : asked.at != null
    ? then
    : gone.find((w) => w.sha != now)?.sha
  return { then, want }
}

/**
 * What "go back" undoes in an app: its newest write that still stands, as the
 * changes putting each path it wrote back to the sha it replaced (none where
 * it made the file), and when it was. The rows of one write share its stamp
 * (`modifying`). A write that exactly reverses the standing write before it
 * undid that write, so the two cancel and going back again steps further back
 * rather than putting the undone write back. Undefined where none stands.
 */
export let goingBack = (rows: Written[]) => {
  let writes = groupBy(
    newest(rows).reverse(),
    (w) => w.at ? `${w.draft}|${w.at}` : w.eid,
  ).values()
  let standing: Written[][] = []
  for (let write of writes) {
    let top = standing.at(-1)
    let undoes = top?.length == write.length &&
      write.every((w) =>
        top.some((t) => t.path == w.path && t.sha == w.was && t.was == w.sha)
      )
    if (undoes) standing.pop()
    else standing.push(write)
  }
  let last = standing.at(-1)
  return last && {
    at: last[0].at,
    changes: last.map((w): Change =>
      w.was
        ? {
          path: w.path,
          sha: w.was,
          size: rows.find((r) => r.sha == w.was)?.size ?? null,
        }
        : { path: w.path }
    ),
  }
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
 * newest {@link KEEP}, every one inside {@link AGE}, and every one of a
 * draft still open, which is not history yet. */
export let kept = (
  rows: Written[],
  now: number,
  open: ReadonlySet<string> = new Set(),
) =>
  rows.filter((row, i) =>
    i < KEEP || (row.at != null && now - Date.parse(row.at) <= AGE) ||
    (!!row.draft && open.has(row.draft))
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
    let erased = false
    await lanes(LANES)([...sources], async (source) => {
      let files = await filesIn(blobs, source)
      if (!files) {
        // The census predates these reads. An erase removes bytes before
        // its directory row, and may have finished while the sweep yielded.
        if (!await dir.appAt(app.eid)) {
          erased = true
          return
        }
        throw new Error(`release ${source} has no index`)
      }
      for (let sha of Object.values(files)) {
        named.add(sha)
      }
    })
    if (erased) continue
    // A stage holds nothing but the index of each release, so any other key
    // there, or the index of a release nothing names, goes once a day old.
    let indexes = new Set([...sources].map((source) => source + META))
    await blobs.delete(
      Object.entries(await blobs.uploaded(stage)).filter(([key, landed]) =>
        !indexes.has(key) && now - landed >= GRACE
      ).map(([key]) => key),
    )
    let paths = new Map<string, Written[]>()
    for (let row of await dir.written(app)) {
      paths.set(row.path, [...paths.get(row.path) ?? [], row])
    }
    let gone: string[] = []
    let open = new Set((await draftsOf(dir, app)).map((d) => d.eid))
    for (let rows of paths.values()) {
      let all = newest(rows)
      let keep = new Set(kept(all, now, open))
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
