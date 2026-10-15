// The independent Worker routes authenticated reads/RPC, a public deployment
// canary, and trusted queue deliveries. It has no directory or yak binding.

import type { Bundle } from '@yaks/graph'
import { minted } from '@yaks/graph/identity'
import { sha256 } from '@yaks/graph/sha256'
import { bugEid } from '@yaks/tracker'
import { sign } from './auth.ts'
import { capture, caught, origin, queue } from '@yaks/tracker/report'
import { evicted, lost, retried } from '@yaks/durable-object'
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
export let canary = (
  hash: string,
  version?: string,
  request?: Request,
  nonce: string = crypto.randomUUID(),
  at = new Date().toISOString(),
) => {
  let fault = `tracker-canary|${hash}`
  let eid = sha256(`${hash}|${nonce}`)
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
export let scopeOf = (request: Request) => {
  let url = new URL(request.url)
  let scope = url.searchParams.get('scope')
  return scope == 'platform'
    ? platform
    : scope && uuid.test(scope)
    ? scope
    : null
}
export let worker = (
  env: Env,
  ticket: typeof sign = sign,
  now: () => number = Date.now,
) => {
  let report = (
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
  return {
    fetch: async (request: Request): Promise<Response> => {
      let scope = scopeOf(request)
      if (!scope) return json({ error: 'tracker global scope required' }, 400)
      try {
        let url = new URL(request.url)
        if (url.pathname == '/canary') {
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
          if (request.method == 'GET') {
            let eid = url.searchParams.get('eid')
            if (!eid || !minted(eid)) {
              return json({ error: 'canary receipt required' }, 400)
            }
            if (!env.TRACKER_SECRET) {
              return json({ error: 'tracker unavailable' }, 503)
            }
            // Use the stable read door across Worker/DO deployment propagation.
            // The runtime holds its signing key; the build receives only a boolean.
            let signed = await ticket({
              scope: platform,
              person: platform,
              admin: true,
              exp: Date.now() / 1000 + 60,
            }, env.TRACKER_SECRET)
            let query = new URL('https://tracker.internal/query')
            query.searchParams.set(
              'q',
              `.entity.eid=${eid} .error.fault="tracker-canary|${hash}" .error.bug .limit=1`,
            )
            let object = env.TRACKERS.getByName(platform)
            let headers = { authorization: `Bearer ${signed}` }
            let response = await object.fetch(new Request(query, { headers }))
            if (!response.ok) {
              return json({ error: 'tracker unavailable' }, 503)
            }
            if ((await response.json()).length != 1) {
              return json({ arrived: false })
            }
            // An object moves to a new version minutes after this Worker, so
            // the canary has arrived only once the object runs this bundle too.
            // An object from before the route answers 404 and is not there yet.
            let bundle = await object.fetch(
              new Request('https://tracker.internal/bundle', { headers }),
            )
            return json({
              arrived: bundle.ok && (await bundle.json()).hash == hash,
            })
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
        // The object can be reset, or the connection to it lost, under a
        // call; each send takes a fresh stub and the same body. Every door is
        // a read or a write keyed by its eids, so a send that landed before
        // its answer was lost lands the same way again.
        let body = request.body && await request.arrayBuffer()
        return await retried(
          () =>
            env.TRACKERS.getByName(scope).fetch(new Request(request, { body })),
          true,
          (error) => evicted(error) || lost(error),
        )
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
