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

/** Run `work` with `tally` as the ambient count for everything it awaits. */
export let tallying = <T>(tally: Tally, work: () => T): T =>
  here.run(tally, () => {
    let held = new Map<string, Held>()
    reads.set(tally, held)
    let close = () => reads.get(tally) == held && reads.delete(tally)
    let out = work()
    if (!(out instanceof Promise)) return close(), out
    return out.finally(close) as T
  })

/** Run `work` outside any request's count. What a store does on its own
 * after answering (its effect pool) is no request's round trip, though it
 * starts inside one. */
export let apart = <T>(work: () => T): T => here.exit(work)

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

// How many times this request has marked a write to `store` (`writing`).
let written = (store: string, tally: Tally) => tally.get(`wrote:${store}`) ?? 0

/** A read of `store`, made once per request: asking the same `key` again is
 * answered from the first asking, until this request writes to that store
 * ({@link writing}), and then it is read again. A `fresh` asking is answered
 * only by a fresh reading, and any reading answers an ordinary one, so an
 * answer never goes back in time within the request. Outside any request it
 * is simply read. A read that fails is forgotten, so the next asking tries. */
export let recall = <T>(
  store: string,
  key: string,
  read: () => Promise<T>,
  fresh = false,
): Promise<T> => {
  let tally = here.getStore()
  let held = tally && reads.get(tally)
  if (!tally || !held) return read()
  let at = `${store} ${written(store, tally)} ${key}`
  let hit = held.get(at)
  if (hit && (hit.fresh || !fresh)) return hit.answer as Promise<T>
  let answer = read()
  held.set(at, { fresh, answer })
  answer.catch(() => held.get(at)?.answer == answer && held.delete(at))
  return answer
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
 * only the request that woke the object has anything to say. */
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

/** Waiting on internal I/O, accumulated on this request's own tally. */
export let elapsed = async <T>(
  name: string,
  work: () => Promise<T>,
): Promise<T> => {
  let tally = here.getStore()
  let at = Date.now()
  try {
    return await work()
  } finally {
    hop(name, Date.now() - at, tally)
  }
}
