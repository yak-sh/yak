// The `yak/client` routes facet: the store client an app's pages import
// (./client.js), at `./api/client.js` beside the doors it wraps, for a host
// that builds it where it serves it. Bundled once, as the host warms, so the
// first page load finds it made. yaks.app serves the same module from its
// built assets instead (workers/yak client-assets.ts), so its Worker lists
// no `yak/client`.
import type { Route } from '@yaks/api/routed'
import { bundle, kept } from '@yaks/cli/page'

/** Where a page finds its client: beside its store's doors, which a host
 * serving this facet answers under `/api` (@yaks/api `under`). */
export let CLIENT = '/api/client.js'

export let routes = (host: {
  early?: (make: () => Promise<unknown>) => void
  stopping?: AbortSignal
}): Route[] => [{
  method: 'GET',
  path: CLIENT,
  handle: kept(
    CLIENT,
    'text/javascript; charset=utf-8',
    (signal) => bundle(new URL('./client.js', import.meta.url), signal),
    { early: host.early, closing: host.stopping },
  ),
}]
