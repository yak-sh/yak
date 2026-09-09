// How many round trips a request made, counted where they are made and read
// where the request ends. A stage that is slow because it waited once on a
// slow service and a stage that is slow because it waited forty times on a
// fast one look identical in a duration (timing.ts) — and the second is the
// bug we keep writing. The count is the half that tells them apart.
//
// The counter is AMBIENT rather than threaded because a round trip is made
// three or four layers below whoever holds the request: door.ts builds every
// request to a store, blobs.ts every call to a bucket, db.ts every statement,
// and none of the three is handed the request they belong to. AsyncLocalStorage
// is exactly the thing that carries a request's own context down through its
// awaits without a parameter on forty call sites; workerd offers it under
// `nodejs_compat` (wrangler.toml) and Deno under the same import.
//
// A hop made outside any `tallying` is simply not counted: nothing here
// throws, nothing is global, and nothing outlives the request that opened it.
import { AsyncLocalStorage } from 'node:async_hooks'

/** Round trips by name, for one request. Names are fine-grained on purpose —
 * `r2.get` and `r2.put` are separate lines a test can assert — and `counts`
 * is what rolls them up for the header. */
export type Tally = Map<string, number>

let here = new AsyncLocalStorage<Tally>()

/** Run `work` with `tally` as the ambient count for everything it awaits. */
export let tallying = <T>(tally: Tally, work: () => T): T =>
  here.run(tally, work)

/** One round trip, named. A no-op wherever nobody is counting.
 *
 * `tally` names one outright, for a caller holding the map itself — a test
 * driving a seam with no request around it (versions_test.ts). Left out, the
 * ambient one is used, which is the whole point of this module. */
export let hop = (name: string, n = 1, tally = here.getStore()) => {
  if (tally) tally.set(name, (tally.get(name) ?? 0) + n)
}

/** The two numbers a request reports: store hops, and bucket operations —
 * every `r2.*` verb summed, since what matters to a caller is how many times
 * the bucket was asked, not which verb asked it. */
export let counts = (tally: Tally) => {
  let r2 = 0
  for (let [name, n] of tally) if (name.startsWith('r2.')) r2 += n
  return { hops: tally.get('hops') ?? 0, r2 }
}
