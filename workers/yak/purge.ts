// Taking pages out of the edge cache when what they show has changed
// (T-124418). The Site entrypoint keeps each public page an app serves
// (site.ts), tagged with its app and its space, and only Site can take them
// out again: a purge reaches the entrypoint that called it and no other
// (developers.cloudflare.com/workers/cache/purge/), so Site answers a
// `purge(tags)` RPC, which never goes through its cache.
//
// Cloudflare holds a whole account to its free tier's purge rate whatever the
// plan: a burst of about 25, then 5 a minute, shared by every Worker on the
// account (measured 2026-10-14, a refusal is error 1134). A purge carries up
// to 100 tags, so writers' tags ride together: one purge is in flight at a
// time, and every tag owed while it flies goes in the next one. Run where one
// object owes them all — the directory, whose writes they follow
// (facets/pages-graph.ts) — that is every purge the platform sends.

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
// The refusal that means "too many, wait".
let LIMITED = 1134
// How long a refused batch waits before each try again: a token comes back
// every twelve seconds, so the last wait spans one. A writer waits through
// all of them; past the last, the pages keep their short lifetime (site.ts
// `KEPT`) and the failure is reported.
let WAITS = [1_000, 4_000, 12_000]

let sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/** A purge refused, and why. */
export class Unpurged extends Error {}

/**
 * Purges for one Site: `purge(tags)` resolves once those tags are gone from
 * the cache, sharing a batch with every tag owed beside them.
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
export let purger = (site: Purges, wait = sleep) => {
  let owed = new Set<string>()
  let next: Promise<void> | null = null
  let flying: Promise<unknown> = Promise.resolve()
  let send = async (tags: string[]) => {
    for (let at = 0; at < tags.length; at += BATCH) {
      let batch = tags.slice(at, at + BATCH)
      for (let tries = 0;; tries++) {
        let said = await site.purge(batch)
        if (said.success) break
        if (
          tries == WAITS.length ||
          !said.errors.some((e) => e.code == LIMITED)
        ) {
          throw new Unpurged(
            `purge of ${batch.length} tags refused: ${
              said.errors.map((e) => `${e.code} ${e.message}`).join('; ')
            }`,
          )
        }
        await wait(WAITS[tries])
      }
    }
  }
  return (tags: string[]): Promise<void> => {
    if (!tags.length) return Promise.resolve()
    for (let tag of tags) owed.add(tag)
    return next ??= flying.then(() => {
      let tags = [...owed]
      owed.clear()
      next = null
      let sent = send(tags)
      flying = sent.catch(() => {})
      return sent
    })
  }
}

// One purger per Site binding, so writers in one object share its batches.
let purgers = new WeakMap<object, ReturnType<typeof purger>>()

/** Purge `tags` from `site`'s cache. A Site with no purge has no cache (a
 * test run, `wrangler dev`), so there is nothing to do. */
export let purge = (site: Partial<Purges> | undefined, tags: string[]) => {
  let send = site?.purge
  if (!site || !send || !tags.length) return Promise.resolve()
  let p = purgers.get(site)
  if (!p) {
    purgers.set(site, p = purger({ purge: (tags) => send.call(site, tags) }))
  }
  return p(tags)
}
