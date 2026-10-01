// The kernel's door onto one store: the Durable Object namespace as a slice,
// and `storeOf`, which builds every request the kernel makes to an object.
//
// It is its own module because two kinds of caller reach a store and only one
// of them may carry the kernel with it. The Worker's parts (apps.ts, tools.ts,
// directory.ts, …) hold the whole kernel; the Store object itself holds nothing
// but its bindings — it is checked against the runtime's own types with no Deno
// anywhere in its graph (conform.ts) — and it too has one question to ask the
// directory: what the space that just sent a letter has spent this month
// (meter.ts `metering`). This is why the door was lifted out of the store that
// graph.ts replaced: living beside that class dragged src/db.ts into the
// object's graph and failed that check. That class is gone (T-33807).
import type { Caller } from '@yaks/egress'
import { hop, writing } from './lib/hops.ts'
import { defect } from './sentry.ts'

// A store reports the statements it ran for this fetch, including any store
// it asked in turn. Only the door sees every answer, so it is also where a
// parent request collects those costs.
let metered = async (send: () => Promise<Response>): Promise<Response> => {
  let res = await send()
  for (
    let [header, name] of [
      ['x-yak-hops', 'hops'],
      ['x-yak-stmts', 'stmts'],
      ['x-yak-rows', 'rows'],
      ['x-yak-r2', 'r2.child'],
    ]
  ) {
    let value = res.headers.get(header)
    if (value != null && /^\d+$/.test(value)) hop(name, Number(value))
  }
  return res
}

/** Anything a request can be handed to: a service binding, or a part of this
 * Worker called in-process (env.ts `bound`). */
export type Fetcher = { fetch(req: Request): Promise<Response> }

// The dispatch namespace binding, the slice we ask of it (env.ts): a name in,
// a fetcher out, and what its outbound Worker is handed for every fetch that
// script makes (wrangler.toml `outbound.parameters`). Every parameter the
// namespace declares is required: Cloudflare refuses a `get` that leaves one
// out ("Missing one or more required arguments to worker"). `get` throws for a
// script that is not there, and the docs give only the message's prefix to
// know it by
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/).
//
// Here rather than in dispatch.ts, which is what uses it: a binding's slice is
// what env.ts is made of, and naming this one from dispatch.ts made the whole
// of that module — and everything it reaches — part of the type graph of
// anything that reads `Env`. That is the same reason `Fetcher` is here.
export type Dispatch = {
  get(
    name: string,
    args: Record<string, unknown>,
    options: {
      outbound: { CALLER: Caller }
      limits?: { cpuMs: number; subRequests: number }
    },
  ): Fetcher
}

/** The store the directory lives in, named the way every app's store is. Its
 * slugs are the platform's own and never move, so the name is a constant.
 *
 * A store's name is addressing and not vocabulary, which is why it is here and
 * not beside the platform's words: meta.ts and directory.ts want the name and
 * nothing else from vocab.ts, and that one import was what made the words a
 * dependency of the directory — so vocab.ts could not itself read a list of
 * plugins that reaches the directory (plugin.ts). */
export let PLATFORM_STORE = 'yak/platform'

/** The store the git object graph lives in (git.ts, D-34943). One object for
 * the whole platform, because a git object is named by its own bytes: the same
 * blob deployed by two apps in two spaces is one row, and a graph that were
 * per-app or per-space could not say so. Refs are the directory's — access to
 * an app is decided there — so this object holds objects and nothing else. */
export let GIT_STORE = 'yak/git'

export type Stub = { fetch(req: Request): Promise<Response> }
export type Namespace = {
  idFromName(name: string): unknown
  get(id: unknown): Stub
}

// The kernel's door to one store: a caller on the object named for the app
// (directory.ts storeName — the address it was born at, which a rename never
// moves), told its name on every call (the object keeps the first). The
// kernel builds the name; a client never names a store. An incoming Request
// may be the init: that is how a socket upgrade reaches the object with its
// `Upgrade` header on it, since the header a route adds rides beside it.
export type Door = {
  (
    path: string,
    init?: RequestInit | Request,
    headers?: Record<string, string>,
    options?: { replayable?: boolean },
  ): Promise<Response>
  consume<T>(
    path: string,
    read: (response: Response) => T | Promise<T>,
    init?: RequestInit | Request,
    headers?: Record<string, string>,
    options?: { replayable?: boolean },
  ): Promise<T>
}

