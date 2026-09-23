// What broke that the person's agent has not heard yet (D-32318 §Errors,
// T-32362): the open `exception` and `error` entities across a space's app
// stores, one line each, and the mark that they were served. The comms bus
// in this graph stamps `notified` on each line it delivers (client.ts
// notices()); this does the same, so an item rides one reply and then only
// `app_errors` shows it again. Open means not `archived`: a later deploy
// ({@link healed}), a write of the file it named ({@link rewrote}), or the
// agent saying so ({@link archive}) archives it.
// Reads and marks go through the store's own doors with the caller vouched,
// never SQL; the apps of a space come from the directory part. The same
// rows are the `app_errors` answer, one line each.
import type { Bundle } from '@yaks/graph'
import * as dirPart from './directory.ts'
import {
  type App,
  appStore,
  directory,
  type Space,
  stamp,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import { told } from './stream.ts'
import { level, standing } from './meter.ts'
import { caught, defect } from './sentry.ts'
import { refuse } from './tool.ts'

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
// or a 5xx (`failed` below).
//
// Where there is no status — a kernel part that relayed a door's no by
// throwing what it was answered (index.ts's catch-all) — the answer's own
// shape stands in for it: every door here says a no one way, a body
// carrying `{"error":{"code":…}}`, and what fell over never wears it.
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

// The version the app is serving, read past the directory's read cache
// (directory.ts `FRESH`). A break names the deploy it happened on, and the
// likeliest moment for one is right after a deploy — when the isolate serving
// the app is still holding the version from before the bump, so the ninth
// user test's first throw said `weather v1` while the deploy had answered v2
// (C-32869 item 4). The App the request was routed with is the fallback: a
// directory that cannot answer must not swallow the break.
export let serving = async (env: Env, space: Space, app: App) => {
  try {
    let now = await directory(bound(env.DIRECTORY, dirPart.fetch, env))
      .app(space, app.slug, true)
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

// One break, written where the person's agent reads it: the `exception`
// facet, and nothing else. It carries what was being served, the deploy it
// happened on, the message and the stack. Server-owned, so it rides the
// kernel flag into apply()'s server-writer mode; the shape is the wire's own
// entity literal.
//
// Whose break it is, is the caller's to know, and only three callers can
// (T-33234). An app's store takes one from the two places the app's own code
// was running — its worker, which threw or answered a 5xx (dispatch.ts `ran`),
// and its page, which reported its own (apps.ts `/report`). The META store
// takes everything the platform hit in its own code ({@link fault}),
// including on a route that names an app: a DO eviction, our storage, our
// routing, our dispatch. Nothing here decides that, and nothing should try:
// the message never says whose code it was.
//
// A break in a space's app is also pushed as it lands (T-33006, V-32361):
// `notifications/message` to each member's stream, for whoever is connected
// and idle — MCP's logging door, declared in initialize (mcp.ts). The push
// marks nothing: served-in-a-reply stays the only `notified`, so the unseen
// block still carries the break for whoever was not listening, and a
// notification nobody read buries nothing. A push that fails, or one over
// the app's minute ceiling, is telemetry — the entity is already written.
//
// It wore a `doc` until T-32533, and that put the platform's own crashes in
// `.doc!` — the query a person's agent is taught as "everything you saved" —
// where one showed up in a recipe box as a recipe (C-32531 item 1).
// Where a break is written: one bundle, under the kernel flag, because an
// `exception` is wholly server-owned. The platform's own breaks go to the meta
// store ({@link metaBreaks}); an app's go to that app's store.
export type Breaks = (bundles: Bundle[]) => Promise<unknown>

/** The platform's own breaks: the directory's store, in the graph's wire. An
 * app's breaks go to that app's own store the same way — `metaOf(door).apply`
 * at the call site — because it is the same Store class and the same wire. */
export let metaBreaks = (env: Env): Breaks => (bundles) =>
  meta(env).apply(bundles, KERNEL)

export let noted = async (breaks: Breaks, broke: {
  request: string
  version?: number | null
  message: string
  stack?: string
}, at?: { env: Env; space: Space; app: App }) => {
  await breaks([{
    entity: { eid: '$broke' },
    exception: {
      at: new Date().toISOString(),
      request: broke.request,
      version: broke.version ?? null,
      message: broke.message,
      stack: broke.stack ?? '',
    },
  }])
  if (!at || hushed(at.space, at.app)) return
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

/** A defect in the platform's own code (T-33234): sent to Sentry with its
 * tags, and written to the meta store where the platform's breaks are read.
 * Awaited, so the entity exists by the time the caller answers; failing to
 * write it is telemetry, never a second failure to serve. */
export let fault = async (
  env: Env,
  request: string,
  e: unknown,
  tags: Record<string, string | null | undefined> = {},
) => {
  defect(e, { request, ...tags })
  await noted(metaBreaks(env), {
    request,
    message: e instanceof Error ? e.message : String(e),
    stack: e instanceof Error ? e.stack ?? '' : '',
  }).catch((why) => caught(why, { request: `file ${request}` }))
}

type Broke = {
  at?: string
  message?: string
  stack?: string
  request?: string
  version?: number | null
}
type Hit = {
  kind: string
  // No number: an app's store does not load @yaks/id (vocab.ts), so a break
  // noted there is named by its eid, and `idOf` writes the short handle. The
  // directory numbers its own, and the same line reads both.
  entity: { eid: string; num?: number | null }
  doc?: { title?: string }
  exception?: Broke
  error?: Broke
}

// The handle a person reads a break by: `E-12` where the directory numbered
// it, `E#` and the eid's first ten hex digits where an app's store did not.
// The letter is the facet's own first one (exception, error).
let idOf = (h: Hit) => {
  let letter = h.kind.slice(0, 1).toUpperCase()
  return h.entity.num
    ? `${letter}-${h.entity.num}`
    : `${letter}#${h.entity.eid.replaceAll('-', '').slice(0, 10).toLowerCase()}`
}
// One open item and the app it broke in — what serve() hands back, so a
// caller can write the line or archive by id from the one read.
export type Seen = { app: App; hit: Hit }

let broke = (h: Hit) => h.exception ?? h.error ?? {}

// One line: id, when, the place to open, the deploy, the message. An item
// written before exceptions carried their own request still reads: its doc's
// title said the same thing.
//
// The place is the file and line where there is one ({@link spot}), the route
// where there is not — and the line is the only place anyone sees it now that
// an answer is bundles and nothing carries a second structured copy.
export let line = ({ app, hit }: Seen) => {
  let e = broke(hit)
  let id = idOf(hit)
  let facet = hit.exception ? 'exception' : 'error'
  let where = spot(e.stack) || e.request || hit.doc?.title || ''
  return `- ${id} ${e.at ?? ''} ${facet} ${app.slug}${
    e.version ? ` v${e.version}` : ''
  }: ${where} — ${e.message ?? ''}`
}

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

export let spot = (stack = '') => {
  for (let l of stack.split('\n')) {
    let m = AT.exec(l)
    if (!m) continue
    let at
    try {
      at = new URL(m[1])
    } catch {
      continue
    }
    if (at.protocol != 'https:' && at.protocol != 'http:') continue
    return `${at.pathname}:${m[2]}`
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
      metaOf((path, init, headers) =>
        store(path, init, { ...vouched(who), ...headers })
      ).query(line),
    mark: (hits: Hit[], mark: 'notified' | 'archived') =>
      metaOf(store).apply(
        hits.map((h) => ({ entity: { eid: h.entity.eid }, [mark]: {} })),
        { ...vouched(who), ...KERNEL },
      ),
  }
}

// The open items of one app: both facets, unseen only unless `all`. A hit wears
// the facet as its `kind`, which is what an id is built from (`line`).
//
// Two reads because they are two tables and the filter grammar has no
// alternation — but one round trip, since the second never needed the first's
// answer. Asked in turn, a listing over a person's apps paid the app store's
// latency twice per app (T-35431).
export let openIn = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  all = false,
) => {
  let seen = all ? '' : '&.notified='
  let at = graphAt(env, space, app, who)
  try {
    let found = await Promise.all(
      ['exception', 'error'].map(async (facet) =>
        (await at.query(`.${facet}!&.doc?&.archived=${seen}`))
          .map((b) => ({ kind: facet, ...b }) as unknown as Hit)
      ),
    )
    return found.flat()
  } catch (e) {
    throw new Error(`${app.slug}: ${e instanceof Error ? e.message : e}`)
  }
}

// What the app has already moved past, for the rider only (T-34338). A break
// names the version it happened on, read past the directory's cache
// ({@link serving}), so one naming a version under the app's own was produced
// by code a later release replaced — `healed` archived its cohort at that
// release and this one only arrived afterwards. A break naming no version at
// all predates the counter and goes with them.
//
// It stays open, and `app_errors` still lists it: this decides only what is
// worth interrupting a reply with. Unseen means unheard, not merely unstamped,
// and news about code that no longer runs is neither.
export let past = (app: { version?: number | null }, h: Hit) => {
  let was = broke(h).version
  return was == null || was < (app.version ?? 0)
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
export let serve = async (
  env: Env,
  space: Space,
  who: Who,
  app?: App,
  all = false,
) => {
  let apps = app ? [app] : await appsOf(env, space)
  let seen: Seen[] = []
  for (let a of apps) {
    let hits = await openIn(env, space, a, who, all)
    let said = all ? hits : hits.filter((h) => !past(a, h))
    seen.push(...said.map((hit) => ({ app: a, hit })))
    let fresh = hits.filter((h) => !('notified' in h))
    if (!fresh.length) continue
    await graphAt(env, space, a, who).mark(fresh, 'notified')
  }
  return seen
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
  let hits = (await openIn(env, space, app, who, true)).filter((h) =>
    words.some((w) => named(w, h))
  )
  if (!hits.length) {
    throw refuse('missing', `nothing open here by ${words.join(', ')}`)
  }
  return close(env, space, app, who, hits)
}

// And fixed by a release, which is how a break usually ends. D-32318 §Errors,
// verbatim: "One is open until a later deploy stops producing it or the agent
// marks it fixed." The code that produced it is not what serves any more, so
// every deploy, install and rollback closes what the versions before it broke
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
    return was == null || was < version
  })
  return old.length ? close(env, space, app, who, old) : 0
}

// The app's own file a break happened on, if it names one. A request reads
// `<type> <path>` (apps.ts `broken`) where the path is the address as the
// browser asked for it — `page /recipes/app.js` — so the app's own name comes
// off the front and a directory answers with its index. An app serving the
// space's front page is asked for at the root, and its request carries no
// slug to strip.
export let fileOf = (slug: string, request = '') => {
  let at = request.split(' ').pop() ?? ''
  if (!at.startsWith('/')) return ''
  let head = `/${slug}/`
  let path = at == `/${slug}` || at.startsWith(head)
    ? at.slice(head.length)
    : at.slice(1)
  return path && !path.endsWith('/') ? path : `${path}index.html`
}

// And fixed by a write, which is the other way a break ends without anyone
// saying so (T-34338). An app's files serve live — a write is the fix, with
// the deploy only naming it — so a break open against a path this write just
// changed was produced by bytes that are not there any more. That is the same
// bargain {@link healed} makes, and it is why six "failed to load app.js" from
// before app.js existed stop riding along the moment app.js is written: a
// break the new bytes still produce is written again the next time it happens.
export let rewrote = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  paths: string[],
) => {
  let want = new Set(paths.map((p) => p.replace(/^\/+/, '')))
  let old = (await openIn(env, space, app, who, true)).filter((h) => {
    let file = fileOf(app.slug, broke(h).request)
    return !!file && want.has(file)
  })
  return old.length ? close(env, space, app, who, old) : 0
}

// The section a tool reply carries: nothing when nothing is unseen.
export let unseenBlock = (seen: Seen[]) =>
  seen.length ? `\n\n## unseen errors\n${seen.map(line).join('\n')}` : ''

// Where the space stands against its ceilings, said once (T-32758). It rides
// this channel because it is the same kind of news as a break — something the
// agent has to know and nobody said — and it wears the same mark: `notified`,
// here on the space itself, cleared by the hourly sweep when the standing
// moves (usage.ts). So the agent hears a line when it is news, and not on
// every reply after. Nothing is said while a space is under 80% of every
// ceiling.
export let ceiling = async (env: Env, space: Space) => {
  let apps = await appsOf(env, space)
  if (space.told || level(space, apps.length) == 'ok') return ''
  await stamp(env, { entities: [{ entity: { eid: space.eid }, notified: {} }] })
  return `\n\n## ceiling\n${standing(space, apps.length, new Date(), env)}`
}
