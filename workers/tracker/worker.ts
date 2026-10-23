// The independent Worker routes authenticated reads/RPC, a public deployment
// canary, and trusted queue deliveries. It has no directory or yak binding.

import type { Bundle, Comp } from '@yaks/graph'
import { minted } from '@yaks/graph/identity'
import { sha256 } from '@yaks/graph/sha256'
import { bugEid } from '@yaks/tracker'
import { sign } from './auth.ts'
import { capture, caught, origin, queue } from '@yaks/tracker/report'
import { evicted, lost, opaque, retried } from '@yaks/durable-object'
import { platform } from './core.ts'
import { consume, type Message } from './queue.ts'
import { json } from './door.ts'
import type { Settings } from './object.ts'

export type Stub = {
  fetch: (request: Request) => Promise<Response>
  ingest: (rows: Bundle[]) => Promise<void>
  monitor: () => Promise<void>
  admitTrace: (scope: string, rows: Bundle[]) => Promise<unknown>
  ingestTrace: (rows: Bundle[]) => Promise<boolean>
}
export type Env = Omit<Settings, 'TRACKERS'> & {
  BUNDLE_HASH?: string
  REJECTED?: { send: (body: unknown) => Promise<void> }
  TRACKERS: { getByName: (scope: string) => Stub }
}
let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A deploy's canary is the content hash of its bundle and its nonce.
let receipt = (hash: string, nonce: string) => sha256(`${hash}|${nonce}`)
export let canary = (
  hash: string,
  version?: string,
  request?: Request,
  nonce: string = crypto.randomUUID(),
  at = new Date().toISOString(),
) => {
  let fault = `tracker-canary|${hash}`
  let eid = receipt(hash, nonce)
  let requestEid = sha256(`${eid}|request`)
  let context = origin(
    'yak-tracker',
    version,
    'fetch.canary',
    request,
    requestEid,
  )
  let error = Error(`tracker deploy canary ${hash}`)
  // Repeated synthetic captures carry no varying caller stack.
  delete error.stack
  let rows = capture(error, {
    sink: () => {},
    ...context,
    eid,
    at,
    fault,
  })
  // A deployment exercises grouping without notifying a synthetic bug.
  rows.push({ entity: { eid: bugEid('', fault) }, archived: {} })
  return rows
}
// A deploy whose canary did not arrive, filed on its bundle's own bug. Unlike
// the canary it is not archived, so its letter reaches an agent and the owner
// at once. Why is read here, never taken from the caller, and a receipt is one
// occurrence however often its report is sent.
export let missing = (
  hash: string,
  nonce: string,
  why: string,
  version?: string,
  request?: Request,
) => {
  let eid = sha256(`${receipt(hash, nonce)}|missing`)
  let error = Error(`tracker deploy ${hash} is unconfirmed: ${why}`)
  delete error.stack
  return capture(error, {
    sink: () => {},
    ...origin(
      'yak-tracker',
      version,
      'fetch.canary',
      request,
      sha256(`${eid}|request`),
    ),
    eid,
    fault: `tracker-deploy|${hash}`,
  })
}
// How long an admitted canary's grouping may wait for its run. Intake arms the
// object's alarm a second out, so a longer wait means the effect queue that
// alarm drives is not running under this bundle: a failure, not a delay.
export let STALL = 120_000
/** Where a deploy's canary stands: arrived, or why not, and whether that is a
 * failure of the deployed build or a wait still under way. */
export type Standing =
  | { arrived: true }
  | { arrived: false; failed: boolean; why: string }
