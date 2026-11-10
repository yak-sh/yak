// How many round trips a request made, counted where they are made and read
// where the request ends. A stage that is slow because it waited once on a
// slow service and a stage that is slow because it waited forty times on a
// fast one look identical in a duration (timing.ts) — and the second is the
// bug we keep writing. The count is the half that tells them apart.
//
// The counter is ambient rather than threaded because a round trip is made
// three or four layers below whoever holds the request: door.ts builds every
// request to a store, objects.ts every call to a bucket, db.ts every statement,
// and none of the three is handed the request they belong to. AsyncLocalStorage
// is exactly the thing that carries a request's own context down through its
// awaits without a parameter on forty call sites; workerd offers it under
// `nodejs_compat` (wrangler.toml) and Deno under the same import.
//
// A hop made outside any `tallying` is simply not counted: nothing here
// throws, nothing is global, and nothing outlives the request that opened it.
//
// And the round trip not made twice: a read this request already made is
// answered again from what came back (`recall`), until the request writes to
// the store it read — which is counted here too, at the one door every write
// passes (door.ts), so a write by any caller is seen by every reader.
import { AsyncLocalStorage } from 'node:async_hooks'
import { unwatched, waiting } from './waits.ts'

/** Round trips by name, for one request. Names are fine-grained on purpose —
 * `r2.get` and `r2.put` are separate lines a test can assert — and `counts`
 * is what rolls them up for the header. */
export type Tally = Map<string, number>

let here = new AsyncLocalStorage<Tally>()

// What each request in flight has already read (`recall`), keyed by its tally
// and kept only while its `work` runs: a finished request's tally can stay
// ambient for whatever runs next (Deno's test runner does this), and a read
// made then is an ordinary read.
type Held = { fresh: boolean; answer: Promise<unknown> }
let reads = new WeakMap<Tally, Map<string, Held>>()

// When each tally began counting, for the stages it reaches (`reached`).
let begun = new WeakMap<Tally, number>()

/** Run `work` with `tally` as the ambient count for everything it awaits. */
export let tallying = <T>(tally: Tally, work: () => T): T =>
  here.run(tally, () => {
    if (!begun.has(tally)) begun.set(tally, Date.now())
    let held = new Map<string, Held>()
    reads.set(tally, held)
    let close = () => reads.get(tally) == held && reads.delete(tally)
    let out = work()
    if (!(out instanceof Promise)) return close(), out
    return out.finally(close) as T
  })

/** How long ago `tally` began counting, if it has. */
export let since = (tally: Tally): number | undefined => {
  let at = begun.get(tally)
  return at == null ? undefined : Date.now() - at
}

/** `value`, noting on this request's tally when it first reached `stage`, in
 * ms from its start (`at_<stage>`): the waits a tally sums overlap, so these
 * say which stage a slow request waited on. */
export let reached = <T>(stage: string, value: T): T => {
  let tally = here.getStore()
  let ms = tally && since(tally)
  if (tally && ms != null && !tally.has(`at_${stage}`)) {
    tally.set(`at_${stage}`, ms)
  }
  return value
}

/** The tally the work running now counts on, if any. */
export let ambient = (): Tally | undefined => here.getStore()

/** Run `work` outside any request's count. What a store does on its own
 * after answering (its effect pool) is no request's round trip, though it
 * starts inside one. A run with no tally, not `exit`: Deno's `exit` holds
 * only until the work's first await, and the request's count came back after
 * it. */
export let apart = <T>(work: () => T): T =>
  here.run(undefined as unknown as Tally, () => unwatched(work))

/** One round trip, named. A no-op wherever nobody is counting.
 *
 * `tally` names one outright, for a caller holding the map itself — a test
 * driving a seam with no request around it (versions_test.ts). Left out, the
 * ambient one is used, which is the whole point of this module. */
export let hop = (name: string, n = 1, tally = here.getStore()) => {
  if (tally) tally.set(name, (tally.get(name) ?? 0) + n)
}

/** A write to a store, counted when it is sent and again when it is answered,
 * so this request can tell a read made before it from one made after — and
 * from one made while it was in flight, which could have seen either
 * ({@link recall}). */
export let writing = <T>(store: string, send: () => Promise<T>): Promise<T> => {
  let tally = here.getStore()
  let mark = () => hop(`wrote:${store}`, 1, tally)
  mark()
  return send().finally(mark)
}

/** This request's readings of `store` answer nothing more: its next asking
 * reads again, as after its own write. For a request waiting on another's
 * write (versions.ts `waiting`), which its first reading would otherwise
 * answer for as long as it waits. */
export let forget = (store: string) => hop(`wrote:${store}`)

// How many times this request has marked a write to `store` (`writing`).
let written = (store: string, tally: Tally) => tally.get(`wrote:${store}`) ?? 0

/** Where the request now stands in its writes to `store`: equal at two
 * moments when it wrote nothing there between them, so what it read at the
 * first still answers at the second. Nothing outside a request, where no
 * write is counted and nothing can be said. */
export let wrote = (store: string): number | undefined => {
  let tally = here.getStore()
  return tally && reads.has(tally) ? written(store, tally) : undefined
}

