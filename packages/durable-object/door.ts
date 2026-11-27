// The door to an object: its stub by name, a request built from scratch for
// every call through it, and the call sent again when the runtime reset the
// object or lost the call (./resets.ts).
//
// A caller reaches an object only by fetch, so everything a call needs to say
// rides on the request, and the request is built here, from a path, an init
// and the headers the call sets. What those headers mean is the caller's: a
// door scrubs the ones the caller names, so a header only the caller may set
// never rides in on an init that is someone else's Request, and `send` dresses
// the request in whatever else the caller always says. Nothing here knows what
// the object is for.

import { IDEMPOTENCY } from '@yaks/api/log'
import {
  type Clock,
  heard,
  type Hold,
  resolvers,
  system,
  waitFor,
} from '@yaks/fp'
import {
  evicted,
  killed,
  opaque,
  retried,
  starved,
  unserved,
} from './resets.ts'

/** A Durable Object stub: one object, reachable by fetch. */
export type Stub = { fetch(req: Request): Promise<Response> }

/** A Durable Object namespace binding, the part of it a door uses. */
export type Namespace = {
  idFromName(name: string): unknown
  get(id: unknown, options?: { locationHint?: string }): Stub
}

/**
 * The stub for the object a name stands in, created where `hint` says (a
 * Cloudflare location hint, such as `'enam'`). The runtime reads a hint only
 * at an object's first get and never moves an object, so where the first get
 * placed it is where it answers from, for good.
 *
 * A stub is an I/O object the runtime binds to the request that took it, so
 * take one per call: getting one costs nothing.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let got: unknown[] = []
 * let ns = {
 *   idFromName: (name: string) => `id:${name}`,
 *   get: (...args: unknown[]) => (got.push(args), { fetch: () => Promise.resolve(new Response()) }),
 * }
 * stubOf(ns, 'ada', 'enam')
 * stubOf(ns, 'bo')
 * assertEquals(got, [['id:ada', { locationHint: 'enam' }], ['id:bo']])
 * ```
 */
export let stubOf = (ns: Namespace, name: string, hint?: string): Stub => {
  let id = ns.idFromName(name)
  return hint ? ns.get(id, { locationHint: hint }) : ns.get(id)
}

/** A call's options: `replayable: false` says it must not be sent twice. */
export type Call = { replayable?: boolean }

/** A door onto one object: a path, its init and the headers this call sets,
 * answered by the object. An init that is a Request carries its method, body
 * and headers across, which is how a socket upgrade reaches the object with
 * its `Upgrade` header on it. `consume` reads the answer with `read`. */
export type Door = {
  (
    path: string,
    init?: RequestInit | Request,
    headers?: Record<string, string>,
    options?: Call,
  ): Promise<Response>
  consume<T>(
    path: string,
    read: (response: Response) => T | Promise<T>,
    init?: RequestInit | Request,
    headers?: Record<string, string>,
    options?: Call,
  ): Promise<T>
}

/** Whatever answers a request: a stub, or the object itself in-process. */
export type Send = (req: Request) => Promise<Response>

/**
 * An object's door onto itself: each call waits a `turn` of its event loop
 * before `send` answers it. In-process a call is a method call that settles on
 * microtasks alone, so a job asking read after read held the object for the
 * whole job, and every request waiting on the object waited that long: the
 * directory's trash sweep held every door on the platform for 18 s (T-4061).
 * Its calls still run in order; the requests waiting run between them. The
 * runtime gives the turn (the next task: Node's `setImmediate` where it has
 * one), since not every Worker that loads this module has it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { setImmediate } from 'node:timers'
 * let next = () => new Promise<void>((go) => void setImmediate(go))
 * let seen: string[] = []
 * let itself = yielding(() => {
 *   seen.push('job')
 *   return Promise.resolve(new Response())
 * }, next)
 * setImmediate(() => seen.push('waiting'))
 * await itself(new Request('http://store/query'))
 * assertEquals(seen, ['waiting', 'job'])
 * ```
 */
export let yielding =
  (send: Send, turn: () => Promise<void>): Send => async (req) => {
    await turn()
    return await send(req)
  }

/**
 * A door that builds each request from scratch and hands it to `send`: the
 * init's headers named in `scrub` are dropped, then the call's own headers
 * set. `send` sees the request last, so what it sets is the final word.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let door = doorOf((req) => Promise.resolve(new Response(
 *   `${new URL(req.url).pathname} ${req.headers.get('x-who')}`,
 * )), ['x-who'])
 * let visitor = new Request('http://visitor', { headers: { 'x-who': 'me' } })
 * assertEquals(await door.consume('/query', (r) => r.text(), visitor), '/query null')
 * assertEquals(await (await door('/query', visitor, { 'x-who': 'kernel' })).text(), '/query kernel')
 * ```
 */
