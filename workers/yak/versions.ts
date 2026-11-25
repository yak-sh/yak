import { releasesPrefix } from '@yaks/platform/file-root'
// An app's versions as yaks.app's directory keeps them: the `deploy` row each
// release writes and the `switched` row each move of the live pointer writes,
// in one batch (`record`), and the fence that holds edits while a release
// copies the draft it takes. What a version is and the rules read from its
// rows are @yaks/platform/versions'.
//
// Bytes are kept by liveness (T-34952): a blob lives while anything names it,
// a deploy or a write a path's history keeps, and the sweep (written.ts
// `pruned`) recomputes that set from the referrers every time. The edits
// between deploys, and each path's history, are written.ts's.
import { mint } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import { Stale } from '@yaks/graph/errors'
import type { App, Directory, Space } from './directory.ts'
import type { Reload } from '@yaks/platform'
import type { Join } from '@yaks/platform/manifest'
import type { Files, Version } from '@yaks/platform/versions'
import { acting, vouched, type Who } from './session.ts'
import { instrumentEid } from '@yaks/platform/instrument'
import { refuse } from './tool.ts'
import type { AppDraft } from './written.ts'

// One app the sweep must read the referrers of: the row, and where its keys
// live in the bucket (erase.ts `under`). The key space it pins into is the
// bucket's, so the sweep takes a list of these rather than one of them.
export type Pinner = { prefix: string; app: App }

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

export let releaseOf = (space: { store: string }, app: App) =>
  releasesPrefix(space, app) + crypto.randomUUID()

/** The app's newest row, from the request-local read `waiting` reuses. */
export let latest = async (dir: Directory, space: Space, app: App) => {
  // Reuse the addressed app's request-local read until a directory write
  // invalidates it. A rename or reused slug still resolves by identity.
  let current = await dir.app(space, app.slug)
  return current?.eid == app.eid
    ? current
    : (await dir.apps(space)).find((row) => row.eid == app.eid) ?? app
}

/** Whether `fence` holds edits of `draft`: a release holds only the draft it
 * takes, which `fenced` writes after the fence's own name. A draft it did
 * not take is laid over whatever serves (written.ts `overlaid`), so an edit
 * of it goes on while the release runs; with no draft named, every fence
 * holds.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * assert(holds('1:f:d', 'd') && holds('1:f:d') && !holds('1:f:d', 'e'))
 * assert(!holds('1:f', 'd') && !holds('1:f', null) && !holds('1:f:d', null))
 * assert(holds('1:f'))
 * ```
 */
export let holds = (fence: string, draft?: string | null) => {
  let took = fence.split(':')[2]
  return draft === undefined || (!!took && took === draft)
}

/** How old a fence is when whoever waits on it lifts it: the release that
 * drew it died holding it. */
export let ABANDONED = 5 * 60_000

/** How long a release waits its turn behind another (tools.ts `released`):
 * past {@link ABANDONED}, so a fence a dead release left is lifted before it
 * gives up. Only a release that outlasts its caller (outlast.ts) waits so
 * long; a dead fence is the one way it would see the end of it. */
export let TURN = ABANDONED + 60_000

/** A release fence holds new edits of the draft it takes (`holds`) until its
 * source switch or refusal. The edit gives up after `patience`, 30 seconds by
 * default, an answer well inside the minute after which a request that has
 * not answered is a defect (defects.ts `watched`). `draft` is the one the
 * edit goes into, null for a draft it opens; left out, every fence holds the
 * edit. */
