// The kernel's door onto one store: where its object stands, what the kernel
// alone may say to it, and `storeOf`, which builds every request the kernel
// makes to an object. The door itself — a stub by name, a request built from
// scratch, a call sent again across a reset — is @yaks/durable-object's
// (`stubOf`, `doorOf`, `resending`); this module says what yaks.app puts on it.
//
// It is its own module because two kinds of caller reach a store and only one
// of them may carry the kernel with it. The Worker's parts (apps.ts, tools.ts,
// directory.ts, …) hold the whole kernel; the Store object itself holds nothing
// but its bindings — it is checked against the runtime's own types with no Deno
// anywhere in its graph (conform.ts) — and it too has one question to ask the
// directory: what the space that just sent a letter has spent this month
// (metered.ts `metering`). This is why the door was lifted out of the store that
// graph.ts replaced: living beside that class dragged src/db.ts into the
// object's graph and failed that check. That class is gone (T-33807).
import type { Caller } from '@yaks/egress'
import { apart, elapsed, heard, hop, WAITS, writing } from './lib/hops.ts'
import { background, caught, defect } from './defects.ts'
import { behind, refuses, settled, stamp } from './running.ts'
import { confirmedRefusal } from './query-line.ts'
import { type Refusal, refuse } from '@yaks/api'
import { FILED } from '@yaks/api/refuse'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { ROUTE_MEMORY } from '@yaks/platform/route-memory'
import { retried, unserved } from '@yaks/durable-object/resets'
import {
  type Call,
  type Door,
  doorOf as opened,
  IDEMPOTENCY,
  type Namespace,
  received,
  resending,
  type Stub,
  stubOf,
  thrown,
} from '@yaks/durable-object/door'

// A store reports the statements it ran for this fetch, including any store
// it asked in turn, how long it waited to start when this fetch woke it, and
// what it waited on (`x-yak-waits`). Only the door sees every answer, so it is
// also where a parent request collects those costs, and times the round trip
// itself under `wait`: `directory_wait`, `store_wait` or `operator_wait`
// (timing.ts).
// What a request asked, for a trace (hops.ts `traced`): its path and query,
// cut short.
let asked = (req: Request) => {
  let { pathname, search } = new URL(req.url)
  let said = pathname + search
  try {
    said = decodeURIComponent(said)
  } catch { /* said as sent */ }
  return said.slice(0, 120)
}

let metered = async (
  wait: string,
  send: () => Promise<Response>,
  what?: string,
): Promise<Response> => {
  hop('hops')
  let res = await elapsed(wait, send, what)
  heard(res.headers.get(WAITS))
  for (
    let [header, name] of [
      ['x-yak-hops', 'hops'],
      ['x-yak-stmts', 'stmts'],
      ['x-yak-rows', 'rows'],
      ['x-yak-r2', 'r2.child'],
      ['x-yak-wake', 'wake'],
    ]
  ) {
    let value = res.headers.get(header)
    if (value != null && /^\d+$/.test(value)) hop(name, Number(value))
  }
  return res
}

/** Anything a request can be handed to: a service binding, or a part of this
 * Worker called in-process (env.ts `bound`). */
export type Fetcher = import('@yaks/workerd/fetch').Bound

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

/** Where the directory's file stands. Its name, @yaks/platform/names
 * `PLATFORM_STORE`, is what the directory is;
 * this is the object holding it, first reached from a Worker in ORD so that it
 * stands near Chicago (relocate.ts, T-134094). An object can't move, so a move
 * is a new name here. */
export let PLATFORM_OBJECT = 'yak/platform/ord'

/** The name of the Durable Object a store lives in. */
export let objectOf = (name: string): string =>
  name == PLATFORM_STORE ? PLATFORM_OBJECT : name

/** The store the git object graph lives in (git.ts, D-34943). One object for
 * the whole platform, because a git object is named by its own bytes: the same
 * blob deployed by two apps in two spaces is one row, and a graph that were
 * per-app or per-space could not say so. Refs are the directory's — access to
 * an app is decided there — so this object holds objects and nothing else. */