export let doorOf = (send: Send, scrub: string[] = []): Door => {
  let ask = (
    path: string,
    init: RequestInit | Request = {},
    headers: Record<string, string> = {},
  ) => {
    let req = new Request(`http://store${path}`, init)
    for (let h of scrub) req.headers.delete(h)
    for (let [k, v] of Object.entries(headers)) req.headers.set(k, v)
    return send(req)
  }
  return Object.assign(ask, {
    consume: <T>(
      path: string,
      read: (response: Response) => T | Promise<T>,
      init: RequestInit | Request = {},
      headers: Record<string, string> = {},
    ) => ask(path, init, headers).then(read),
  })
}

let copied = async (response: Response): Promise<() => Response> => {
  let body = response.body ? await response.arrayBuffer() : null
  let init = {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers],
  }
  return () => new Response(body?.slice(0), init)
}

// How long a caller waits on a batch another request sends before presuming
// that request ended (`coalesced`): far past a read's round trip, and well
// inside the minute after which a request that has not answered is a defect.
let PATIENCE = 15_000

// How often a caller looks for its batch's answer.
let BEAT = 5

type Trip = (signal: AbortSignal) => Promise<() => Response>

// One read's callers share a batch: the opener sends its trip, and the answer
// lands on it as a value, the response's bytes or the failure, or `lost` once
// nobody will answer it.
type Batch = {
  answer?: () => Response
  failed?: { error: unknown }
  lost?: boolean
}

let landed = (batch: Batch) =>
  batch.answer || batch.failed || batch.lost ? batch : null

/** Share finite reads accepted by `reads` and queued before `turn` sends them,
 * each caller receiving its own bytes. A read already sent answers no later
 * caller: its snapshot may predate that caller. So one read of a request
 * travels at a time: whoever asks it meanwhile shares the next, sent once it
 * lands, as passengers board the next lift rather than the one already
 * moving. However many callers ask one read together, the object answers it
 * once a round trip. A write or an excluded read separates batches. `hold`
 * keeps the opener's trip alive past its own request.
 *
 * Callers are often different requests, and a Worker settles a promise only
 * in the request that made it: one request's wake to another is dropped once
 * the sleeper's request ends (@yaks/fp `Scope`). So no caller awaits or
 * settles another's promise. The caller that opens a batch sends it from its
 * own request, and its answer lands on the batch as a value: the bytes, which
 * each caller makes its own response from, or the failure. Every other
 * caller looks for it every `beat` ms on its own clock (@yaks/fp `waitFor`).
 *
 * What runs in another request is dropped, without a word, once that request
 * ends: a batch whose opener ended before sending it, or whose trip never
 * lands, would answer nobody. So a caller unanswered for `patience` ms
 * (`heard` on `clock`) presumes its batch lost and boards again from its own
 * request once, and an opener aborts a trip of its own still out then. `wait`
 * wraps the caller's full wait, so a host can name it. */
