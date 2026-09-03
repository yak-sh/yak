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
import { idOf } from '../../src/types.ts'
import * as dirPart from './directory.ts'
import {
  type App,
  directory,
  type Space,
  stamp,
  storeName,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { type Door, storeOf } from './store.ts'
import { level, standing } from './usage.ts'

// A refusal is NOT a break (C-32652 item 3, T-32655). Every door here answers
// a deliberate no in one shape — a 4xx carrying `{"error":{"code":…}}`: the
// app doors' `not_a_writer`/`not_a_reader` (apps.ts SAYS), identity's
// `unauthorized`, the store's own `method_not_allowed` — and the page that
// catches one is meant to ACT on it, since the guide teaches
// `e.signIn ? location = e.signIn`. A signed-out visitor clicking a button is
// the platform working, so it files nothing; the owner's only two open errors
// on the sixth user test were both that.
//
// The shape is the whole test: what fell over never wears it, and no 5xx here
// is written in it (a break answers `oops()`, which is a page).
export let refusal = (answer: string) => {
  try {
    let said = JSON.parse(answer) as { error?: { code?: unknown } }
    return typeof said?.error?.code == 'string'
  } catch {
    // Not JSON at all — a door that fell over, or an app's own 400.
    return false
  }
}

// One break, written where the person's agent reads it: the `exception`
// facet, and nothing else. It carries what was being served, the deploy it
// happened on, the message and the stack. Every source of one goes through
// here: a route that threw (index.ts) and a page that reported its own
// (apps.ts). Server-owned, so it rides the kernel flag into apply()'s
// server-writer mode; the shape is the wire's own entity literal.
//
// It wore a `doc` until T-32533, and that put the platform's own crashes in
// `.doc!` — the query a person's agent is taught as "everything you saved" —
// where one showed up in a recipe box as a recipe (C-32531 item 1).
export let noted = async (store: Door, broke: {
  request: string
  version?: number | null
  message: string
  stack?: string
}) => {
  let sent = await store('/apply', {
    method: 'POST',
    body: JSON.stringify({
      entities: [{
        exception: {
          at: new Date().toISOString(),
          request: broke.request,
          version: broke.version ?? null,
          message: broke.message,
          stack: broke.stack ?? '',
        },
      }],
    }),
  }, { 'x-yak-kernel': '1' })
  if (!sent.ok) throw new Error(`report refused: ${await sent.text()}`)
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

// The open items of one app: both facets, unseen only unless `all`.
export let openIn = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  all = false,
) => {
  let store = storeOf(env.STORE, storeName(space, app))
  let seen = all ? '' : '&.notified='
  let hits: Hit[] = []
  for (let facet of ['exception', 'error']) {
    let r = await store(
      `/query?.${facet}!&.doc?&.archived=${seen}`,
      {},
      vouched(who),
    )
    if (!r.ok) throw new Error(`${app.slug}: ${await r.text()}`)
    hits.push(...await r.json() as Hit[])
  }
  return hits
}

// Serve, then mark: what is open, and `notified` on each item that had
// none, so the next reply is quiet about them.
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
    let marked = await storeOf(env.STORE, storeName(space, a))('/apply', {
      method: 'POST',
      body: JSON.stringify(
        fresh.map((h) => ({ eid: h.entity.eid, name: 'notified', comp: {} })),
      ),
    }, vouched(who))
    if (!marked.ok) throw new Error(`${a.slug}: ${await marked.text()}`)
  }
  return seen
}

// Fixed, so it stops showing — here, in the unseen section, and in the view.
// An id is whatever the caller read: the human id off a line, or the eid a
// card carries, since the view's button hands back the whole fold. Nothing
// matched is worth saying; a stale id is how a person learns it is already
// archived.
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
  let done = await storeOf(env.STORE, storeName(space, app))('/apply', {
    method: 'POST',
    body: JSON.stringify(
      hits.map((h) => ({ eid: h.entity.eid, name: 'archived', comp: {} })),
    ),
  }, vouched(who))
  if (!done.ok) throw new Error(`${app.slug}: ${await done.text()}`)
  return hits.length
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
