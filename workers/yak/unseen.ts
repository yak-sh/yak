// What broke that the person's agent has not heard yet (D-32318 §Errors,
// T-32362): the open `exception` and `error` entities across a space's app
// tracker, one line each, and the mark that they were served. Published ids
// from before the tracker still translate through their original app stores. The comms bus
// in this graph stamps `notified` on each line it delivers (client.ts
// notices()); this does the same, so an item rides one reply and then only
// `app_errors` shows it again. Open means not `archived`: a later deploy
// ({@link healed}) or the agent saying so ({@link archive}) archives it.
// Reads and marks go through the store's own doors with the caller vouched,
// never SQL; the apps of a space come from the directory part. The same
// rows are the `app_errors` answer, one line each.
import type { Bundle } from '@yaks/graph'
import { short } from '@yaks/id'
import * as dirPart from './directory.ts'
import {
  type App,
  appStore,
  directory,
  type Space,
  stamp,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import { sessionAt, vouched, type Who } from './session.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import { told } from './stream.ts'
import { gauged, level } from './meter.ts'
import { caught, defect } from './defects.ts'
import { capture, origin, queue } from '@yaks/tracker/report'
import { errorsAt, errorsIn } from './app-errors.ts'
import { refuse } from './tool.ts'
import { isTestAddress } from './lib/bots.ts'

// A refusal is NOT a break (C-32652 item 3, T-32655; C-32869 item 5) — one
// rule, read off whichever half of the answer the platform is holding.
//
// The status is the rule. A 4xx is somebody's deliberate no: the app doors'
// `not_a_writer`/`not_a_reader` (apps.ts says), identity's `unauthorized`,
// the store's `method_not_allowed` — and equally an app's own worker saying
// "no city by that name", or passing on the 401 an outside service gave it
// for a key its owner mistyped. Nobody's code fell over, and the page that
// catches one is meant to act on it, since the guide teaches
// `e.signIn ? location = e.signIn`. A break is what nobody chose: a throw,
// or a 5xx (`failed` below). Two 400s are the page's own code wrong, and the
// door that answers them files them itself (apps.ts `mistaken`): a query the
// store cannot read, and a write its vocabulary cannot keep (@yaks/graph
// `misfit`).
//
// Where there is no status — a kernel part that relayed a door's no by
// throwing what it was answered (kernel.ts's catch-all) — the answer's own
// shape stands in for it: every door here says a no one way, a body
// carrying `{"error":{"code":…}}`, and what fell over never wears it.
// The catch logs that refusal without filing a break, and returns its JSON
// and 4xx at `/mcp` and API doors. A shaped refusal with no carried status
// answers 400; a page door keeps a page with that same status.
// A typed tool refusal (`CallError`) uses @yaks/tools' JSON HTTP answer,
// carrying its code, message and status rather than requiring a JSON message.
//
// The shape alone was the whole rule until C-32869 item 5, where a weather
// worker answered the person a sentence about the mistyped key and the
// platform filed two exceptions its owner archived by hand: an outside
// service does not spell its no the way our doors spell theirs, and never
// will. The shape was only ever a stand-in for the status.
let shaped = (answer: string) => {
  try {
    let said = JSON.parse(answer) as { error?: { code?: unknown } }
    return typeof said?.error?.code == 'string'
  } catch {
    // Not JSON at all — a door that fell over.
    return false
  }
}

export let refusal = (answer: string, status?: number) =>
  Number.isFinite(status) ? status! >= 400 && status! < 500 : shaped(answer)

// The other side of the same rule, for an answer nobody threw: a 5xx is the
// break. An app's worker answering one is written where the person's agent
// reads it (dispatch.ts `ran`); everything under it is the app working.
export let failed = (status: number) => status >= 500

// The version the app is serving, read through the directory's fresh app
// roster. The App the request was routed with is the fallback: a directory
// that cannot answer must not swallow the break.
export let serving = async (env: Env, space: Space, app: App) => {
  try {
    let now = await directory(bound(env.DIRECTORY, dirPart.fetch, env))
      .app(space, app.slug)
    return now?.version ?? app.version
  } catch (e) {
    caught(e, { request: 'serving version', app: app.slug })
    return app.version
  }
}

// The ceiling on what one app may push down its members' streams in a
// minute (T-33006): a crash-looping page writes a break per frame, and every
// break past the first few says the same thing. Per-isolate memory, like the
// report door's own write ceiling (apps.ts `flooding`) — approximate on
// purpose.
let PUSHES = 10
let pushed = new Map<string, { minute: number; n: number }>()

let hushed = (space: Space, app: App) => {
  let key = `${space.slug}/${app.slug}`
  let minute = Math.floor(Date.now() / 60_000)
  let hit = pushed.get(key)
  if (!hit || hit.minute != minute) {
    pushed.set(key, { minute, n: 1 })
    return false
  }
  return ++hit.n > PUSHES
}

// Whose a space is, as a failure's `account` tag: `test` when every member is
// a test account (lib/bots.ts), so the owner's letter says a probe broke, not
// a person's app. Asked once a space per ten minutes in an isolate; a lookup
// that fails leaves the tag off rather than guessing.
let owners = new Map<string, { until: number; account: string }>()
let ownedBy = async (env: Env, space: Space): Promise<string | undefined> => {
  let held = owners.get(space.eid)
  if (held && held.until > Date.now()) return held.account
  try {
    let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
    let members = await dir.members(space)
    let emails = await Promise.all(members.map((p) => dir.emailAt(p)))
    let account = members.length && emails.every((e) => isTestAddress(e ?? ''))
      ? 'test'
      : 'person'
    if (owners.size > 1000) owners.clear()
    owners.set(space.eid, { until: Date.now() + 600_000, account })
    return account
  } catch (why) {
    caught(why, { request: 'read whose a space is' })
    return undefined
  }
}

// Who was looking when an app broke: the person a signed-in session for this
// space names, read from the cookie alone. A visitor who is not signed in, or
// a request with no browser behind it, names nobody.
let viewing = async (env: Env, space: Space, request?: Request) => {
  if (!request) return undefined
  try {
    return (await sessionAt(request, env.SESSION_SECRET, space.eid))?.person
  } catch (why) {
    caught(why, { request: 'read who saw a break' })
    return undefined
  }
}

// App failures are immutable tracker occurrences. The queue chooses the
// independent space store by global eid; a failing app store cannot swallow its
// own report. Existing app-store rows remain readable by their published ids.
// Member stream pushes are a prompt notice; the tracked record remains the
// source for the reply rider and app_errors when no member was listening.
// Builds uses the same legacy exception shape for its retry receipt, which
// controls recovery rather than recording a second ordinary failure.
export type Breaks = (bundles: Bundle[]) => Promise<unknown>

// A failure that reached a person's app is the platform's to look at too,
// since yaks.app may have caused it: `yak admin errors` and heal read the
// platform's tracker. Its record there is its own occurrence and bug, never
// the space's: no space or app in `during`, so it groups by fault alone, and
// its release is the platform build, the app's version beside it. Archiving
// it there (the app's own code broke) leaves the owner's record open. Tagged
// `source: app`, the space's tracker writes the one letter.
let seenByPlatform = (
  error: Error,
  version: number | null | undefined,
  at: { env: Env; request?: Request; entrypoint?: string },
  reached: Record<string, string | undefined>,
) => {
  let place = origin(
    at.env.WORKER_NAME ?? 'yak',
    at.env.CF_VERSION_METADATA?.id,
    at.entrypoint ?? 'browser report',
    at.request,
  )
  return capture(error, {
    ...place,
    sink: () => {},
    version: version ?? undefined,
    environment: at.env.ENVIRONMENT == 'staging' ? 'staging' : 'production',
    during: { ...place.during, kind: 'exception' },
    tags: { ...place.tags, ...reached, source: 'app' },
  })
}

/** Workers Builds keeps its retry receipt in the directory's store. Ordinary
 * platform and app failures enter the tracker rather than this receipt log. */
export let metaBreaks = (env: Env): Breaks => (bundles) =>
  meta(env).apply(bundles, KERNEL)

export let noted = async (
  broke: {
    request: string
    requestId?: string
    version?: number | null
    message: string
    stack?: string
  },
  at: {
    env: Env
    space: Space
    app: App
    request?: Request
    script?: string
    entrypoint?: string
  },
) => {
  if (at) {
    if (!at.env.ERRORS) throw Error('tracker intake is unavailable')
    let error = Object.assign(Error(broke.message), {
      stack: broke.stack || '',
    })
    let place = origin(
      at.script ?? `${at.space.slug}/${at.app.slug}`,
      broke.version == null ? undefined : String(broke.version),
      at.entrypoint ?? 'browser report',
      at.request,
    )
    let account = await ownedBy(at.env, at.space)
    let viewer = await viewing(at.env, at.space, at.request)
    let reached = {
      space: at.space.slug,
      app: at.app.slug,
      request: broke.request,
      request_id: broke.requestId,
      ...account ? { account } : {},
      ...viewer ? { user_id: viewer } : {},
    }
    await queue(at.env.ERRORS)(capture(error, {
      ...place,
      commit: undefined,
      sink: () => {},
      version: broke.version ?? undefined,
      during: {
        ...place.during,
        space: at.space.eid,
        app: at.app.eid,
        kind: 'exception',
      },
      tags: { ...place.tags, ...reached },
    }))
    if (account == 'person') {
      await queue(at.env.ERRORS)(
        seenByPlatform(error, broke.version, at, reached),
      )
    }
  }
  if (hushed(at.space, at.app)) return
  try {
    let dir = directory(bound(at.env.DIRECTORY, dirPart.fetch, at.env))
    // The same line the unseen block will carry, minus the id — this seam
    // never reads its own write back, and the block has it.
    let data = `exception ${at.app.slug}${
      broke.version ? ` v${broke.version}` : ''
    }: ${broke.request} — ${broke.message}`
    for (let person of await dir.members(at.space)) {
      await told(at.env, person, 'notifications/message', {
        level: 'error',
        logger: `${at.space.slug}/${at.app.slug}`,
        data,
      })
    }
  } catch (why) {
    caught(why, { request: 'push a break' })
  }
}

/** A defect in the platform's own code, tagged at its catch. Builds keeps its
 * retry receipt separately; ordinary failures are records only in the tracker. */
export let fault = (
  _env: Env,
  request: string,
  e: unknown,
  tags: Record<string, string | null | undefined> = {},
  requestId?: string,
): Promise<void> => {
  defect(e, { request, ...tags, request_id: requestId })
  return Promise.resolve()
}

type Broke = {
  at?: string
  code?: string
  message?: string
  stack?: string | null
  request?: string
  version?: number | null
  // Occurrences one tracker sample stands for; none means one.
  hits?: number | null
}
type Hit = {
  kind: string
  tracked?: boolean
  // No number: an app's store does not load @yaks/id (vocab.ts), so a break
  // noted there is named by its eid, and `idOf` writes the short handle. The
  // directory numbers its own, and the same line reads both.
  entity: { eid: string; num?: number | null }
  doc?: { title?: string }
  content?: { body?: string }
  exception?: Broke
  error?: Broke
}
// The handle a person reads a break by: `E-12` where the directory numbered
// it, and @yaks/id's short handle (`#` and the eid's first ten hex digits)
// where an app's store did not. The letter is the facet's own first one
// (exception, error).
let idOf = (h: Hit) =>
  h.entity.num && !h.tracked
    ? `${h.kind.slice(0, 1).toUpperCase()}-${h.entity.num}`
    : short(h.entity.eid)

// One open item and the app it broke in — what serve() hands back, so a
// caller can write the line or archive by id from the one read.
export type Seen = { app: App; hit: Hit }

let broke = (h: Hit) => h.exception ?? h.error ?? {}

// Where a break happened, as its line names it: the file and line where there
// is one ({@link spot}), the route where there is not.
let where = (hit: Hit) => {
  let e = broke(hit)
  return spot(e.stack) || e.request || hit.doc?.title || e.code || ''
}

// What a break said.
let said = (hit: Hit) => broke(hit).message || hit.content?.body || ''

// What makes two occurrences one break: the same facet at the same place with
// the same message. A page that threw on every load is one thing to fix.
let same = (hit: Hit) =>
  `${hit.exception ? 'exception' : 'error'} ${where(hit)} ${said(hit)}`

let newest = (a: Seen, b: Seen) =>
  String(broke(b.hit).at ?? '').localeCompare(String(broke(a.hit).at ?? ''))

/** The occurrences gathered into breaks, newest first: each fold is one
 * break's occurrences, its newest first. */
export let folds = (seen: Seen[]): Seen[][] => {
  let by = new Map<string, Seen[]>()
  for (let s of [...seen].sort(newest)) {
    let key = `${s.app.eid} ${same(s.hit)}`
    by.set(key, [...by.get(key) ?? [], s])
  }
  return [...by.values()]
}

/** How many breaks these occurrences of one app make. */
export let breaks = (hits: Hit[]) => new Set(hits.map(same)).size

// How often one break happened, across its occurrences.
let often = (fold: Seen[]) =>
  fold.reduce((n, s) => n + (broke(s.hit).hits ?? 1), 0)

// One line a break: the newest occurrence's id and moment, the facet, the
// deploy, the place to open and the message, then how often it happened. An
// item written before exceptions carried their own request still reads: its
// doc's title said the same thing. The line is the only place anyone sees it
// now that an answer is bundles and nothing carries a second structured copy;
// its id archives the whole fold ({@link archive}).
export let line = (fold: Seen[]) => {
  let { app, hit } = fold[0]
  let e = broke(hit)
  let times = often(fold)
  let first = broke(fold.at(-1)!.hit).at
  return `- ${idOf(hit)} ${e.at ?? ''} ${
    hit.exception ? 'exception' : 'error'
  } ${app.slug}${e.version ? ` v${e.version}` : ''}: ${where(hit)} — ${
    said(hit)
  }${times > 1 ? ` (${times} times${first ? ` since ${first}` : ''})` : ''}`
}

/** A break as its owner's dashboard shows it: what it said and where, in the
 * words its line says to their assistant, how often, and when it last did. */
export type Plain = { said: string; where: string; times: number; at: string }

export let plain = (fold: Seen[]): Plain => ({
  said: said(fold[0].hit),
  where: where(fold[0].hit),
  times: often(fold),
  at: String(broke(fold[0].hit).at ?? ''),
})

// The place in a stack a person opens to fix it. A break reported from a
// browser arrives as `<source>:<line>` already (public/report.js through
// apps.ts `broken`); one thrown in a page's own code arrives as a JS stack,
// whose frames say the same with a column after them.
//
// Only an address counts — a file the app serves, `/recipes/index.html:42`.
// A break on the way in has a stack too, but its frames are inside the
// kernel's own bundle, and `…/.wrangler/tmp/dev-Z7MP9l/index.js:12341` is
// not a place the person can open. No spot leaves the card its request,
// which for a route that threw is the useful half anyway.
let AT = /([^\s()]+?):(\d+)(?::\d+)?(?=[^\d/]|$)/

// A release serves its files below `api/assets/<release>/` (asset_url.ts), and
// the person wrote `app.js`, not that: the place names the file they open.
let RELEASED = /\/api\/assets\/[0-9a-f-]{36}\//

export let spot = (stack?: string | null) => {
  for (let l of (stack ?? '').split('\n')) {
    let m = AT.exec(l)
    if (!m) continue
    let at
    try {
      at = new URL(m[1])
    } catch {
      continue
    }
    if (at.protocol != 'https:' && at.protocol != 'http:') continue
    return `${at.pathname.replace(RELEASED, '/')}:${m[2]}`
  }
  return ''
}

// The space's apps, asked of the directory the way apps.ts asks it.
let appsOf = (env: Env, space: Space) =>
  directory(bound(env.DIRECTORY, dirPart.fetch, env)).apps(space)

// One app's store in the graph's own wire, with this caller vouched: what a
// mark is written through, and what an open item is read out of.
let graphAt = (env: Env, space: Space, app: App, who: Who) => {
  let store = appStore(env.STORE, space, app, env)
  return {
    query: (line: string) =>
      metaOf(store, { ...vouched(who), 'x-yak-observe': '1' }).query(line),
    mark: async (hits: Hit[], mark: 'notified' | 'archived') => {
      let legacy = hits.filter((h) => !h.tracked)
      let tracked = hits.filter((h) => h.tracked)
      await Promise.all([
        ...legacy.length
          ? [
            metaOf(store).apply(
              legacy.map((h) => ({
                entity: { eid: h.entity.eid },
                [mark]: {},
              })),
              { ...vouched(who), ...KERNEL },
            ),
          ]
          : [],
        ...tracked.length
          ? [
            errorsAt(env, space, app, who).mark(
              tracked as unknown as Bundle[],
              mark,
            ),
          ]
          : [],
      ])
    },
  }
}

// Open tracker occurrences, plus the translation for pre-tracker published
// ids. Unseen only unless `all`; all independent doors are read together.
export let openIn = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  all = false,
) => {
  // A trashed store is dormant; its errors return with the app on restore.
  if (app.trashed || space.trashed) return []
  let seen = all ? '' : '&!notified'
  let at = graphAt(env, space, app, who)
  try {
    let found = await Promise.all([
      // Published ids still name pre-tracker rows in their original app store.
      // New reports never write there; this translation preserves old handles.
      ...['exception', 'error'].map(async (facet) =>
        (await at.query(`.${facet}&?doc&?content&!archived${seen}`))
          .map((b) => ({ kind: facet, ...b }) as unknown as Hit)
      ),
      errorsAt(env, space, app, who).read(all).then((rows) =>
        rows.map(trackedHit)
      ),
    ])
    return found.flat()
  } catch (e) {
    throw new Error(`${app.slug}: ${e instanceof Error ? e.message : e}`)
  }
}