export let coalesced = (
  door: Door,
  reads: (request: Request) => boolean,
  {
    hold,
    turn = queueMicrotask,
    patience = PATIENCE,
    clock = system,
    beat = BEAT,
    wait = (seated) => seated(),
  }: {
    hold?: Hold
    turn?: (send: () => void) => void
    patience?: number
    clock?: Clock
    beat?: number
    wait?: <T>(seated: () => Promise<T>) => Promise<T>
  } = {},
): Door => {
  // The batch still boarding for each read, and the one travelling.
  let boarding = new Map<string, Batch>()
  let moving = new Map<string, Batch>()
  let looking = { clock, beat }
  // What boards from here on shares nothing sent before.
  let part = () => {
    boarding.clear()
    moving.clear()
  }
  let apart = async (send: () => Promise<Response>) => {
    part()
    try {
      return await send()
    } finally {
      part()
    }
  }
  // A batch nobody answered in time: nobody boards behind it again.
  let lost = (key: string, batch: Batch) => {
    batch.lost ||= !batch.answer && !batch.failed
    if (boarding.get(key) == batch) boarding.delete(key)
    if (moving.get(key) == batch) moving.delete(key)
  }
  // The opener's send, all in its own request: once the read ahead lands (or
  // is presumed lost) and this turn's callers have boarded.
  let send = (key: string, batch: Batch, trip: Trip): Promise<void> => {
    let { promise: sent, resolve: done } = resolvers<void>()
    let go = () => {
      if (batch.lost) return done()
      if (boarding.get(key) == batch) boarding.delete(key)
      moving.set(key, batch)
      let stop = new AbortController()
      let { promise: cut, reject } = resolvers<never>()
      let cancel = heard(patience, () => {
        stop.abort()
        reject(new Error('The store did not answer the read in time'))
      }, clock)
      Promise.race([trip(stop.signal), cut]).then(
        (answer) => void (batch.answer = answer),
        (error) => {
          if (stop.signal.aborted) lost(key, batch)
          else batch.failed = { error }
        },
      ).finally(() => {
        cancel()
        if (moving.get(key) == batch) moving.delete(key)
        done()
      })
    }
    let ahead = moving.get(key)
    if (!ahead) turn(go)
    else {
      let gone = () => moving.get(key) != ahead || landed(ahead)
      void waitFor(() => gone() || null, patience, looking).then((went) => {
        if (!went) lost(key, ahead)
        turn(go)
      })
    }
    return sent
  }
  let ride = async (key: string, trip: Trip): Promise<Response> => {
    for (let sent = 0; sent < 2; sent++) {
      let batch = boarding.get(key)
      if (!batch) {
        boarding.set(key, batch = {})
        let sending = send(key, batch, trip)
        hold?.(sending)
      }
      let got = await waitFor(() => landed(batch), patience, looking)
      if (got?.answer) return got.answer()
      if (got?.failed) throw got.failed.error
      lost(key, batch)
    }
    throw Object.assign(
      new Error('The store did not answer the read after a retry'),
      { status: 504 },
    )
  }
  let ask = async (
    path: string,
    init: RequestInit | Request = {},
    headers: Record<string, string> = {},
    options: Call = {},
  ) => {
    let method = init instanceof Request ? init.method : init.method ?? 'GET'
    if (method != 'GET' || options.replayable === false) {
      return await apart(() => door(path, init, headers, options))
    }
    return await doorOf(async (request) => {
      // An upgrade starts an independent stream. It cannot answer a batch,
      // and it need not release every batched read during a reconnect.
      if (request.headers.has('upgrade')) {
        return await door(path, init, headers, options)
      }
      if (!reads(request)) {
        return await apart(() => door(path, init, headers, options))
      }
      let key = JSON.stringify([
        request.url,
        [...request.headers].filter(([name]) => name != IDEMPOTENCY),
      ])
      // The call's own headers are set again past the inner door's scrub, as
      // an uncoalesced call sets them.
      return await wait(() =>
        ride(
          key,
          (signal) =>
            door.consume(
              path,
              copied,
              new Request(request, { signal }),
              headers,
              options,
            ),
        )
      )
    })(path, init, headers)
  }
  return Object.assign(ask, {
    consume: <T>(
      path: string,
      read: (response: Response) => T | Promise<T>,
      init?: RequestInit | Request,
      headers?: Record<string, string>,
      options?: Call,
    ) => ask(path, init, headers, options).then(read),
  })
}

// The header that makes a resend safe: an object that applied a key answers
// the next send of it as it answered the first (@yaks/api/receipts).
export { IDEMPOTENCY } from '@yaks/api/log'

/**
 * The reset an answer carries, as the runtime throws it, or null. An object
 * the runtime resets mid-request can still answer, and it answers the reset as
 * it answers any error, in a 500's refusal body (@yaks/api `refuse`), so the
 * words the runtime meant as "fetch again" would reach the caller as a
 * failure. An object that ran out of memory answers the same way.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let said = (message: string) => Response.json({ message }, { status: 500 })
 * assertEquals((await reset(said('Network connection lost.')))?.message, 'Network connection lost.')
 * assertEquals(await reset(said('boot failed')), null)
 * assertEquals(await reset(new Response('Network connection lost.')), null)
 * ```
 */
export let reset = async (r: Response): Promise<Error | null> => {
  if (r.status < 500) return null
  let said: { message?: unknown; retryable?: unknown } | null = await r
    .clone().text().then((t) => JSON.parse(t)).catch(() => null)
  // The whole body rides along as `said`, for a caller that reads more of it.
  let e = typeof said?.message == 'string'
    ? Object.assign(new Error(said.message), {
      retryable: said.retryable,
      said,
    })
    : null
  return evicted(e) || starved(e) ? e : null
}

/** An answer, with a reset in it thrown as the runtime throws one. */
export let thrown = async (r: Response): Promise<Response> => {
  let e = await reset(r)
  if (e) throw e
  return r
}

/** The most bytes of an answer {@link received} reads whole. */
export let WHOLE = 1024 * 1024