export let GIT_STORE = 'yak/git'

/** Where an object is created: beside the kernel, whose fetch handler runs in
 * aws:us-east-2 (wrangler.toml `[placement]`) and makes every call a store
 * answers, and beside the directory in ORD. Cloudflare uses a hint only at an
 * object's first get and never moves an object, so one created near a person
 * elsewhere answers every call from an ocean away, for good: a store in VIE
 * answers the kernel about 95 ms later than one in ATL. The hint names a
 * region, and within it Cloudflare picks the colo near the Worker that first
 * reaches the object: every birth, reached first from the kernel, stood in ORD
 * (T-149707), and a store elsewhere in the region (EWR, MIA) answers it 10 to
 * 25 ms later, so a move's new object is reached first from the kernel too
 * (@yaks/admin relocate.ts `sited`). */
export let STORES_AT = 'enam'

/** The object a store's name stands in, created where `STORES_AT` says. */
export let placed = (ns: Namespace, name: string): Stub =>
  stubOf(ns, objectOf(name), STORES_AT)

/** Word names vouched for by a previously accepted immutable release. */
export let ACCEPTED = 'x-yak-accepted'
/** The header a door asks a store with to be answered across the homes of
 * the words its app borrows (graph.ts `#across`, homes.ts), as an app's own
 * pages and tools read and write it. Without it a store answers its own words
 * alone, as each member of a reach is asked. */
export let ACROSS = 'x-yak-across'
/** The header a store's read of a home's words names itself with, while its
 * pages watch them: the home tells it of each commit (graph.ts `#heed`). */
export let HEED = 'x-yak-heed'
/** The header a space's Operator's read of an app names its space with,
 * while a subscription of its watches the app: the app tells it of each
 * commit (graph.ts `#heed`, build.ts `HEARD`). */
export let HEED_OPERATOR = 'x-yak-heed-operator'
/** The store path a home tells a store that borrows from it of a commit at,
 * kernel only: 204 while its pages watch, 410 once none does. */
export let HEARD = '/heard'
/** The store path that only starts its object (graph.ts): the runtime makes
 * it and its plugins load, and nothing it holds is read or written, so an
 * object nobody goes on to use keeps nothing. A birth sends it while the
 * directory writes the app's row (tools.ts `warmed`, T-143307). */
export let WARM = '/warm'
/** The store path a caller about to ask a store that stands sends ahead of
 * it: the store comes up as any request brings it up (its boot, the release
 * it serves, the writes it owes) and answers nothing else, so the request
 * behind it finds the store booted. A page sends it for its scripts (used.ts
 * `wake`, T-150366); a birth sends WARM, since its store holds nothing yet.
 * A space's Builder takes it too, ahead of its chat and behind an answer that
 * says it owes work (build-door.ts `woken`). */
export let WAKE = '/wake'
/** Typed directory reads depend on stored data, never the clock or caller code. */
export let STATIC_QUERY = 'x-yak-static-query'

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
// seen with the answer it gave (@yaks/api/log): only the kernel mints one.
let VOUCH = [
  IDEMPOTENCY,
  ACROSS,
  HEED,
  HEED_OPERATOR,
  ACCEPTED,
  STATIC_QUERY,
  'x-store',
  'x-yak-app',
  'x-yak-space',
  'x-yak-access',
  'x-yak-policy',
  ROUTE_MEMORY,
  'x-yak-mail',
  'x-yak-at',
  'x-yak-phone',
  'x-yak-release',
  'x-yak-speaks',
  'x-yak-base-release',
  'x-yak-person',
  'x-yak-browsers',
  'x-yak-actor',
  'x-yak-role',
  'x-yak-title',
  'x-yak-write',
  'x-yak-kernel',
  'x-yak-administrative',
  'x-yak-visit',
  'x-yak-observe',
  'x-via',
  'x-yak-via',
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
  /** Directory authorization revision, checked independently by the Store. */
  policy?: number
  remembered?: number
  eid: string
  space?: string
  access: string
  mail?: string
  /** the app's address as the directory has it now, `<space>/<app>`: what
   * a store asleep in the trash names when it says how to bring it back
   * (graph.ts `#missing`) */
  at?: string
  /** the app's own number, empty when it has none (app-texts.ts) */
  phone?: string
  release?: string
  base?: string
  /** the store's branch a page reads and writes on, a draft's (preview.ts):
   * none for main */
  branch?: number
}