// A tracker occurrence in the shape a line and an archive read.
let trackedHit = (row: Bundle): Hit => {
  let error = row.error as Record<string, unknown>
  let exception = row.exception as Record<string, unknown> | undefined
  let tags = error.tags as Record<string, unknown> | undefined
  let broke = {
    at: error.at,
    hits: error.hits,
    version: error.version,
    request: tags?.request,
    code: error.code,
    message: exception?.value || error.message ||
      (row.content as Record<string, unknown> | undefined)?.body || '',
    stack: exception?.stack,
  }
  return {
    ...row,
    tracked: true,
    kind: exception ? 'exception' : 'error',
    ...exception ? { exception: broke } : { error: broke },
  } as unknown as Hit
}

/** Every app's open occurrences in a space, by app eid, from one read of the
 * space's tracker. A listing or a reply that spans the space reads this and
 * no app's store: an app nobody uses stays asleep, and its month's requests
 * are its visitors' alone (T-123502). The rows an app's own store keeps
 * (pre-tracker breaks, its transcripts' errors) are read where one app is
 * named: `app_errors`, an archive, a deploy. */
export let trackedIn = async (
  env: Env,
  space: Space,
  who: Who,
  all = false,
) => {
  let by = new Map<string, Hit[]>()
  if (space.trashed) return by
  for (let row of await errorsIn(env, space, who).read(all)) {
    let app = String((row.during as { app?: unknown }).app)
    by.set(app, [...by.get(app) ?? [], trackedHit(row)])
  }
  return by
}

