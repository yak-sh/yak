// The independent Worker routes authenticated reads/RPC, a public deployment
// canary, and trusted queue deliveries. It has no directory or yak binding.

import type { Bundle, Comp } from '@yaks/graph'
import { minted } from '@yaks/graph/identity'
import { sha256 } from '@yaks/graph/sha256'
import { Unsigned } from '@yaks/host/senders'
import { sign } from './auth.ts'
import { capture, caught, origin, queue, type Sink } from '@yaks/tracker/report'
import { evicted, jittered, opaque, retried } from '@yaks/durable-object'
import { type Clock, system } from '@yaks/fp'
import { platform } from './core.ts'
import { consume, type Message } from './queue.ts'
import { json } from './door.ts'
import { lent } from './mail.ts'
import type { Settings } from './object.ts'
import type { Explanation } from '@yaks/tracker/resolution'

export type Stub = {
  fetch: (request: Request) => Promise<Response>
  ingest: (rows: Bundle[]) => Promise<void>
  monitor: () => Promise<void>
  admitTrace: (scope: string, rows: Bundle[]) => Promise<unknown>
  ingestTrace: (rows: Bundle[]) => Promise<boolean>
  settle: (
    eids: string[],
    reason?: string,
    said?: Explanation,
  ) => Promise<number>
  enroll: (scope: string) => Promise<void>
}
export type Env = Omit<Settings, 'TRACKERS'> & {
  BUNDLE_HASH?: string
  REJECTED?: { send: (body: unknown) => Promise<void> }
  TRACKERS: { getByName: (scope: string) => Stub }
}
let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A deploy's canary is the content hash of its bundle and its nonce.
let receipt = (hash: string, nonce: string) => sha256(`${hash}|${nonce}`)
/** A deploy's canary: one probe occurrence (@yaks/tracker `probe`), which
 * travels the queue, intake and grouping as a failure does and is no bug:
 * grouping writes its receipt, and no bug row, letter or knock follows. */
export let canary = (
  hash: string,
  version?: string,
  nonce: string = crypto.randomUUID(),
  at = new Date().toISOString(),
): Bundle[] => {
  let { tags, commit } = origin('yak-tracker', version, 'fetch.canary')
  let error = Error(`tracker deploy canary ${hash}`)
  // Repeated synthetic captures carry no varying caller stack.
  delete error.stack
  let [row] = capture(error, {
    sink: () => {},
    tags,
    commit,
    eid: receipt(hash, nonce),
    at,
    fault: `tracker-canary|${hash}`,
  })
  return [{ ...row, probe: {} }]
}
// A deploy whose canary did not arrive, filed on its bundle's own bug, which
// is a failure: its letter reaches an agent and the owner at once. Why is read
// here, never taken from the caller, and a receipt is one occurrence however
// often its report is sent.
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
type Ask = (path: string) => Promise<Response>
// What the platform object runs when it is not this bundle yet: an object
// moves to a new version minutes after this Worker. False is this bundle;
// undefined is an object that could not answer. An object from before the
// route answers 404 and is not there yet.
let lagging = async (
  ask: Ask,
  hash: string,
): Promise<string | false | undefined> => {
  let bundle = await ask('/bundle')
  if (bundle.status == 404) {
    return 'its Tracker object runs a release from before /bundle'
  }
  if (!bundle.ok) return
  let held = (await bundle.json()).hash
  return held != hash && `its Tracker object runs bundle ${held}`
}
// Read from the platform object's graph, never waited for: grouping is the
// alarm's work, so a canary that answered only once grouped would read a
// stalled queue as silence. Undefined is an object that could not answer.
let standing = async (
  ask: Ask,
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
  // The canary can arrive only once the object runs this bundle too.
  let lag = await lagging(ask, hash)
  if (lag == null) return
  if (lag) return waiting(lag)
  // The canary and the run that groups it, in one read: a run deletes itself
  // as it groups, so one snapshot sees one or the other.
  let read = await ask(`/query?q=${
    encodeURIComponent(
      `.entity.eid=${eid} .probe .error.fault="tracker-canary|${hash}" | ` +
        `.effect.handler=error_group .effect.target=${eid}`,
    )
  }`)
  if (!read.ok) return
  let rows: Bundle[] = await read.json()
  let canary = rows.find((row) => row.probe)?.probe as Comp | undefined
  let run = rows.find((row) => row.effect)?.effect as Comp | undefined
  if (!canary) return waiting('its canary never reached the object')
  if (canary.grouped) return { arrived: true }
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
/** A failure of this Worker, reported with the entry that met it: to its own
 * queue, or to the `sink` given. */
export let reporting = (
  env: Pick<Env, 'ERRORS' | 'CF_VERSION_METADATA'>,
  sink: Sink = env.ERRORS ? queue(env.ERRORS) : () => {},
) =>
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
  return caught(error, { sink, ...context, eid })
}
// The space trackers this isolate has enrolled in the platform's list, or is
// enrolling: one call a scope, however many reads arrive while it runs.
let enrolled = new Map<string, Promise<void>>()

/** Work the invocation keeps running after it answered: the runtime's
 * `waitUntil` in index.ts. */
export type Behind = (work: Promise<unknown>) => void