/** Whether an answer is read whole where it arrives: a finite one, no larger
 * than {@link WHOLE} by the length it declares. A live stream (ndjson, SSE or
 * a socket) is handed on as it comes, since its reader owns its lifetime, and
 * so is a file, which declares more: it is never held whole. */
export let finite = (r: Response): boolean =>
  !!r.body && r.status != 101 &&
  !/ndjson|event-stream/.test(r.headers.get('content-type') ?? '') &&
  Number(r.headers.get('content-length') ?? 0) <= WHOLE

let local = new WeakSet<Response>()

/** Mark an answer made in this process. It has no remote hop whose reset
 * could cut off its body after the headers arrived. */
export let inProcess = (r: Response): Response => {
  local.add(r)
  return r
}

/** Read a {@link finite} answer whole inside the retry that sent it, so a
 * restart cutting off its body is sent again. */
export let received = async (r: Response): Promise<Response> =>
  !local.has(r) && finite(r) ? new Response(await r.arrayBuffer(), r) : r

// A request can be built twice from its init only while the body is a value:
// a stream, or a Request whose body the first build took, is spent.
let rebuildable = (init: RequestInit | Request) =>
  init instanceof Request ? !init.body : !(init.body instanceof ReadableStream)

/** What `resending` is told: `report` hears a kill for the object's limits or
 * a refusal for memory, the failures no retry should hide, with the path
 * that met it; `settled` may answer a call whose resends ran
 * out, in place of its last failure; `wait` waits out each pause
 * (`retried`). */
export type Resend = {
  report?: (error: unknown, path: string) => void
  settled?: (failure: unknown, path: string) => Response | null
  wait?: (ms: number) => Promise<void>
}

/**
 * A door that sends a call again when the object never ran it (`unserved`):
 * the runtime reset the object or lost the call, thrown or answered
 * (`reset`), or dropped it from an overloaded object's queue, as `retried`
 * paces it. A call is
 * sent again only when that is safe: its request can be built again (no
 * streamed body, and not `replayable: false`), and each carries one
 * `IDEMPOTENCY` key across its sends, so an object that applied it before its
 * answer was lost answers the next as it answered the first. A caller that
 * will send the call again itself names the key, and the door keeps it.
 *
 * An answer is read whole inside the retry, so a restart that cuts off its
 * body is sent again too; a stream is handed on as it comes. A caller that
 * reads the answer (`consume`) reads it inside the same retry, so a read
 * failing in the runtime's opaque words is sent again, and a write is not.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let sends = 0
 * let door = resending(doorOf(() =>
 *   Promise.resolve(++sends < 2
 *     ? Response.json({ message: 'Network connection lost.' }, { status: 500 })
 *     : new Response('ok'))
 * ), { wait: () => Promise.resolve() })
 * assertEquals([await (await door('/query')).text(), sends], ['ok', 2])
 * ```
 */
export let resending = (door: Door, o: Resend = {}): Door => {
  let ask = <T>(
    path: string,
    read: ((response: Response) => T | Promise<T>) | null,
    init: RequestInit | Request = {},
    headers: Record<string, string> = {},
    options: Call = {},
  ) => {
    let once = { [IDEMPOTENCY]: crypto.randomUUID(), ...headers }
    let method = init instanceof Request ? init.method : init.method ?? 'GET'
    let safe = method == 'GET' || method == 'HEAD'
    let replayable = rebuildable(init) && options.replayable !== false
    let take = read ??
      ((r: Response) => (replayable ? received(r) : r) as T | Promise<T>)
    let resent = (e: unknown) => unserved(e) || (!!read && safe && opaque(e))
    let sent = retried(
      async () => {
        if (init instanceof Request) init.signal.throwIfAborted()
        try {
          return await take(await thrown(await door(path, init, once)))
        } catch (e) {
          if (killed(e) || starved(e)) o.report?.(e, path)
          throw e
        }
      },
      replayable,
      resent,
      o.wait,
    )
    return sent.catch((e) => {
      let answer = o.settled?.(e, path)
      if (!answer) throw e
      return take(answer)
    })
  }
  return Object.assign(
    (
      path: string,
      init?: RequestInit | Request,
      headers?: Record<string, string>,
      options?: Call,
    ) => ask<Response>(path, null, init, headers, options),
    {
      consume: <T>(
        path: string,
        read: (response: Response) => T | Promise<T>,
        init?: RequestInit | Request,
        headers?: Record<string, string>,
        options?: Call,
      ) => ask(path, read, init, headers, options),
    },
  )
}