/** Each of these apps' open breaks in plain words, by app eid: what the
 * owner's dashboard shows. It reads what `app_list` counts ({@link trackedIn})
 * and marks nothing, so their assistant still hears of each one. */
export let brokenIn = async (
  env: Env,
  space: Space,
  who: Who,
  apps: App[],
) => {
  let open = await trackedIn(env, space, who, true)
  return new Map(
    apps.filter((a) => open.has(a.eid)).map((app) => [
      app.eid,
      folds(open.get(app.eid)!.map((hit) => ({ app, hit }))).map(plain),
    ]),
  )
}

// Errors from code other than the live version remain readable but do not
// interrupt a reply. Version order says nothing about which bytes run.
export let past = (app: { version?: number | null }, h: Hit) => {
  let was = broke(h).version
  return was == null || was != (app.version ?? 0)
}

// Serve, then mark: what is open, and `notified` on each item that had
// none, so the next reply is quiet about them. The mark is the platform's own
// stamp, so it rides the kernel's door — a viewer who may read an app's breaks
// is not thereby a writer of it.
//
// `all` is the difference between the two callers: `app_errors` asks for the
// whole open list and gets it, while the rider asks for what is news and gets
// the fresh ones only. A stale break is still stamped here — it was offered
// and passed over, and offering it again on the next reply would be the same
// noise a reply later.
//
// Named, one app is read whole ({@link openIn}). Unnamed is the rider, which
// rides every write in the space: it reads the space's tracker once
// ({@link trackedIn}) and wakes no app's store. An app's own rows are never
// news to it: they are breaks from before the tracker, long since offered, or
// its transcripts' errors, which name no version ({@link past}).
/** Begin reading what {@link serve} will tell about this space, while a write
 * there goes on: serve asks again and is handed this reading, unless the
 * request wrote to the space's tracker in between (app-errors.ts, hops.ts
 * `recall`). A failure here is serve's to meet when it asks. */
