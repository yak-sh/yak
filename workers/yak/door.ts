// The kernel's door onto one store: the Durable Object namespace as a slice,
// and `storeOf`, which builds every request the kernel makes to an object.
//
// It is its OWN module rather than a corner of store.ts because two kinds of
// caller reach a store and only one of them may carry the kernel with it. The
// Worker's parts (apps.ts, tools.ts, directory.ts, …) hold the whole kernel;
// the Store object itself holds nothing but its bindings — it is checked
// against the runtime's own types with no Deno anywhere in its graph
// (conform.ts) — and it too has one question to ask the directory: what the
// space that just sent a letter has spent this month (meter.ts `metering`).
// A door that lived beside the legacy Store class would drag src/db.ts into
// that object's graph and fail that check.
/** Anything a request can be handed to: a service binding, or a part of this
 * Worker called in-process (env.ts `bound`). */
export type Fetcher = { fetch(req: Request): Promise<Response> }

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
// (store.ts `writerOf`, graph.ts `vouchOf`). Stripped here, at the one door
// onto a store, "the kernel builds every request from scratch" is a fact
// about this function rather than a hope about its callers.
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

export let storeOf = (ns: Namespace, name: string, app?: Served): Door => {
  return (path, init = {}, headers = {}) => {
    // The stub is taken PER CALL. It is an I/O object, and the runtime binds
    // one to the request that created it: a door memoized for the isolate
    // (meta.ts `doors`) and reused on the next request throws "cannot perform
    // I/O on behalf of a different request". Getting one costs nothing.
    let stub = ns.get(ns.idFromName(name))
    let req = new Request(`http://store${path}`, init)
    for (let h of VOUCH) req.headers.delete(h)
    for (let [k, v] of Object.entries(headers)) req.headers.set(k, v)
    req.headers.set('x-store', name)
    if (app) {
      req.headers.set('x-yak-app', app.eid)
      if (app.access) req.headers.set('x-yak-access', app.access)
      if (app.mail) req.headers.set('x-yak-mail', app.mail)
    }
    return stub.fetch(req)
  }
}