export let worker = (
  env: Env,
  ticket: typeof sign = sign,
  clock: Clock = system,
  behind: Behind = (work) => void work,
) => {
  let now = clock.now
  let wait = jittered(clock)
  let report = reporting(env)
  // Every call into an object goes through here, but trace admission, which
  // charges a budget and is sent once. The object can be reset, the
  // connection to it lost, or the runtime can refuse it with its own opaque
  // internal error while it moves the object, as it does to every object a
  // deploy reaches; each send takes a fresh stub. Every door is a read or a
  // write keyed by its eids, intake writes immutable rows and the monitor only
  // looks again, so a send that landed before its answer was lost lands the
  // same way again.
  let call = <T>(scope: string, use: (stub: Stub) => Promise<T>) =>
    retried(
      () => use(env.TRACKERS.getByName(scope)),
      true,
      (error) => evicted(error) || opaque(error),
      wait,
    )
  // What the queue's consumer could not take is told to the platform's object
  // itself, never through the queue it came from: sent back through intake it
  // is one more message for a refusing object to fail. An object that cannot
  // take the report either leaves it in this Worker's log, and the box's syncs
  // say from outside that the tracker is down.
  let told = reporting(
    env,
    (rows) => call(platform, (stub) => stub.ingest(rows)),
  )
  // A space tracker that took intake or answered a door joins the platform's
  // list of them, which every bug door reads (`/scopes`), once an isolate,
  // behind the answer: it is a second object's call, often 50 ms, that the
  // answer never needs. A failed enrolment is tried again by the next request,
  // and reported unless the platform's object still runs the release before
  // `enroll`, as it does for minutes after a deploy reaches this Worker.
  let enroll = (scope: string) => {
    if (scope == platform || enrolled.has(scope)) return
    let joining = call(platform, (stub) => stub.enroll(scope)).catch(
      async (error) => {
        enrolled.delete(scope)
        if (/does not implement the method/.test(String(error))) return
        await report(error, 'enroll')
      },
    )
    enrolled.set(scope, joining)
    behind(joining)
  }
  // An HTTP door, its body read again by each send. A request without one has
  // nothing a send uses up, so each send takes it as it is: in Deno, copying
  // a Request took longer than the rest of the send.
  let send = async (
    scope: string,
    request: Request,
    body: ArrayBuffer | null,
  ) => {
    let answer = await call(
      scope,
      (stub) => stub.fetch(body ? new Request(request, { body }) : request),
    )
    if (answer.ok) enroll(scope)
    return answer
  }
  // The platform object's stable read doors, asked across Worker/DO
  // deployment propagation. The runtime holds its signing key; the build
  // learns only whether its canary arrived or failed.
  let asking = async (): Promise<Ask | undefined> => {
    if (!env.TRACKER_SECRET) return
    let signed = await ticket({
      scope: platform,
      person: platform,
      admin: true,
      exp: Math.floor(now() / 1000) + 60,
    }, env.TRACKER_SECRET)
    let headers = { authorization: `Bearer ${signed}` }
    return (path) =>
      send(
        platform,
        new Request(`https://tracker.internal${path}`, { headers }),
        null,
      )
  }
  // Where a receipt stands.
  let stand = async (hash: string, eid: string) => {
    let ask = await asking()
    return ask && standing(ask, hash, eid, now())
  }
  return {
    fetch: async (request: Request): Promise<Response> => {
      let url = new URL(request.url)
      // A provider's notice about a letter, at `/mail/<via>`, is read by the
      // notices that provider lends (config.ts).
      let via = url.pathname.match(/^\/mail\/([a-z0-9-]+)$/)?.[1]
      let notices = via ? lent(env, 'notices') : {}
      let noticed = via && Object.hasOwn(notices, via) ? notices[via] : null
      let scope = noticed ? platform : scopeOf(url)
      if (!scope) return json({ error: 'tracker global scope required' }, 400)
      try {
        if (noticed && request.method == 'POST') {
          if (!env.TRACKER_SECRET) {
            throw new Error('Mail webhook is not configured')
          }
          let arrived
          try {
            arrived = await noticed(request)
          } catch (error) {
            if (error instanceof Unsigned) {
              return json({ error: error.message }, 401)
            }
            throw error
          }
          let target = arrived.tags?.yak_tracker, found = arrived.receipt
          if (!target || !found) return json({ ok: true })
          if (!uuid.test(target)) {
            throw new Error('Invalid tracker mail receipt scope')
          }
          let bearer = await ticket({
            scope: target,
            person: 'mail-receipt',
            admin: true,
            ingest: true,
            exp: Math.floor(now() / 1000) + 60,
          }, env.TRACKER_SECRET)
          let raw = new TextEncoder().encode(JSON.stringify(found)).buffer
          return await send(
            target,
            new Request('https://tracker.internal/mail/receipt', {
              method: 'POST',
              headers: {
                authorization: 'Bearer ' + bearer,
                'content-type': 'application/json',
              },
              body: raw,
            }),
            raw,
          )
        }
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
          let rows = canary(hash, env.CF_VERSION_METADATA?.id, nonce, at)
          // An object on the release before would prove nothing of this
          // bundle, and may not know its words: the canary is sent once the
          // object runs this bundle, by the publication that finds it there.
          let ask = await asking()
          let lag = ask && await lagging(ask, hash)
          if (lag == null) return json({ error: 'tracker unavailable' }, 503)
          if (!lag) await env.ERRORS.send(rows)
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
        (scope) => ({
          ingest: async (rows) => {
            await call(scope, (stub) => stub.ingest(rows))
            enroll(scope)
          },
        }),
        (error) => {
          console.error('queue', error)
          return told(error, 'queue')
        },
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
          await told(error, 'queue', undefined, eid)
        },
        (scope, rows) =>
          env.TRACKERS.getByName(platform).admitTrace(scope, rows),
      ),
    scheduled: async () => {
      try {
        await call(platform, (stub) => stub.monitor())
      } catch (error) {
        await report(error, 'scheduled')
        throw error
      }
    },
  }
}