export let foresee = (env: Env, space: Space, who: Who) =>
  void trackedIn(env, space, who).catch(() => {})

export let serve = async (
  env: Env,
  space: Space,
  who: Who,
  app?: App,
  all = false,
) => {
  if (app) {
    return offered(
      env,
      space,
      who,
      app,
      await openIn(env, space, app, who, all),
      all,
    )
  }
  let open = await trackedIn(env, space, who, all)
  if (!open.size) return []
  let each = await Promise.all(
    (await appsOf(env, space)).filter((a) => !a.trashed && open.has(a.eid))
      .map((a) => offered(env, space, who, a, open.get(a.eid)!, all)),
  )
  return each.flat()
}

let offered = async (
  env: Env,
  space: Space,
  who: Who,
  app: App,
  hits: Hit[],
  all: boolean,
): Promise<Seen[]> => {
  let fresh = hits.filter((h) => !('notified' in h))
  if (fresh.length) await graphAt(env, space, app, who).mark(fresh, 'notified')
  let said = all ? hits : hits.filter((h) => !past(app, h))
  return said.map((hit) => ({ app, hit }))
}

// Closed: the mark that stops an item showing, here and in the unseen
// section.
let close = async (env: Env, space: Space, app: App, who: Who, hits: Hit[]) => {
  await graphAt(env, space, app, who).mark(hits, 'archived')
  return hits.length
}