// The statement only the kernel may make, and therefore the set every request
// to a store is scrubbed of before the kernel makes it. An init that is a
// Request carries its headers across — that is how a socket upgrade reaches
// the object with its `Upgrade` header on it — so a visitor's own
// `x-yak-person` would ride along with it and the object would believe it
// (graph.ts `vouchOf`). Stripped here, at the one door onto a store, "the
// kernel builds every request from scratch" is a fact about this function
// rather than a hope about its callers.
//
// The idempotency key is among them because the store answers a key it has
// seen with the answer it gave (writes.ts): only the kernel mints one.
export let IDEMPOTENCY = 'idempotency-key'

let VOUCH = [
  IDEMPOTENCY,
  'x-store',
  'x-yak-app',
  'x-yak-access',
  'x-yak-mail',
  'x-yak-release',
  'x-yak-base-release',
  'x-yak-person',
  'x-yak-role',
  'x-yak-title',
  'x-yak-write',
  'x-yak-kernel',
  'x-via',
]

/** Which app this door serves, as the directory has it: the entity the
 * @yaks/member guard asks about, the access mode that is the last word on a
 * caller holding no level, and the address its letters leave from (post.ts
 * `mailFrom`). The store remembers all three (graph.ts `#learn`), so a door
 * that cannot name its app simply says nothing about it.
 *
 * The address is the directory's to derive rather than the store's, because
 * only the directory knows the app's current slug and whether it is the
 * space's home — a store is named at birth and never renamed (`storeName`). */
export type Served = {
  eid: string
  access: string
  mail?: string
  release?: string
  base?: string
}

/** The door as a request builder over whatever answers it: the stub, or the
 * object itself when the caller is that object (graph.ts). Either way the
 * request is the kernel's, built from scratch here and nowhere else.
 *
 * And therefore the one place a hop to a store is counted (hops.ts): every
 * caller reaches an object through here — `storeOf` below is this function
 * with a stub behind it, and the store's own door onto the directory is this
 * function with the object behind it — so `hops;dur=<n>` on a request is
 * exact rather than a sample. A retry (`storeOf`) is two hops, which is what
 * it cost. */
