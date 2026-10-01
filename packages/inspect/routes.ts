/**
 * The routes facet, exported as `@yaks/inspect/routes`: the inspector's own
 * page. `/inspect` is the first page and `/inspect/<pane>/…` a stack of
 * pages (./where.ts); each answers the one document, which loads the page's
 * script and its stylesheet: @yaks/ui's kit in Everforest, since every part
 * the page draws is @yaks/ui's. What the page reads and writes is @yaks/api's
 * doors, so a host serves it with @yaks/api and this package, and nothing
 * else.
 *
 * The script is one bundle (@yaks/cli `bundle`) of an entry written for this
 * host: it imports the `/views` of each plugin the config names that draws an
 * inspector view of its own (./plugins.ts), and boots the page with them
 * (./main.ts).
 *
 * @module
 */

import type { Route } from '@yaks/api'
import type { Plug } from '@yaks/cli/config'
import { bundle, kept } from '@yaks/cli/page'
import { everforest, kits, stylesheet } from '@yaks/ui'
import { contributed } from './plugins.ts'
import type { AnatomyObserver } from '@yaks/code/anatomy'

/** What this facet reads off the host it is composing into. */
export type Hosting = {
  observe?: AnatomyObserver
  /** aborts as the host closes, ending the page's build if it is still going */
  stopping?: AbortSignal
  /** the config it was composed from: its plugins may draw their own kinds */
  config?: { plugins?: Plug[] }
}

/** The page every inspector address answers. */
export let PAGE = '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>inspect</title>' +
  '<link rel="stylesheet" href="/inspect/styles.css"></head>' +
  '<body><script type="module" src="/inspect/app.js"></script></body></html>'

let css = () => stylesheet({ kits, theme: everforest })

/**
 * The page's entry: `boot` with the inspector views each module of `specs`
 * exports (./plugins.ts), ahead of the inspector's own.
 *
 * ```ts
 * import { entry } from './routes.ts'
 * entry('file:///i/main.ts', ['file:///m/views.ts'])
 * // import { boot } from "file:///i/main.ts"
 * // import { inspectViews as v0 } from "file:///m/views.ts"
 * // boot([...v0])
 * ```
 */
export let entry = (main: string, specs: string[]): string =>
  [
    `import { boot } from ${JSON.stringify(main)}`,
    ...specs.map((s, i) =>
      `import { inspectViews as v${i} } from ${JSON.stringify(s)}`
    ),
    `boot([${specs.map((_, i) => `...v${i}`).join(', ')}])`,
  ].join('\n')

// The page's script: the entry for this host's plugins, and all it imports.
let app = async (host: Hosting, signal: AbortSignal) => {
  let from = await contributed(host.config?.plugins ?? [], host.observe)
  let main = new URL('./main.ts', import.meta.url)
  let specs = from.map((c) => import.meta.resolve(c.spec))
  return await bundle({ code: entry(main.href, specs), at: main }, signal)
}

/** `/inspect`, `/inspect/<pane>/…`, and what their page loads. */
export let routes = (host: Hosting = {}): Route[] => {
  let page = kept(
    '/inspect',
    'text/html; charset=utf-8',
    () => Promise.resolve(PAGE),
  )
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
        (signal) => app(host, signal),
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