/** The header naming the branch a request is served on ({@link Served}). */
export let BRANCH = 'x-yak-branch'

// What the kernel says on every request to a store, whatever the caller set:
// the deploy it runs, so a store still on older code answers a refusal as
// skew this door sends again (running.ts `skewed`), the store's name, and
// the app.
let vouched = (req: Request, name: string, app?: Served) => {
  stamp(req.headers)
  req.headers.set('x-store', name)
  if (!app) return
  req.headers.set('x-yak-app', app.eid)
  if (app.space) req.headers.set('x-yak-space', app.space)
  req.headers.set('x-yak-access', app.access)
  if (app.policy != null) req.headers.set('x-yak-policy', String(app.policy))
  if (app.remembered != null) {
    req.headers.set(ROUTE_MEMORY, String(app.remembered))
  }
  if (app.mail) req.headers.set('x-yak-mail', app.mail)
  if (app.at) req.headers.set('x-yak-at', app.at)
  // Said even when empty, so a number taken away is heard.
  if (app.phone != null) req.headers.set('x-yak-phone', app.phone)
  if (app.release != null) req.headers.set('x-yak-release', app.release)
  if (app.base != null) req.headers.set('x-yak-base-release', app.base)
  if (app.branch != null) req.headers.set(BRANCH, String(app.branch))
  else req.headers.delete(BRANCH)
}

/** The kernel's door to one store (@yaks/durable-object `doorOf`), over
 * whatever answers it: the stub, or the object itself when the caller is that
 * object (graph.ts). It is on the object named for the app (directory.ts
 * storeName — the address it was born at, which a rename never moves), told
 * its name on every call (the object keeps the first). The kernel builds the
 * name; a client never names a store. Either way the request is the kernel's,
 * scrubbed of `VOUCH` and built here and nowhere else.
 *
 * And therefore the one place a hop to a store is counted (hops.ts): every
 * caller reaches an object through here — `storeOf` below is this function
 * with a stub behind it, and the store's own door onto the directory is this
 * function with the object behind it — so `hops;dur=<n>` on a request is
 * exact rather than a sample. A retry (`storeOf`) is two hops, which is what
 * it cost. It is also the one place a write to a store is seen, whichever
 * door made it: a read this request remembers is never answered from before
 * it (hops.ts `writing`, directory.ts `directory`). */
export let doorOf = (
  send: (req: Request) => Promise<Response>,
  name: string,
  app?: Served,
): Door =>
  opened((req) => {
    vouched(req, name, app)
    let read = req.method == 'GET' || req.method == 'HEAD'
    return metered(
      name == PLATFORM_STORE ? 'directory_wait' : 'store_wait',
      () => read ? send(req) : writing(name, () => send(req)),
      asked(req),
    )
  }, VOUCH)

/** A request factory, not a spent Request: every send gets its own body.
 * Each carries the caller's deploy (running.ts `stamp`). Named an `as`, each
 * round trip is counted and timed under it, with the costs its answer
 * reports (`metered`). Finite read answers are received inside the retry; a
 * POST that reads or is idempotent opts in with `replayable: true`. Other
 * POST bodies stay with their caller, since receiving their headers already
 * says their work may have applied. One that says `replayable: false` is
 * never sent twice. */
