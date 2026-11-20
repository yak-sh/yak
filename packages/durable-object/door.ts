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
import { type Clock, heard, type Hold, resolvers, system } from '@yaks/fp'
import { evicted, killed, opaque, retried, starved } from './resets.ts'

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

// A caller waiting in a batch: its own promise's ends.
type Seat = {
  resolve: (answer: () => Response) => void
  reject: (error: unknown) => void
}

// One read's callers, the trip that answers them, and `go`, which tells the
// caller who opened it that the read ahead has landed.
type Batch = {
  seats: Seat[]
  trip: () => Promise<() => Response>
  go: () => void
}

/** Share finite reads accepted by `reads` and queued before `turn` sends them,
 * each caller receiving its own bytes. A read already sent answers no later
 * caller: its snapshot may predate that caller. So one read of a request
 * travels at a time: whoever asks it meanwhile shares the next, sent the turn
 * after it lands, as passengers board the next lift rather than the one
 * already moving. However many callers ask one read together, the object
 * answers it once a round trip. A write or an excluded read separates
 * batches. `hold` keeps the first caller's I/O alive.
 *
 * Callers are often different requests, and a Worker settles a promise only
 * in the request that created it: once that request ends, whoever awaits it
 * is failed (workerd's `handle_cross_request_promise_resolution`). So no
 * caller awaits a promise another made. Each waits on its own seat, settled
 * from the trip, and a batch is sent from the request that opened it, woken
 * there when the read ahead lands. Seats and wakes are made by `resolvers`
 * (@yaks/fp), whose promise carries the request that made it: one made by a
 * `new Promise` V8 had optimized carried none, so the request whose trip
 * settled it ran its waiter, and the bytes it handed on were that request's
 * (cloudflare/workerd#8228).
 *
 * What runs in another request is dropped, without a word, once that request
 * ends: a batch whose opener ended before sending it, or whose sender ended
 * before it landed, would answer nobody, and every later caller would board
 * behind it. So a seat unanswered for `patience` ms (`heard` on `clock`)
 * presumes its batch lost: the door forgets the batch, and the caller boards
 * again from its own request. `wait` wraps each caller's wait on its seat, so
 * a host can name it. */
export let coalesced = (
  door: Door,
  reads: (request: Request) => boolean,
  {
    hold,
    turn = queueMicrotask,
    patience = PATIENCE,
    clock = system,
    wait = (seated) => seated(),
  }: {
    hold?: Hold
    turn?: (send: () => void) => void
    patience?: number
    clock?: Clock
    wait?: <T>(seated: () => Promise<T>) => Promise<T>
  } = {},
): Door => {
  // The batch still boarding for each read, and the one travelling.
  let boarding = new Map<string, Batch>()
  let moving = new Map<string, Batch>()
  // What boards from here on shares nothing sent before; a batch waiting on
  // a read now forgotten goes at once.
  let part = () => {
    for (let batch of boarding.values()) batch.go()
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
  let send = async (key: string, batch: Batch) => {
    if (boarding.get(key) == batch) boarding.delete(key)
    moving.set(key, batch)
    let landed = (each: (seat: Seat) => void) => {
      if (moving.get(key) == batch) {
        moving.delete(key)
        boarding.get(key)?.go()
      }
      batch.seats.forEach(each)
    }
    try {
      let answer = await batch.trip()
      landed((seat) => seat.resolve(answer))
    } catch (error) {
      landed((seat) => seat.reject(error))
    }
  }
  // A batch opened by this caller, which sends it now or once woken.
  let board = (key: string, trip: Batch['trip']) => {
    let woken = resolvers<void>(), done = resolvers<void>()
    let batch: Batch = { seats: [], trip, go: () => woken.resolve() }
    boarding.set(key, batch)
    let left = false
    let leave = () => {
      if (left) return
      left = true
      turn(() => void send(key, batch).finally(() => done.resolve()))
    }
    void woken.promise.then(leave)
    if (!moving.has(key)) leave()
    hold?.(done.promise)
    return batch
  }
  // A batch nobody answered in time, and the read ahead it waited on if it
  // was never sent: nobody boards behind either again.
  let lost = (key: string, batch: Batch) => {
    if (boarding.get(key) == batch) {
      boarding.delete(key)
      moving.delete(key)
    }
    if (moving.get(key) == batch) {
      moving.delete(key)
      boarding.get(key)?.go()
    }
  }
  // This caller's seat in the batch boarding for `key`, boarding again when
  // its batch is lost.
  let ride = async (
    key: string,
    trip: Batch['trip'],
  ): Promise<Response> => {
    let batch = boarding.get(key) ?? board(key, trip)
    let seat = resolvers<(() => Response) | null>()
    let cancel = heard(patience, () => seat.resolve(null), clock)
    batch.seats.push(seat)
    let answer: (() => Response) | null
    try {
      answer = await wait(() => seat.promise)
    } finally {
      cancel()
    }
    if (answer) return answer()
    lost(key, batch)
    return await ride(key, trip)
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
      if (request.headers.has('upgrade') || !reads(request)) {
        return await apart(() => door(path, init, headers, options))
      }
      let key = JSON.stringify([
        request.url,
        [...request.headers].filter(([name]) => name != IDEMPOTENCY),
      ])
      // The call's own headers are set again past the inner door's scrub, as
      // an uncoalesced call sets them.
      return await ride(
        key,
        () => door.consume(path, copied, request, headers, options),
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
  let e = typeof said?.message == 'string'
    ? Object.assign(new Error(said.message), { retryable: said.retryable })
    : null
  return evicted(e) || starved(e) ? e : null
}

/** An answer, with a reset in it thrown as the runtime throws one. */
export let thrown = async (r: Response): Promise<Response> => {
  let e = await reset(r)
  if (e) throw e
  return r
}

/** Read a finite answer whole inside the retry that sent it, so a restart
 * cutting off its body is sent again. A live stream (ndjson, SSE or a socket)
 * is handed on as it comes, since its reader owns its lifetime. */
export let received = async (r: Response): Promise<Response> =>
  !r.body || r.status == 101 ||
    /ndjson|event-stream/.test(r.headers.get('content-type') ?? '')
    ? r
    : new Response(await r.arrayBuffer(), r)

// A request can be built twice from its init only while the body is a value:
// a stream, or a Request whose body the first build took, is spent.
let rebuildable = (init: RequestInit | Request) =>
  init instanceof Request ? !init.body : !(init.body instanceof ReadableStream)

/** What `resending` is told: `report` hears a kill for the object's limits or
 * a refusal for memory, the failures no retry should hide, with the path
 * that met it; `recovered` hears a call answered after a failure it was sent
 * again for, with that failure and the answer, so the caller judges what the
 * answer says of the failure; `wait` waits out each pause (`retried`). */
export type Resend = {
  report?: (error: unknown, path: string) => void
  recovered?: (failure: unknown, answer: unknown, path: string) => void
  wait?: (ms: number) => Promise<void>
}

/**
 * A door that sends a call again when the runtime reset the object or lost
 * the call, thrown or answered (`reset`), as `retried` paces it. A call is
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
    let failure: unknown = undefined
    let resent = (e: unknown) => evicted(e) || (!!read && safe && opaque(e))
    return retried(
      async () => {
        try {
          let answer = await take(await thrown(await door(path, init, once)))
          if (failure !== undefined) o.recovered?.(failure, answer, path)
          return answer
        } catch (e) {
          if (killed(e) || starved(e)) o.report?.(e, path)
          if (resent(e)) failure = e
          throw e
        }
      },
      replayable,
      resent,
      o.wait,
    )
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