// A day on its own, and anything that starts with one — `2026-08-14`, or the
// whole instant a line printed. Only these are read as a moment, so a uuid or
// an `E-84` can never be mistaken for one.
let WHEN = /^\d{4}-\d{2}-\d{2}([T ].*)?$/
let DAY = /^\d{4}-\d{2}-\d{2}$/
let VERSION = /^v(\d+)$/i

// A bound as a moment: a bare day means the end of it, because "everything
// through the 14th" is what a person says and midnight is not what they mean.
let moment = (word: string) =>
  Date.parse(DAY.test(word) ? `${word}T23:59:59.999Z` : word)

// One word of what a caller says is behind them, against one open break.
//
// An id is the plainest — the human id off a line, or an eid a card carries,
// since a card names every eid in its fold. But listing ids is
// exactly what nobody can do cheaply when a page filed six breaks for a file
// that did not exist yet (T-34338), so a word may be a bound instead, and one
// word closes the lot: `all`, `v<n>` for everything up to and including that
// deploy, or a day or an instant for everything at or before it.
//
// A break naming no version, or no moment, goes with any bound of its kind: it
// predates the counter, and nothing can ever say whether it is still true —
// the rule {@link healed} already keeps.
export let named = (word: string, h: Hit) => {
  if (word == 'all') return true
  let v = VERSION.exec(word)
  if (v) {
    let was = broke(h).version
    return was == null || was <= Number(v[1])
  }
  if (WHEN.test(word)) {
    let at = Date.parse(broke(h).at ?? '')
    return !Number.isFinite(at) || at <= moment(word)
  }
  return word == h.entity.eid ||
    word == idOf(h)
}

