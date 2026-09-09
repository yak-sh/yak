// The kernel's door onto one store: the Durable Object namespace as a slice,
// and `storeOf`, which builds every request the kernel makes to an object.
//
// It is its OWN module because two kinds of caller reach a store and only one
// of them may carry the kernel with it. The Worker's parts (apps.ts, tools.ts,
// directory.ts, …) hold the whole kernel; the Store object itself holds nothing
// but its bindings — it is checked against the runtime's own types with no Deno
// anywhere in its graph (conform.ts) — and it too has one question to ask the
// directory: what the space that just sent a letter has spent this month
// (meter.ts `metering`). This is why the door was lifted out of the store that
// graph.ts replaced: living beside that class dragged src/db.ts into the
// object's graph and failed that check. That class is gone (T-33807).
/** Anything a request can be handed to: a service binding, or a part of this
 * Worker called in-process (env.ts `bound`). */
export type Fetcher = { fetch(req: Request): Promise<Response> }

// The dispatch namespace binding, the slice we ask of it (env.ts): a name in,
// a fetcher out. `get` throws for a script that is not there, and the docs
// give only the message's prefix to know it by
// (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/).
//
// Here rather than in dispatch.ts, which is what USES it: a binding's slice is
// what env.ts is made of, and naming this one from dispatch.ts made the whole
// of that module — and everything it reaches — part of the type graph of
// anything that reads `Env`. That is the same reason `Fetcher` is here.
export type Dispatch = { get(name: string): Fetcher }

/** The store the directory lives in, named the way every app's store is. Its
 * slugs are the platform's own and never move, so the name is a constant.
 *
 * A store's NAME is addressing and not vocabulary, which is why it is here and
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
// kernel spells the name; a client never names a store. An incoming Request
// may BE the init: that is how a socket upgrade reaches the object with its
// `Upgrade` header on it, since the header a route adds rides beside it.
export type Door = (
  path: string,
  init?: RequestInit | Request,
  headers?: Record<string, string>,
) => Promise<Response>

// The statement only the kernel may make, and therefore the set every request
// to a store is scrubbed of before the kernel makes it. An init that IS a
// Request carries its headers across — that is how a socket upgrade reaches
// the object with its `Upgrade` header on it — so a visitor's own
// `x-yak-person` would ride along with it and the object would believe it
// (graph.ts `vouchOf`). Stripped here, at the one door onto a store, "the
// kernel builds every request from scratch" is a fact about this function
// rather than a hope about its callers.
let VOUCH = [
  'x-store',
  'x-yak-app',
  'x-yak-access',
  'x-yak-mail',
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
 * The address is the DIRECTORY's to derive rather than the store's, because
 * only the directory knows the app's current slug and whether it is the
 * space's home — a store is named at birth and never renamed (`storeName`). */
export type Served = { eid: string; access: string | null; mail?: string }

/** The door as a request BUILDER over whatever answers it: the stub, or the
 * object itself when the caller is that object (graph.ts). Either way the
 * request is the kernel's, built from scratch here and nowhere else. */
export let doorOf = (
  send: (req: Request) => Promise<Response>,
  name: string,
  app?: Served,
): Door =>
(path, init = {}, headers = {}) => {
  let req = new Request(`http://store${path}`, init)
  for (let h of VOUCH) req.headers.delete(h)
  for (let [k, v] of Object.entries(headers)) req.headers.set(k, v)
  req.headers.set('x-store', name)
  if (app) {
    req.headers.set('x-yak-app', app.eid)
    if (app.access) req.headers.set('x-yak-access', app.access)
    if (app.mail) req.headers.set('x-yak-mail', app.mail)
  }
  return send(req)
}

// The runtime evicts an object out from under a request during a deploy or a
// storage reset and says so with `retryable` (its own flag on the error) or, on
// an older runtime, in words. Its guidance for both is: fetch again.
export let evicted = (e: unknown): boolean =>
  e instanceof Error &&
  (('retryable' in e && e.retryable === true) ||
    /Durable Object instance is no longer active|Durable Object reset because/
      .test(e.message))

// A request can be built twice from its init only while the body is a value:
// a stream, or a Request whose body the first build took, is spent.
let rebuildable = (init: RequestInit | Request) =>
  init instanceof Request ? !init.body : !(init.body instanceof ReadableStream)

export let storeOf = (ns: Namespace, name: string, app?: Served): Door => {
  // The stub is taken PER CALL. It is an I/O object, and the runtime binds
  // one to the request that created it: a door memoized for the isolate
  // (meta.ts `doors`) and reused on the next request throws "cannot perform
  // I/O on behalf of a different request". Getting one costs nothing, so an
  // eviction is answered by taking another and building the request again
  // from the same init. Only a streamed body cannot be sent twice; that one
  // error passes through.
  let door = doorOf(
    (req) => ns.get(ns.idFromName(name)).fetch(req),
    name,
    app,
  )
  return async (path, init = {}, headers = {}) => {
    try {
      return await door(path, init, headers)
    } catch (e) {
      if (!evicted(e) || !rebuildable(init)) throw e
      return door(path, init, headers)
    }
  }
}