export let waiting = async (
  dir: Directory,
  space: Space,
  app: App,
  who: Who,
  draft?: string | null,
  patience = 30_000,
) => {
  let until = Date.now() + patience
  for (let n = 0;; n++) {
    // The release lifting the fence is another request's write.
    if (n) dir.reread()
    let row = await latest(dir, space, app)
    if (!row.fence || !holds(row.fence, draft)) return row
    let started = Number(row.fence.split(':')[0])
    if (Date.now() - started > ABANDONED) {
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
    await new Promise((done) => setTimeout(done, 250))
  }
}

/** Whether `error` says another release moved the app row between the read
 * a release took its fence on and the take: it took the fence, or committed
 * and moved the live version. The release reads the row again and waits its
 * turn behind it. */
export let overtaken = (error: unknown, app: App) =>
  error instanceof Stale && error.eid == app.eid && error.comp == 'app' &&
  ['fence', 'source', 'version', 'declaration', 'access'].includes(error.prop)

/** A fence not yet taken: when it was drawn, which `waiting` reads its age
 * from, and a name no other fence shares. A job that can die holding one
 * draws it first and keeps it, so its next run lifts exactly that fence
 * (remake.ts `remade`). */
export let drawn = () => `${Date.now()}:${crypto.randomUUID()}`

/** Hold new edits while one release copies the draft it takes, `taken`,
 * which must still be open; none for a release of other files. */
export let fenced = async (
  dir: Directory,
  app: App,
  taken: AppDraft | null,
  who: Who,
  fence = drawn(),
) => {
  // A draft eid never holds a colon, so the fence's third part is it.
  if (taken) fence = `${fence}:${taken.eid}`
  await dir.stamp({
    entities: [
      {
        entity: { eid: app.eid },
        app: { fence },
        $was: {
          app: {
            fence: token(app.fence),
            space: token(app.space),
            ...taken?.legacy ? { draft: token(taken.eid) } : {},
            source: token(app.source),
            version: token(app.version),
          },
        },
      },
      ...taken && !taken.legacy
        ? [{
          entity: { eid: taken.eid },
          $was: { app_draft: { app: token(app.eid) } },
        }]
        : [],
    ],
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
//
// The row says what the release's pages speak (lenses.ts `ownSpeaks`), so a
// page's request reads that and never the release's vocabulary file.
export let record = async (
  dir: Directory,
  who: Who,
  app: App,
  version: number,
  files: Files,
  worker: string,
  {
    homes = [],
    sourceWas = app.source,
    taken = null,
    fenceWas = app.fence,
    seeded = false,
    reload,
    target,
    declaration = String(version),
    join,
    speaks,
    message,
    head,
    accessWas,
  }: {
    homes?: { app: App; release: string }[]
    sourceWas?: string | null
    /** The draft this release is made of, which it closes; none for a
     * release of other files (a version put back, an installed copy's
     * update, the live version made again), which leaves every draft open. */
    taken?: AppDraft | null
    fenceWas?: string | null
    seeded?: boolean
    reload?: Reload
    target?: Version
    declaration?: string
    join?: Join
    speaks?: Record<string, number>
    /** Everything the release changed and why, as its deployer wrote it. */
    message?: string
    head?: Awaited<ReturnType<Directory['deployHead']>>
    /** A release without a fence commits only while the app stays private. */
    accessWas?: App['access']
  } = {},
) => {
  head ??= await dir.deployHead(app)
  let eid = target?.eid ?? mint()
  // Who put it live, and when: the agent writing for a person, or the person
  // (M-31958), with its session. The deploy row's `created` says the same of
  // a new release; `last_deploy` on the app answers for its latest move.
  let { who: actor, rows } = acting(who)
  let at = new Date().toISOString()
  let moved = {
    at,
    by: actor.actor ?? actor.person ?? null,
    via: actor.via ? instrumentEid(actor.via) : null,
  }
  return await dir.stamp({
    entities: [
      ...rows,
      {
        entity: { eid: app.eid },
        app: {
          version,
          declaration,
          source: app.source,
          ...taken?.legacy ? { draft: null } : {},
          fence: null,
          script: app.script,
          worker,
          ...(app.lenses ? { lenses: app.lenses } : {}),
        },
        last_deploy: moved,
        ...join === undefined ? {} : { join: { declared: join } },
        ...seeded ? { seeded: { at, version } } : {},
        $was: {
          app: {
            version: token(app.version),
            declaration: token(app.declaration),
            source: token(sourceWas),
            ...accessWas !== undefined
              ? { access: token(accessWas), space: token(app.space) }
              : {},
            ...taken?.legacy ? { draft: token(taken.eid) } : {},
            fence: token(fenceWas),
          },
        },
      },
      ...taken && !taken.legacy
        ? [{ entity: { eid: taken.eid }, $delete: true }]
        : [],
      ...homes.map(({ app, release }) => ({
        entity: { eid: app.eid },
        app: { declaration: release },
        $was: { app: { declaration: token(app.declaration) } },
      })),
      ...target ? [] : [{
        entity: { eid },
        deploy: {
          ...speaks ? { speaks } : { lenses: app.lenses },
          app: app.eid,
          version,
          ...taken ? { draft: taken.eid } : {},
          files: JSON.stringify(files),
          worker,
          script: app.script ?? '',
          source: app.source,
          // Optional is derived; the stored mark can only raise severity.
          ...reload == 'required' ? { reload } : {},
          ...message ? { message } : {},
        },
      }],
      {
        entity: { eid: mint() },
        switched: {
          app: app.eid,
          from: head.live,
          to: eid,
          source: app.source,
          ...moved,
        },
      },
    ],
  }, vouched(actor))
}
