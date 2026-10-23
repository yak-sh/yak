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
): () => Promise<boolean> => {
  let loaded = tag()
  return async () => {
    let [was, now] = [await loaded, await tag()]
    return !!was && !!now && was != now
  }
}

/** This page's: asked once as it loads, and again whenever it is asked. A
 * process with no page (a test, a terminal) never outlives anything. */
export let outlived: () => Promise<boolean> =
  typeof location != 'undefined' && typeof fetch != 'undefined'
    ? outliving(tagged())
    : () => Promise.resolve(false)