/** A read of `store`, made once per request: asking the same `key` again is
 * answered from the first asking, until this request writes to that store
 * ({@link writing}), and then it is read again. A `fresh` asking is answered
 * only by a fresh reading, and any reading answers an ordinary one, so an
 * answer never goes back in time within the request. Outside any request it
 * is simply read. A read that fails is forgotten, so the next asking tries.
 * An optional decoder gives each caller its own value; decoding failures
 * forget the corresponding transport answer too. */
export function recall<T>(
  store: string,
  key: string,
  read: () => Promise<T>,
  fresh?: boolean,
): Promise<T>
export function recall<T, R>(
  store: string,
  key: string,
  read: () => Promise<T>,
  fresh: boolean,
  decode: (value: T) => R | Promise<R>,
): Promise<R>
export function recall<T, R>(
  store: string,
  key: string,
  read: () => Promise<T>,
  fresh = false,
  decode?: (value: T) => R | Promise<R>,
): Promise<T | R> {
  let tally = here.getStore()
  let held = tally && reads.get(tally)
  let at = tally && held
    ? `${store} ${written(store, tally)} ${key}`
    : undefined
  let hit = at ? held?.get(at) : undefined
  let answer = hit && (hit.fresh || !fresh) ? hit.answer as Promise<T> : read()
  if (held && at) held.set(at, { fresh: hit?.fresh || fresh, answer })
  // Decode each caller's value without caching it. A bad body is a failed
  // read too, and must not poison the request's next asking.
  let result = decode ? answer.then(decode) : answer
  if (held && at) {
    result.catch(() => held.get(at)?.answer == answer && held.delete(at))
  }
  return result
}

/** The two numbers a request reports: store hops, and bucket operations —
 * every `r2.*` verb summed, since what matters to a caller is how many times
 * the bucket was asked, not which verb asked it. */
export let counts = (tally: Tally) => {
  let r2 = 0
  for (let [name, n] of tally) if (name.startsWith('r2.')) r2 += n
  return { hops: tally.get('hops') ?? 0, r2 }
}

/** How long a request waited for its object to start, noted on its tally:
 * only a request that arrived before the start finished has anything to say. */
export let waited = (
  tally: Tally,
  waking: boolean,
  since: number,
  now: number,
) => {
  if (waking) tally.set('wake', now - since)
}

/** The headers a store's answer carries about the work behind it. */
export let reported = (tally: Tally): Record<string, string> => {
  let { hops, r2 } = counts(tally)
  let header = (name: string) =>
    tally.has(name) ? { [`x-yak-${name}`]: String(tally.get(name)) } : {}
  let waits = [...tally].filter(([name]) => name.endsWith('_wait'))
  return {
    'x-yak-hops': String(hops),
    'x-yak-stmts': String(tally.get('stmts') ?? 0),
    ...header('rows'),
    'x-yak-r2': String(r2),
    ...header('wake'),
    ...waits.length
      ? { [WAITS]: waits.map(([name, ms]) => `${name}=${ms}`).join(',') }
      : {},
  }
}

/** The header a store's answer names its waits in, `name=ms,…`. */
export let WAITS = 'x-yak-waits'

/** The waits a store's answer names, onto this request's tally. */
export let heard = (header: string | null) => {
  for (let said of header?.split(',') ?? []) {
    let [name, ms] = said.split('=')
    if (name?.endsWith('_wait') && /^\d+$/.test(ms ?? '')) hop(name, Number(ms))
  }
}

/** One wait of a traced request: its name, when it began and how long it
 * took, in ms from the request's start, and what it asked, where said. */
export type Span = [name: string, at: number, ms: number, what?: string]

// The waits of each request whose waits are traced (`traced`), in the order
// they ended.
let spans = new WeakMap<Tally, Span[]>()

/** Trace each wait `tally` makes from now on (`spansOf`): where the sum of a
 * stage's waits says how long it waited, these say on what, and which waits
 * overlapped. */
export let traced = (tally: Tally) => void spans.set(tally, [])

/** The waits a traced request made, as they ended. */
export let spansOf = (tally: Tally): Span[] => spans.get(tally) ?? []

/** Waiting on internal I/O, accumulated on this request's own tally, and
 * traced with `what` it asked where the request is (`traced`). */
export let elapsed = async <T>(
  name: string,
  work: () => Promise<T>,
  what?: string,
): Promise<T> => {
  let tally = here.getStore()
  let at = Date.now()
  try {
    return await waiting(name, work)
  } finally {
    hop(name, Date.now() - at, tally)
    trace(tally, name, at, what)
  }
}

/** `work`, traced as `name` where the request is (`traced`) but summed
 * nowhere: a stretch that is part of a wait already counted, such as reading
 * the body of an answer whose headers ended its round trip. */
export let spanned = async <T>(
  name: string,
  work: () => Promise<T>,
  what?: string,
): Promise<T> => {
  let tally = here.getStore()
  let at = Date.now()
  try {
    return await work()
  } finally {
    trace(tally, name, at, what)
  }
}

let trace = (tally: Tally | undefined, name: string, at: number, what = '') => {
  let now = Date.now()
  let begun = tally && since(tally)
  if (tally && begun != null) {
    spans.get(tally)?.push([
      name,
      at - (now - begun),
      now - at,
      what || undefined,
    ])
  }
}
