// An app telling its space's Operator something: `POST ./api/operator/tell`
// with `{say, key}`, from the app's own worker (`env.APP`). The words are a
// request on the Operator's `app` channel in the conversation of the space's
// owner, as a break to fix is (unseen.ts `fix`), and the key names it, so the
// same key told again is one request. A page cannot tell it: a visitor's
// words would spend the space's budget, so whatever a page may ask goes
// through the worker, which decides. When to tell is the app's own: a worker
// route its schedule calls (public/docs/wakes.md) or one a visitor reaches.
import { derivedEid } from '@yaks/graph/identity'
import type { Answer } from './apps.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { itsApp } from './dispatch.ts'
import { bound } from './env.ts'

/** The most a tell says, and the longest key it is named by. */
export let SAY = 4000
export let KEY = 200

export let tell: Answer = async ({ env, req, path, space, app, who, json }) => {
  if (path != '/operator/tell') return null
  if (req.method != 'POST') return json(405, 'method_not_allowed')
  if (!itsApp(who, app)) {
    return json(
      403,
      'not_the_app',
      "only the app's own worker tells its space's Operator",
    )
  }
  let sent = await req.json().catch(() => null) as
    | { say?: unknown; key?: unknown }
    | null
  let say = typeof sent?.say == 'string' ? sent.say.trim() : ''
  let key = typeof sent?.key == 'string' ? sent.key : ''
  if (!say || say.length > SAY || !key || key.length > KEY) {
    return json(
      400,
      'arguments',
      `tell says something (at most ${SAY} characters) and names it by a key (at most ${KEY})`,
    )
  }
  let [owner] = await directory(bound(env.DIRECTORY, dirPart.fetch, env))
    .owners(space)
  if (!owner) return json(404, 'no_owner', `${space.slug} has no owner to tell`)
  let { builderOf, SPACE } = await import('./build-door.ts')
  let r = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/receive', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-person': owner,
        [SPACE]: space.eid,
      },
      body: JSON.stringify({
        say: `The app ${app.slug} says: ${say}`,
        request: { channel: 'app', app: app.eid },
        options: { id: derivedEid(`operator-app|${app.eid}|${key}`) },
      }),
    })
  )
  let body = await r.json() as { request?: string; message?: string }
  if (!r.ok) {
    throw new Error(
      `the Operator refused an app's word (${r.status}): ${body.message}`,
    )
  }
  return Response.json({ request: body.request }, { status: r.status })
}
