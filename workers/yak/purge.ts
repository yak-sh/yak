// Taking pages out of the edge cache when what they show has changed
// (T-124418). The Site entrypoint keeps each public page an app serves
// (site.ts), tagged with its app and its space, and only Site can take them
// out again: a purge reaches the entrypoint that called it and no other
// (developers.cloudflare.com/workers/cache/purge/), so Site answers a
// `purge(tags)` RPC, which never goes through its cache.
//
// Cloudflare holds a whole account to its free tier's purge rate whatever the
// plan: a bucket of 25, a token back every twelve seconds, shared by every
// Worker on the account (developers.cloudflare.com/workers/cache/purge/; a
// refusal is error 1134). So every purge goes through one Durable Object, the
// Purger (index.ts), which keeps the account's bucket: a purge waits for a
// token rather than spend a refusal, and every tag owed while it waits rides
// with it, up to 100 a purge. The directory, whose writes they follow
// (facets/pages-graph.ts), and a release, which purges its app as it raises
// its fence (tools.ts `released`), send theirs there.
//
// An acknowledged purge has not reached every cache yet. Over about ninety
// deploys measured from the box, four times a page kept in a colo other than
// the purge's still answered a second or more after the purge was
// acknowledged (T-124483); its short lifetime (page-cache.ts `KEPT`) bounds
// it.

/** What Cloudflare answers a purge with. */
export type Purged = {
  success: boolean
  errors: { code: number; message: string }[]
}

/** The Site entrypoint, as far as purging asks of it. */
export type Purges = { purge(tags: string[]): Promise<Purged> }

/** The tag on every answer an app gave, and on every answer in a space. */
export let appTag = (eid: string) => `app:${eid}`
export let spaceTag = (eid: string) => `space:${eid}`

// One purge's tags at most (Cloudflare's operations per request).
let BATCH = 100
// The account's bucket, as Cloudflare keeps it.
let BUCKET = 25
let REFILL = 12_000
// The refusal that means "too many, wait".
let LIMITED = 1134
// How many refusals a tag takes before it is given up on. A refusal means
// the bucket is emptier than the Purger knew (a new Purger starts it full),
// and it waits a token out before trying again; past the last, the pages
// keep their short lifetime (page-cache.ts `KEPT`) and the failure is
// reported.
let TRIES = 3

let sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/** A purge refused, and why. */
export class Unpurged extends Error {}

// Tags owed together, and the writers waiting on them.
type Round = {
  tags: Set<string>
  done: PromiseWithResolvers<void>
  refused: number
}
let round = (): Round => ({
  tags: new Set(),
  done: Promise.withResolvers(),
  refused: 0,
})
// A round going again takes in the one owed since, and settles it with its own.
let merge = (r: Round, later: Round | null) => {
  if (!later) return r
  for (let tag of later.tags) r.tags.add(tag)
  r.done.promise.then(later.done.resolve, later.done.reject)
  return r
}

/**
 * Purges for one Site: `purge(tags)` resolves once those tags are gone from
 * the cache, sharing a purge with every tag owed beside them. One purge is in
 * flight at a time, each spends a token of the bucket, and with none left the
 * next waits for one.
 *
 * ```ts
 * import { purger } from './purge.ts'
 * import { assertEquals } from '@std/assert'
 * let sent: string[][] = []
 * let started = Promise.withResolvers<void>()
 * let slow = Promise.withResolvers<void>()
 * let site = {
 *   purge: async (tags: string[]) => {
 *     sent.push(tags)
 *     started.resolve()
 *     await slow.promise
 *     return { success: true, errors: [] }
 *   },
 * }
 * let purge = purger(site)
 * let first = purge(['app:a'])
 * await started.promise
 * let then = [purge(['app:b']), purge(['app:c', 'app:b'])]
 * slow.resolve()
 * await Promise.all([first, ...then])
 * assertEquals(sent, [['app:a'], ['app:b', 'app:c']])
 * ```
 */
export let purger = (site: Purges, wait = sleep, now = Date.now) => {
  let owed: Round | null = null
  let flying = false
  let tokens = BUCKET, at = now()
  let token = async () => {
    for (;;) {
      let t = now()
      tokens = Math.min(BUCKET, tokens + (t - at) / REFILL)
      at = t
      if (tokens >= 1) return void tokens--
      await wait((1 - tokens) * REFILL)
    }
  }
  let send = async (r: Round) => {
    let batch = [...r.tags].slice(0, BATCH)
    let said = await site.purge(batch)
    if (said.success) { for (let tag of batch) r.tags.delete(tag) }
    else {
      let limited = said.errors.some((e) => e.code == LIMITED)
      if (limited) tokens = 0
      if (!limited || ++r.refused == TRIES) {
        throw new Unpurged(
          `purge of ${batch.length} tags refused: ${
            said.errors.map((e) => `${e.code} ${e.message}`).join('; ')
          }`,
        )
      }
    }
    if (r.tags.size) owed = merge(r, owed)
    else r.done.resolve()
  }
  // Writers in one turn share the first purge, and everything owed while a
  // purge flies or waits for its token shares the next.
  let fly = async () => {
    await null
    while (owed) {
      await token()
      let r = owed
      owed = null
      await send(r).catch((e) => r.done.reject(e))
    }
    flying = false
  }
  return (tags: string[]): Promise<void> => {
    if (!tags.length) return Promise.resolve()
    owed ??= round()
    for (let tag of tags) owed.tags.add(tag)
    if (!flying) {
      flying = true
      void fly()
    }
    return owed.done.promise
  }
}

/** The Purger binding: the one Durable Object every purge goes through. */
export type Purgers = {
  idFromName(name: string): unknown
  get(id: unknown): { purge(tags: string[]): Promise<void> }
}

/** Purge `tags` from Site's cache, through the Purger. Where Site has no
 * cache (a test run, `wrangler dev`) none is bound, so there is nothing to
 * do. */
export let purge = (env: { PURGER?: Purgers }, tags: string[]) => {
  let { PURGER } = env
  if (!PURGER || !tags.length) return Promise.resolve()
  return PURGER.get(PURGER.idFromName('purger')).purge(tags)
}
