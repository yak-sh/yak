// Whether a page outlived the code it runs. The browser door serves its
// bundle with the bundle's sha as its etag (./routes.ts), and a deploy serves
// another. A page loaded before the deploy keeps running the old bundle, and
// what its old code asks (a live query naming a word the new vocabulary
// dropped) can be refused by the new server. Such a page is reloaded onto the
// code now served, rather than its refusals reported as bugs: a refusal on a
// page still running what is served is a bug, and is reported.

/** Where the page's bundle is served. */
export let BUNDLE = '/web/app.js'

/** Where its tag is asked: the bundle's route, at another address. Chrome
 * drops the page's cached bundle when the page fetches the bundle's own
 * address, in any method or cache mode, so every reload would download and
 * compile it again (T-132047). */
export let TAG = `${BUNDLE}?tag`

/** The tag the server gives its bundle now, or null where it gives none. */
export let tagged = (
  get: typeof fetch = fetch,
): () => Promise<string | null> =>
() =>
  get(TAG, { method: 'HEAD', cache: 'no-store' })
    .then((r) => r.ok ? r.headers.get('etag') : null, () => null)

/**
 * Whether the bundle served now differs from the one served when this was
 * made, page load: false where either tag is unknown, so a page that cannot
 * tell is never reloaded for it.
 *
 * ```ts
 * import { outliving } from '@yaks/web/outlived'
 * import { equal } from '@yaks/testing'
 *
 * let served = ['"a"', '"a"', '"b"']
 * let outlived = outliving(async () => served.shift() ?? null)
 * equal(await outlived(), false)
 * equal(await outlived(), true)
 * ```
 */
export let outliving = (
  tag: () => Promise<string | null>,
  loaded: Promise<string | null> = tag(),
): () => Promise<boolean> => {
  return async () => {
    let [was, now] = [await loaded, await tag()]
    return !!was && !!now && was != now
  }
}

let page = typeof location != 'undefined' && typeof fetch != 'undefined'
let loaded = page ? tagged()() : Promise.resolve(null)
let known: string | null = null
void loaded.then((tag) => known = tag)

/** This page's: asked once as it loads, and again whenever it is asked. A
 * process with no page (a test, a terminal) never outlives anything. */
export let outlived: () => Promise<boolean> = page
  ? outliving(tagged(), loaded)
  : () => Promise.resolve(false)

/** The parameter a page's socket names the tag of its bundle by, so the
 * server can refuse the socket of a page running older code (./routes.ts
 * `filter`): its refusal reloads the page. Empty where the tag is not known
 * yet. A page that names none predates the parameter. */
export let RUNS = 'runs'

/** What the server refuses such a socket with: every subscription it opens is
 * answered with it, and a page reloads on it. A page whose code cannot tell
 * it outlived a deploy reports it instead, which is expected, not a failure:
 * the server drops that report (./routes.ts `/api/report`). */
export let OUTDATED = {
  name: 'Outdated',
  message: 'this page runs older code than the server: reload it',
}

/** `url` naming the tag this page loaded with, for its socket. */
export let running = (url: string): string => {
  let at = new URL(url)
  at.searchParams.set(RUNS, known ?? '')
  return at.href
}
