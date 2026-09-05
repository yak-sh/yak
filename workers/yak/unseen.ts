// What broke that the person's agent has not heard yet (D-32318 §Errors,
// T-32362): the open `exception` and `error` entities across a space's app
// stores, one line each, and the mark that they were served. The comms bus
// in this graph stamps `notified` on each line it delivers (client.ts
// notices()); this does the same, so an item rides one reply and then only
// `app_errors` shows it again. Open means not `archived`: a later deploy
// that stops producing it, or the agent marking it fixed, archives it.
// Reads and marks go through the store's own doors with the caller vouched,
// never SQL; the apps of a space come from the directory part. The same
// rows fold into `cards` for the errors view (public/errors.html), where the
// person's own button archives one through `archive`.
import type { Bundle } from '@yaks/graph'
import { idOf } from '../../src/types.ts'
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
import type { Door } from './store.ts'
import { told } from './stream.ts'
import { level, standing } from './usage.ts'

// A refusal is NOT a break (C-32652 item 3, T-32655; C-32869 item 5) — one
// rule, read off whichever half of the answer the platform is holding.
//
// The STATUS is the rule. A 4xx is somebody's deliberate no: the app doors'
// `not_a_writer`/`not_a_reader` (apps.ts SAYS), identity's `unauthorized`,
// the store's `method_not_allowed` — and equally an app's own worker saying
// "no city by that name", or passing on the 401 an outside service gave it
// for a key its owner mistyped. Nobody's code fell over, and the page that
// catches one is meant to ACT on it, since the guide teaches
// `e.signIn ? location = e.signIn`. A break is what nobody chose: a throw,
// or a 5xx (`failed` below).
//
// Where there is no status — a kernel part that relayed a door's no by
// THROWING what it was answered (index.ts's catch-all) — the answer's own
// SHAPE stands in for it: every door here spells a no one way, a body
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

// The version the app is SERVING, read past the directory's read cache
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
  } catch {
    return app.version
  }
}

// The ceiling on what one app may PUSH down its members' streams in a
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
// WHOSE break it is, is the caller's to know, and only three callers can
// (T-33234). An APP's store takes one from the two places the app's own code
// was running — its worker, which threw or answered a 5xx (dispatch.ts `ran`),
// and its page, which reported its own (apps.ts `/report`). The META store
// takes everything the platform hit in its own code (index.ts `report`),
// including on a route that names an app: a DO eviction, our storage, our
// routing, our dispatch. Nothing here decides that, and nothing should try:
// the message never says whose code it was.
//
// A break in a space's app is also PUSHED as it lands (T-33006, V-32361):
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
// `exception` is wholly server-owned. The PLATFORM's own breaks go to the meta
// store ({@link metaBreaks}); an app's go to that app's store.
export type Breaks = (bundles: Bundle[]) => Promise<unknown>

/** The platform's own breaks: the directory's store, in the graph's wire. */
export let metaBreaks = (env: Env): Breaks => (bundles) =>
  meta(env).apply(bundles, KERNEL)

/** One app's breaks, through its own store's door — the same wire the meta
 * half speaks, because it is the same Store class (graph.ts). */
export let appBreaks = (store: Door): Breaks => (bundles) =>
  metaOf(store).apply(bundles, KERNEL)

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
    console.error('yak: could not push the break', why)
  }
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
  entity: { eid: string; num: number }
  doc?: { title?: string }
  exception?: Broke
  error?: Broke
}
// One open item and the app it broke in — what serve() hands back, so a
// caller can write the line, fold the cards, or archive by id from the one
// read.
export type Seen = { app: App; hit: Hit }

let broke = (h: Hit) => h.exception ?? h.error ?? {}

// One line: id, when, the route it happened on, the deploy, the message. An
// item written before exceptions carried their own request still reads: its
// doc's title said the same thing.
export let line = ({ app, hit }: Seen) => {
  let e = broke(hit)
  let id = idOf({ eid: hit.entity.eid, kind: hit.kind, num: hit.entity.num })
  let facet = hit.exception ? 'exception' : 'error'
  let where = e.request ?? hit.doc?.title ?? ''
  return `- ${id} ${e.at ?? ''} ${facet} ${app.slug}${
    e.version ? ` v${e.version}` : ''
  }: ${where} — ${e.message ?? ''}`
}

