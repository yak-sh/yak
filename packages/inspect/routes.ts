/**
 * The routes facet, exported as `@yaks/inspect/routes`: the inspector's own
 * page. `/inspect` is the first page and `/inspect/<pane>/…` a stack of
 * pages (./where.ts); each answers the one document, which loads the page's script (./main.ts, bundled
 * by @yaks/cli `bundle`) and its stylesheet: @yaks/ui's kit in Everforest,
 * since every part the page draws is @yaks/ui's. What the page reads and
 * writes is @yaks/api's doors, so a host serves it with @yaks/api and this
 * package, and nothing else.
 *
 * @module
 */

import type { Route } from '@yaks/api'
import { bundle, kept } from '@yaks/cli/page'
import { everforest, stylesheet } from '@yaks/ui'

/** What this facet reads off the host it is composing into. */
export type Hosting = {
  /** aborts as the host closes, ending the page's build if it is still going */
  stopping?: AbortSignal
}

/** The page every inspector address answers. */
export let PAGE = '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>inspect</title>' +
  '<link rel="stylesheet" href="/inspect/styles.css"></head>' +
  '<body><script type="module" src="/inspect/app.js"></script></body></html>'

let css = () => stylesheet(everforest)

/** `/inspect`, `/inspect/<pane>/…`, and what their page loads. */
export let routes = (host: Hosting = {}): Route[] => {
  let page = kept(
    '/inspect',
    'text/html; charset=utf-8',
    () => Promise.resolve(PAGE),
  )
  let app = new URL('./main.ts', import.meta.url)
  return [
    { method: 'GET', path: '/inspect', handle: page },
    { method: 'GET', path: '/inspect/*', handle: page },
    {
      method: 'GET',
      path: '/inspect/app.js',
      // Started with the host, so the first page load finds it built.
      handle: kept(
        '/inspect/app.js',
        'text/javascript; charset=utf-8',
        (signal) => bundle(app, signal),
        { early: true, closing: host.stopping },
      ),
    },
    {
      method: 'GET',
      path: '/inspect/styles.css',
      handle: kept('/inspect/styles.css', 'text/css; charset=utf-8', css),
    },
  ]
}
