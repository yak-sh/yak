// The payment provider's webhook doors: `/<via>/<door>` for each door the
// provider config.ts `payments` names lends (payments.ts), `via` the name it
// is lent under. The provider verifies what is posted there and reads it into
// the Worker's words (@yaks/host/payments `Heard`); a subscription that
// changed and a block of credit paid for are billing.ts's to apply, and
// anything that happened on a seller's account is sell.ts's. Nothing here names a provider, and the paths are the
// ones the provider was told, so nothing is registered with it again.
//
// It carries no `Origin` — this is server to server — and route.ts
// `sameOrigin` allows an absent Origin deliberately, which is what lets an
// event through the guard that separates spaces (index.ts, T-33118). A
// silently 403'd event is a plan that never activates, so origin_test.ts
// holds that open on purpose.
import type { Heard } from '@yaks/host/payments'
import { apply as subscribed, credited } from './billing.ts'
import { apply as shopped } from './sell.ts'
import { payments, via } from './payments.ts'
import { fault } from './unseen.ts'
import type { Env } from './env.ts'

/** Where the provider's doors are: every path under it is theirs to answer
 * or pass on. */
export let PREFIX = `/${via}/`

// The doors are on the open internet, so what they file has a ceiling: per
// isolate, per minute, the way unseen.ts caps a crash-looping page. Only a
// refusal that can mean our secret is wrong is filed at all (`ours`): a
// well-formed signature that does not match is worth seeing once and never a
// hundred times an hour, and a request with no signature is a stranger's.
let FILED = 6
let filed = new Map<string, { minute: number; n: number }>()

let hushed = (what: string) => {
  let minute = Math.floor(Date.now() / 60_000)
  let hit = filed.get(what)
  if (!hit || hit.minute != minute) {
    filed.set(what, { minute, n: 1 })
    return false
  }
  return ++hit.n > FILED
}

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

/** What one verified event did, which is what its door says back: the
 * provider ignores the body, and a person reading the logs does not. */
export let applied = (env: Env, heard: Heard): Promise<string> =>
  heard.about == 'subscription'
    ? subscribed(env, heard)
    : heard.about == 'purchase'
    ? credited(env, heard)
    : shopped(env, heard)

/**
 * The provider's door at this request's path, answered; null where it lends
 * none there. Until a door's secret is set it answers 503 in one sentence and
 * files that once a minute: what is missing is only what its events would
 * have told us, and the secret is the owner's to set (README.md).
 */
export let paymentDoor = async (
  req: Request,
  env: Env,
): Promise<Response | null> => {
  let path = new URL(req.url).pathname
  let name = path.slice(PREFIX.length)
  if (!path.startsWith(PREFIX) || name.includes('/')) return null
  let { doors } = await payments(env)
  if (!Object.hasOwn(doors, name)) return null
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', 'post the event here')
  }
  let where = `POST ${path}`
  let said = await doors[name](req)
  if (!said) {
    if (!hushed(`${name} unset`)) {
      await fault(
        env,
        where,
        new Error(
          `${path} has no secret to verify with — an event went unread`,
        ),
      )
    }
    return json(503, 'not_switched_on', 'this door is not switched on here')
  }
  if ('refused' in said) {
    if (said.ours && !hushed(`${name} ${said.refused}`)) {
      await fault(env, where, new Error(said.refused))
    }
    return json(400, 'bad_signature', said.refused)
  }
  // A failure past this line is ours, so it throws: index.ts files it and
  // answers a 5xx, and the provider delivers again. That is exactly what we
  // want for a store that was busy or a call to the provider that timed out.
  return Response.json({ received: true, did: await applied(env, said.heard) })
}