// Read from the platform object's graph, never waited for: grouping is the
// alarm's work, so a canary that answered only once grouped would read a
// stalled queue as silence. Undefined is an object that could not answer.
let standing = async (
  ask: (path: string) => Promise<Response>,
  hash: string,
  eid: string,
  now: number,
): Promise<Standing | undefined> => {
  let waiting = (why: string): Standing => ({
    arrived: false,
    failed: false,
    why,
  })
  let failed = (why: string): Standing => ({
    arrived: false,
    failed: true,
    why,
  })
  // An object moves to a new version minutes after this Worker, so the
  // canary can arrive only once the object runs this bundle too. An object
  // from before the route answers 404 and is not there yet.
  let bundle = await ask('/bundle')
  if (bundle.status == 404) {
    return waiting('its Tracker object runs a release from before /bundle')
  }
  if (!bundle.ok) return
  let held = (await bundle.json()).hash
  if (held != hash) return waiting(`its Tracker object runs bundle ${held}`)
  // The canary and the run that groups it, in one read: a run deletes itself
  // as it groups, so one snapshot sees one or the other.
  let read = await ask(`/query?q=${
    encodeURIComponent(
      `.entity.eid=${eid} .error.fault="tracker-canary|${hash}" | ` +
        `.effect.handler=error_group .effect.target=${eid}`,
    )
  }`)
  if (!read.ok) return
  let rows: Bundle[] = await read.json()
  let canary = rows.find((row) => row.error)?.error as Comp | undefined
  let run = rows.find((row) => row.effect)?.effect as Comp | undefined
  if (!canary) return waiting('its canary never reached the object')
  if (canary.bug) return { arrived: true }
  if (!run) return waiting('its canary is ungrouped and owes no grouping run')
  if (run.error) return failed(`its grouping threw: ${run.error}`)
  let waited = now - Date.parse(String(run.next ?? run.at))
  return waited > STALL
    ? failed(
      `its grouping run waited ${
        Math.round(waited / 1000)
      } s for the object's effect queue`,
    )
    : waiting('its grouping run is due')
}
export let scopeOf = (url: URL) => {
  let scope = url.searchParams.get('scope')
  return scope == 'platform'
    ? platform
    : scope && uuid.test(scope)
    ? scope
    : null
}
/** A failure of this Worker, reported to its own queue with the entry that
 * met it. */
