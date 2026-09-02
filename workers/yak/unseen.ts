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
import type { App, Space } from './directory.ts'
import { bound, type Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { storeOf } from './store.ts'

type Hit = {
  kind: string
  entity: { eid: string; num: number }
  doc?: { title?: string }
  exception?: { at?: string; message?: string }
  error?: { at?: string; message?: string }
}

// One line: id, when, the route it happened on, the message.
let line = (app: App, h: Hit) => {
  let e = h.exception ?? h.error ?? {}
  let id = idOf({ eid: h.entity.eid, kind: h.kind, num: h.entity.num })
  let facet = h.exception ? 'exception' : 'error'
  return `- ${id} ${e.at ?? ''} ${facet} ${app.slug}: ${h.doc?.title ?? ''} — ${
    e.message ?? ''
  }`
}

// The space's apps, asked of the directory the way apps.ts asks it.
let appsOf = async (env: Env, space: Space): Promise<App[]> => {
  let via = bound(env.DIRECTORY, dirPart.fetch, env)
  let r = await via.fetch(
    new Request(`http://directory/query?.app.space=${space.eid}`),
  )
  if (!r.ok) throw new Error(`directory: ${await r.text()}`)
  let rows = await r.json() as {
    entity: { eid: string }
    app: { slug: string; space: string; version: number | null }
  }[]
  return rows.map((r) => ({ eid: r.entity.eid, ...r.app }))
}

// The open items of one app: both facets, unseen only unless `all`.
export let openIn = async (
  env: Env,
  space: Space,
  app: App,
  who: Who,
  all = false,
) => {
  let store = storeOf(env.STORE, space.slug, app.slug)
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
    let marked = await storeOf(env.STORE, space.slug, a.slug)('/apply', {
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