export let doorOf = (
  send: (req: Request) => Promise<Response>,
  name: string,
  app?: Served,
): Door => {
  let ask = (
    path: string,
    init: RequestInit | Request = {},
    headers: Record<string, string> = {},
  ) => {
    let req = new Request(`http://store${path}`, init)
    for (let h of VOUCH) req.headers.delete(h)
    for (let [k, v] of Object.entries(headers)) req.headers.set(k, v)
    req.headers.set('x-store', name)
    if (app) {
      req.headers.set('x-yak-app', app.eid)
      req.headers.set('x-yak-access', app.access)
      if (app.mail) req.headers.set('x-yak-mail', app.mail)
      if (app.release != null) {
        req.headers.set('x-yak-release', String(app.release))
      }
      if (app.base != null) {
        req.headers.set('x-yak-base-release', String(app.base))
      }
    }
    hop('hops')
    // And the one place a write to a store is seen, whichever door made it: a
    // read this request remembers is never answered from before it (hops.ts
    // `writing`, directory.ts `directory`).
    let read = req.method == 'GET' || req.method == 'HEAD'
    return metered(() => read ? send(req) : writing(name, () => send(req)))
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

// The runtime evicts an object out from under a request during a deploy or a
// storage reset and says so with `retryable` (its own flag on the error) or, on
// an older runtime, in words. Its guidance for both is: fetch again.
let RESETS = [
  'Durable Object instance is no longer active',
  'Durable Object reset because',
  'Durable Object storage operation exceeded timeout which caused object to be reset',
]
export let evicted = (e: unknown): boolean =>
  e instanceof Error &&
  (('retryable' in e && e.retryable === true) ||
    RESETS.some((said) => e.message.includes(said)))

// A store the runtime killed for its limits says so in these words. Its own
// code never sees the kill, and the retry may well answer, so the door
// reports it, before anything retries, or nothing ever would (M-37965).
let LIMITS = /exceeded its (CPU time|memory) limit/
export let killed = (e: unknown): boolean =>
  e instanceof Error && LIMITS.test(e.message)

/** An answer, with an eviction in it thrown as the runtime throws one. A store
 * the runtime resets mid-request can still answer, and it answers the reset as
 * it answers any error, in a 500's refusal body (@yaks/api `refuse`), so the
 * words the runtime meant as "fetch again" would reach the caller as a failure
 * (T-40726). */
export let thrown = async (r: Response): Promise<Response> => {
  if (r.status < 500) return r
  let said: { message?: unknown; retryable?: unknown } | null = await r
    .clone().text().then((t) => JSON.parse(t)).catch(() => null)
  let e = typeof said?.message == 'string'
    ? Object.assign(new Error(said.message), { retryable: said.retryable })
    : null
  if (evicted(e)) throw e
  return r
}

/** Retry one replayable call. A second failure propagates unchanged. */
export let retryOnce = async <T>(
  send: () => T | Promise<T>,
  replayable = true,
  retry: (error: unknown) => boolean = evicted,
): Promise<T> => {
  try {
    return await send()
  } catch (e) {
    if (!retry(e) || !replayable) throw e
    return send()
  }
}

/** A request factory, not a spent Request: both attempts get their own body. */
export let fetchOf =
  (ns: Namespace, name: string) => (make: () => Request): Promise<Response> =>
    retryOnce(() => ns.get(ns.idFromName(name)).fetch(make()))

// A request can be built twice from its init only while the body is a value:
// a stream, or a Request whose body the first build took, is spent.
let rebuildable = (init: RequestInit | Request) =>
  init instanceof Request ? !init.body : !(init.body instanceof ReadableStream)

export let storeOf = (ns: Namespace, name: string, app?: Served): Door => {
  // The stub is taken per call. It is an I/O object, and the runtime binds
  // one to the request that created it: a door memoized for the isolate
  // (meta.ts `doors`) and reused on the next request throws "cannot perform
  // I/O on behalf of a different request". Getting one costs nothing, so an
  // eviction, thrown or answered, is answered by taking another and building
  // the request again from the same init. Only a streamed body cannot be sent
  // twice; that one error passes through. The first may have committed before
  // its answer was lost, so both carry one idempotency key, and a store that
  // applied the first answers the second as it answered the first
  // (writes.ts) rather than applying it again.
  let door = doorOf(
    (req) => ns.get(ns.idFromName(name)).fetch(req),
    name,
    app,
  )
  let ask = <T>(
    path: string,
    read: (response: Response) => T | Promise<T>,
    init: RequestInit | Request = {},
    headers: Record<string, string> = {},
    consuming = false,
    options: { replayable?: boolean } = {},
  ) => {
    let once = { ...headers, [IDEMPOTENCY]: crypto.randomUUID() }
    let method = init instanceof Request ? init.method : init.method ?? 'GET'
    let safe = method == 'GET' || method == 'HEAD'
    let request = `store ${path.split('?')[0]}`
    return retryOnce(
      async () => {
        try {
          return read(await thrown(await door(path, init, once)))
        } catch (e) {
          if (killed(e)) defect(e, { request, store: name })
          throw e
        }
      },
      rebuildable(init) && options.replayable !== false,
      (e) =>
        evicted(e) ||
        (consuming && safe && e instanceof Error &&
          /^internal error; reference = [a-z0-9]+$/i.test(e.message)),
    )
  }
  let send = (
    path: string,
    init: RequestInit | Request = {},
    headers: Record<string, string> = {},
    options: { replayable?: boolean } = {},
  ) => ask(path, (response) => response, init, headers, false, options)
  // A body can fail after the runtime answered 200. Keep consuming it inside
  // the same replay as the fetch, so a retry gets a fresh stub and the same
  // idempotency key. A caller streaming a socket or bytes keeps using `send`.
  let consume = <T>(
    path: string,
    read: (response: Response) => T | Promise<T>,
    init: RequestInit | Request = {},
    headers: Record<string, string> = {},
    options: { replayable?: boolean } = {},
  ) => ask(path, read, init, headers, true, options)
  return Object.assign(send, { consume })
}