export let fetchOf = (
  ns: Namespace,
  name: string,
  wait?: (ms: number) => Promise<void>,
  as?: string,
) =>
(make: () => Request, options: Call = {}): Promise<Response> => {
  let send = () =>
    retried(
      async () => {
        let req = stamped(make())
        let answer = await stubOf(ns, objectOf(name)).fetch(req)
        let read = req.method == 'GET' || req.method == 'HEAD'
        return (options.replayable ?? read)
          ? received(await thrown(answer))
          : answer
      },
      options.replayable !== false,
      unserved,
      wait,
    )
  return as ? metered(as, send) : send()
}

/**
 * A start sent ahead of what a caller will ask an object (`WARM`, `WAKE`), so
 * the object is up when it asks: a new object takes 150 to 500 ms to start
 * before any code of ours runs in it, and an isolate's first boot spends as
 * long again on CPU (T-149696). Nobody waits on its answer, so it is no trip
 * of the request's (hops.ts `apart`), and a failure is reported, never met.
 * `retain` holds it past the answer (the request's own `waitUntil` unless
 * named).
 */
export let ahead = (
  send: () => Promise<Response>,
  tags: Record<string, string>,
  retain: (work: Promise<void>) => void = background,
): void =>
  retain(
    apart(() =>
      send().then(
        (r) => r.body?.cancel(),
        (e) => caught(e, tags),
      )
    ),
  )

let stamped = (req: Request) => (stamp(req.headers), req)

let storeAnswer = async (name: string, req: Request, answer: Response) => {
  if (answer.status != 503) return answer
  let url = new URL(req.url)
  let directoryQuery = name == PLATFORM_STORE && url.pathname == '/query'
  let said = await answer.clone().json().catch(() => null) as {
    error?: string
    refusal?: { status?: number; body?: Partial<Refusal> }
  } | null
  if (said?.error != 'Skewed') return answer
  let { status, body: old } = said.refusal ?? {}
  // An older Store could wrap any refusal in a skew response. Return ordinary
  // refusals and stale-write conflicts before the door resends the call.
  if (
    old && status != null && status >= 400 && status < 500 &&
    !refuses(status, old)
  ) {
    return Response.json(old, { status })
  }
  // A directory query can be checked against this deploy's vocabulary without
  // reaching storage. The older store's refusal may still apply on new code.
  if (!directoryQuery || status != 400) return answer
  if (old?.error != 'Unknown' && old?.error != 'Unsupported') return answer
  let { platformVocab } = await import('./vocab.ts')
  let current = confirmedRefusal(
    url.searchParams.get('q') ?? '',
    platformVocab(),
    old,
  )
  return current ? refuse(current) : answer
}

/** The kernel's door to one store, sent again when the runtime resets it or
 * loses the call (@yaks/durable-object `resending`). Every call to a store
 * comes through here, so this is the one place a deploy's move is
 * answered: no caller handles a reset, and none can miss one. The stub is
 * taken per call (`placed`), since a door memoized for the isolate (meta.ts
 * `doors`) is reused on later requests and a stub is bound to the request
 * that took it ("cannot perform I/O on behalf of a different request"). A
 * kill for the store's limits or a refusal for memory is a defect, reported
 * before anything retries. A caller that will send a write again itself (a
 * page resending after a 202) names the idempotency key, and the door keeps
 * it. `wait` waits out each pause before a resend. */
export let storeOf = (
  ns: Namespace,
  name: string,
  app?: Served,
  wait?: (ms: number) => Promise<void>,
): Door => {
  let open = async (req: Request) =>
    storeAnswer(name, req, await placed(ns, name).fetch(req))
  return resending(doorOf(open, name, app), {
    report: (e, path) =>
      defect(e, { request: `store ${path.split('?')[0]}`, store: name }),
    // Report a store still behind under the word it refused. A resend the
    // newer code answered reports nothing.
    settled: (failure, path) => {
      let answer = settled(
        failure,
        name == PLATFORM_STORE && path.split('?')[0] == '/query',
      )
      if (answer) {
        defect(
          failure,
          { request: `store ${path.split('?')[0]}`, store: name },
          {
            fault: behind(failure, path),
          },
        )
        if (answer.status >= 500) answer.headers.set(FILED, '1')
      }
      return answer
    },
    wait,
  })
}