// The place in a stack a person opens to fix it. A break reported from a
// browser arrives as `<source>:<line>` already (public/report.js through
// apps.ts `broken`); one thrown in a page's own code arrives as a JS stack,
// whose frames say the same with a column after them.
//
// Only an ADDRESS counts — a file the app serves, `/recipes/index.html:42`.
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

// One card: a break as a person reads it, however many times it happened.
// The same message from the same place is ONE break — a render loop that
// throws every frame writes twenty rows and is one thing to fix — so the
// entities fold together and the card keeps all their eids, which is what
// the view's fixed button hands back to `fixed`.
export type Card = {
  eids: string[]
  app: string
  message: string
  where: string
  version: number | null
  count: number
  at: string
}

export let cards = (seen: Seen[]) => {
  let by = new Map<string, Card>()
  for (let { app, hit } of seen) {
    let e = broke(hit)
    let message = e.message ?? hit.doc?.title ?? ''
    let where = spot(e.stack) || e.request || hit.doc?.title || ''
    let key = `${app.slug}\n${message}\n${where}`
    let card = by.get(key)
    if (!card) {
      by.set(
        key,
        card = {
          eids: [],
          app: app.slug,
          message,
          where,
          version: e.version ?? null,
          count: 0,
          at: e.at ?? '',
        },
      )
    }
    card.eids.push(hit.entity.eid)
    card.count++
    // The card wears the LAST time it happened, and the deploy it happened
    // on then: a break that survived a release is news about that release.
    if ((e.at ?? '') >= card.at) {
      card.at = e.at ?? ''
      card.version = e.version ?? null
    }
  }
  return [...by.values()].sort((a, b) => a.at < b.at ? 1 : -1)
}

// The space's apps, asked of the directory the way apps.ts asks it.
let appsOf = (env: Env, space: Space) =>
  directory(bound(env.DIRECTORY, dirPart.fetch, env)).apps(space)

// One app's store in the graph's own wire, with this caller vouched: what a
// mark is written through, and what an open item is read out of.
let graphAt = (env: Env, space: Space, app: App, who: Who) => {
  let store = appStore(env.STORE, space, app)
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
// the facet as its `kind`, which is what an id is spelled from (`line`).
export let openIn = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  all = false,
) => {
  let seen = all ? '' : '&.notified='
  let hits: Hit[] = []
  for (let facet of ['exception', 'error']) {
    try {
      let found = await graphAt(env, space, app, who)
        .query(`.${facet}!&.doc?&.archived=${seen}`)
      hits.push(...found.map((b) => ({ kind: facet, ...b }) as unknown as Hit))
    } catch (e) {
      throw new Error(`${app.slug}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return hits
}

// Serve, then mark: what is open, and `notified` on each item that had
// none, so the next reply is quiet about them. The mark is the PLATFORM's own
// stamp, so it rides the kernel's door — a viewer who may read an app's breaks
// is not thereby a writer of it.
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
    seen.push(...hits.map((hit) => ({ app: a, hit })))
    let fresh = hits.filter((h) => !('notified' in h))
    if (!fresh.length) continue
    await graphAt(env, space, a, who).mark(fresh, 'notified')
  }
  return seen
}

// Closed: the mark that stops an item showing, here, in the unseen section,
// and in the view.
let close = async (env: Env, space: Space, app: App, who: Who, hits: Hit[]) => {
  await graphAt(env, space, app, who).mark(hits, 'archived')
  return hits.length
}

// Fixed, so it stops showing. An id is whatever the caller read: the human id
// off a line, or the eid a card carries, since the view's button hands back
// the whole fold. Nothing matched is worth saying; a stale id is how a person
// learns it is already archived.
export let archive = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  ids: string[],
) => {
  let want = new Set(ids)
  let hits = (await openIn(env, space, app, who, true)).filter((h) =>
    want.has(h.entity.eid) ||
    want.has(idOf({ eid: h.entity.eid, kind: h.kind, num: h.entity.num }))
  )
  if (!hits.length) throw new Error(`nothing open here by ${ids.join(', ')}`)
  return close(env, space, app, who, hits)
}

// And fixed by a RELEASE, which is how a break usually ends. D-32318 §Errors,
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
  return `\n\n## ceiling\n${standing(space, apps.length)}`
}