// Behind us, so it stops showing — whether the caller fixed it or is only
// saying it is stale. Nothing matched is worth saying; a stale id is how a
// person learns it is already archived.
export let archive = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  words: string[],
) => {
  let open = await openIn(env, space, app, who, true)
  // An id names its break, and the line it came off speaks for the whole
  // fold ({@link line}), so every occurrence of that break goes with it. A
  // bound stays a bound.
  let ids = new Set(
    open.filter((h) => words.some((w) => w == h.entity.eid || w == idOf(h)))
      .map(same),
  )
  let hits = open.filter((h) =>
    ids.has(same(h)) || words.some((w) => named(w, h))
  )
  if (!hits.length) {
    throw refuse('missing', `nothing open here by ${words.join(', ')}`)
  }
  await close(env, space, app, who, hits)
  return breaks(hits)
}

// And fixed by a release, which is how a break usually ends. D-32318 §Errors,
// verbatim: "One is open until a later deploy stops producing it or the agent
// marks it fixed." The code that produced it is not what serves any more, so
// every deploy, install and rollback closes what other versions broke
// (tools.ts `released`); a break the new code still produces is written again
// the next time it happens, and `app_list`'s open count follows either way.
// A break that names no version at all predates the counter, and goes with
// them — nothing else can ever say whether it is still true.
export let healed = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  version: number,
) => {
  let old = (await openIn(env, space, app, who, true)).filter((h) => {
    let was = broke(h).version
    return was == null || was != version
  })
  if (!old.length) return 0
  await close(env, space, app, who, old)
  // Counted as the lines app_errors said them: breaks, not occurrences.
  return breaks(old)
}

