// What broke that the person's agent has not heard yet (D-32318 §Errors,
// T-32362): the open `exception` and `error` entities across a space's app
// stores, one line each, and the mark that they were served. The comms bus
// in this graph stamps `notified` on each line it delivers (client.ts
// notices()); this does the same, so an item rides one reply and then only
// `app_errors` shows it again. Open means not `archived`: a later deploy
// that stops producing it, or the agent marking it fixed, archives it.
// Reads and marks go through the store's own doors with the caller vouched,
// never SQL; the apps of a space come from the directory part.
import { idOf } from '../../src/types.ts'
import * as dirPart from './directory.ts'
import { type App, directory, type Space, storeName } from './directory.ts'
import { bound, type Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { type Door, storeOf } from './store.ts'

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

// One line: id, when, the route it happened on, the deploy, the message. An
// item written before exceptions carried their own request still reads: its
// doc's title said the same thing.
let line = (app: App, h: Hit) => {
  let e = h.exception ?? h.error ?? {}
  let id = idOf({ eid: h.entity.eid, kind: h.kind, num: h.entity.num })
  let facet = h.exception ? 'exception' : 'error'
  let where = e.request ?? h.doc?.title ?? ''
  return `- ${id} ${e.at ?? ''} ${facet} ${app.slug}${
    e.version ? ` v${e.version}` : ''
  }: ${where} — ${e.message ?? ''}`
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
    let r = await store(`/query?.${facet}!&.archived=${seen}`, {}, vouched(who))
    if (!r.ok) throw new Error(`${app.slug}: ${await r.text()}`)
    hits.push(...await r.json() as Hit[])
  }
  return hits
}

// Serve, then mark: the lines for the reply, and `notified` on each item
// that had none, so the next reply is quiet about them.
export let serve = async (
  env: Env,
  space: Space,
  who: Who,
  app?: App,
  all = false,
) => {
  let apps = app ? [app] : await appsOf(env, space)
  let lines: string[] = []
  for (let a of apps) {
    let hits = await openIn(env, space, a, who, all)
    lines.push(...hits.map((h) => line(a, h)))
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
  return lines
}

// The section a tool reply carries: nothing when nothing is unseen.
export let unseenBlock = (lines: string[]) =>
  lines.length ? `\n\n## unseen errors\n${lines.join('\n')}` : ''
