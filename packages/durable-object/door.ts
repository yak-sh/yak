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

/** The header that makes a resend safe: an object that applied a key answers
 * the next send of it as it answered the first (@yaks/api receipts). */
export let IDEMPOTENCY = 'idempotency-key'

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

// An answer a resend could replace, read whole inside the retry that sent it:
// a restart that cuts off its body is sent again instead of reaching whoever
// reads it later. A stream (an ndjson pour, a socket) is handed on as it comes,
// since its reader is the one reading it live.
let held = async (r: Response): Promise<Response> =>
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
 * that met it; `wait` waits out each pause (`retried`). */
export type Resend = {
  report?: (error: unknown, path: string) => void
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
      ((r: Response) => (replayable ? held(r) : r) as T | Promise<T>)
    return retried(
      async () => {
        try {
          return await take(await thrown(await door(path, init, once)))
        } catch (e) {
          if (killed(e) || starved(e)) o.report?.(e, path)
          throw e
        }
      },
      replayable,
      (e) => evicted(e) || (!!read && safe && opaque(e)),
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