export let reporting = (env: Pick<Env, 'ERRORS' | 'CF_VERSION_METADATA'>) =>
(
  error: unknown,
  entrypoint: string,
  request?: Request,
  eid?: string,
) => {
  let context = origin(
    'yak-tracker',
    env.CF_VERSION_METADATA?.id,
    entrypoint,
    request,
    eid ? sha256(`${eid}|request`) : undefined,
  )
  return caught(error, {
    sink: env.ERRORS ? queue(env.ERRORS) : () => {},
    ...context,
    eid,
  })
}
export let worker = (
  env: Env,
  ticket: typeof sign = sign,
  now: () => number = Date.now,
) => {
  let report = reporting(env)
  // Every call into an object goes through here. The object can be reset, the
  // connection to it lost, or the runtime can refuse it with its own opaque
  // internal error while it moves the object, as it does to every object a
  // deploy reaches; each send takes a fresh stub and the same body. Every
  // door is a read or a write keyed by its eids, so a send that landed before
  // its answer was lost lands the same way again.
  let send = (scope: string, request: Request, body: ArrayBuffer | null) =>
    retried(
      () => env.TRACKERS.getByName(scope).fetch(new Request(request, { body })),
      true,
      (error) => evicted(error) || lost(error) || opaque(error),
    )
  // Where a receipt stands, asked through the object's stable read doors
  // across Worker/DO deployment propagation. The runtime holds its signing
  // key; the build learns only whether its canary arrived or failed.
  let stand = async (hash: string, eid: string) => {
    if (!env.TRACKER_SECRET) return
    let signed = await ticket({
      scope: platform,
      person: platform,
      admin: true,
      exp: Date.now() / 1000 + 60,
    }, env.TRACKER_SECRET)
    let headers = { authorization: `Bearer ${signed}` }
    return standing(
      (path) =>
        send(
          platform,
          new Request(`https://tracker.internal${path}`, { headers }),
          null,
        ),
      hash,
      eid,
      now(),
    )
  }
  return {
    fetch: async (request: Request): Promise<Response> => {
      let url = new URL(request.url)
      let scope = scopeOf(url)
      if (!scope) return json({ error: 'tracker global scope required' }, 400)
      try {
        if (url.pathname == '/canary' || url.pathname == '/canary/missing') {
          if (scope != platform) return json({ error: 'platform only' }, 403)
          let hash = url.searchParams.get('hash')
          if (!hash || !/^[0-9a-f]{64}$/.test(hash)) {
            return json({ error: 'bundle hash required' }, 400)
          }
          if (!env.BUNDLE_HASH) {
            return json({ error: 'bundle unavailable' }, 503)
          }
          if (hash != env.BUNDLE_HASH) {
            return json({ error: 'bundle is not deployed' }, 409)
          }
          if (url.pathname == '/canary/missing') {
            if (request.method != 'POST') {
              return json({ error: 'canary method denied' }, 405)
            }
            let nonce = url.searchParams.get('nonce')
            if (!nonce || !uuid.test(nonce)) {
              return json({ error: 'canary nonce required' }, 400)
            }
            let stood = await stand(hash, receipt(hash, nonce))
            if (!stood) return json({ error: 'tracker unavailable' }, 503)
            if (stood.arrived) return json({ error: 'canary arrived' }, 409)
            if (!env.ERRORS) return json({ error: 'queue unavailable' }, 503)
            let rows = missing(
              hash,
              nonce,
              stood.why,
              env.CF_VERSION_METADATA?.id,
              request,
            )
            await env.ERRORS.send(rows)
            return json({ eid: rows[0].entity.eid })
          }
          if (request.method == 'GET') {
            let eid = url.searchParams.get('eid')
            if (!eid || !minted(eid)) {
              return json({ error: 'canary receipt required' }, 400)
            }
            let stood = await stand(hash, eid)
            if (!stood) return json({ error: 'tracker unavailable' }, 503)
            return json(
              stood.arrived
                ? { arrived: true }
                : { arrived: false, ...stood.failed ? { failed: true } : {} },
            )
          }
          if (request.method != 'POST') {
            return json({ error: 'canary method denied' }, 405)
          }
          let nonce = url.searchParams.get('nonce')
          let at = url.searchParams.get('at')
          let date = at ? Date.parse(at) : NaN
          if (
            !nonce || !uuid.test(nonce) || !at || !Number.isFinite(date) ||
            date < now() - 15 * 60_000 || date > now() + 60_000 ||
            new Date(date).toISOString() != at
          ) {
            return json(
              { error: 'fresh canary nonce and timestamp required' },
              400,
            )
          }
          if (!env.ERRORS) return json({ error: 'queue unavailable' }, 503)
          let rows = canary(
            hash,
            env.CF_VERSION_METADATA?.id,
            request,
            nonce,
            at,
          )
          await env.ERRORS.send(rows)
          return json({ eid: rows[0].entity.eid })
        }
        // Only GET and HEAD carry no body; asking `request.body` instead
        // makes a stream to read, which a resend could not read again.
        let body = request.method == 'GET' || request.method == 'HEAD'
          ? null
          : await request.arrayBuffer()
        return await send(scope, request, body)
      } catch (error) {
        await report(error, 'fetch', request)
        return json({ error: 'tracker temporarily unavailable' }, 503)
      }
    },
    queue: (messages: Message[]) =>
      consume(
        messages,
        (scope) => env.TRACKERS.getByName(scope),
        (error) => report(error, 'queue'),
        async (message, error) => {
          if (!env.REJECTED) {
            throw Error('tracker dead letter queue unavailable')
          }
          await env.REJECTED.send(message.body)
          // Queues can redeliver even an acknowledged message. One stable
          // occurrence keeps a repeated rejection from multiplying bug hits.
          let eid = sha256(
            `tracker|rejected|${message.id ?? JSON.stringify(message.body)}`,
          )
          await report(error, 'queue', undefined, eid)
        },
        (scope, rows) =>
          env.TRACKERS.getByName(platform).admitTrace(scope, rows),
      ),
    scheduled: async () => {
      try {
        await env.TRACKERS.getByName(platform).monitor()
      } catch (error) {
        await report(error, 'scheduled')
        throw error
      }
    },
  }
}