// The section a tool reply carries: nothing when nothing is unseen. Its last
// line says what ends them, because the write it rides is often the fix: a
// page that failed to load a script before the script existed rides the very
// write that adds it (E-34329, T-34338). The next deploy closes them
// ({@link healed}), so nothing needs a call to say they are stale.
let ENDS = 'Each is said once. The next deploy closes them, and the new code ' +
  "reports again any it still makes; app_errors(seen: ['all']) closes them " +
  'without one.'

export let unseenBlock = (seen: Seen[]) =>
  seen.length
    ? `\n\n## unseen errors\n${folds(seen).map(line).join('\n')}\n${ENDS}`
    : ''

// Where the space stands against its ceilings, said once (T-32758), in the
// line app_list says for the space (meter.ts `gauged`). It rides this channel
// because it is the same kind of news as a break — something the agent has to
// know and nobody said — and it wears the same mark: `notified`, here on the
// space itself, cleared by the hourly sweep when the standing moves
// (usage.ts). So the agent hears a line when it is news, and not on every
// reply after. Nothing is said while a space is under 80% of every ceiling.
export let ceiling = async (env: Env, space: Space) => {
  let apps = await appsOf(env, space)
  if (space.told || level(space, apps.length) == 'ok') return ''
  await stamp(env, { entities: [{ entity: { eid: space.eid }, notified: {} }] })
  return `\n\n## ceiling\n${space.slug}: ${
    gauged(space, apps.length, new Date(), env)
  }`
}
