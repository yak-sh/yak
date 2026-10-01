/** Native asset adapter. The data/stream core remains runtime-independent. */
import type { Route } from '@yaks/api'
import { bundle, kept } from '@yaks/cli/page'
import { everforest, kits, rosepine, stylesheet } from '@yaks/ui'
import { guarded, type Hosting, http } from './http.ts'

export let PAGE = '<!doctype html><html lang="en"><head>' +
  '<meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="color-scheme" content="dark light">' +
  '<title>visualize · System MRI</title>' +
  '<link rel="stylesheet" href="/visualize/styles.css">' +
  '<link id="visualize-theme" rel="stylesheet" ' +
  'href="/visualize/themes/everforest.css"></head>' +
  '<body><div id="visualize-root"></div>' +
  '<noscript>This atlas needs JavaScript. Agents can use the authenticated ' +
  '/visualize/anatomy and /visualize/activity doors.</noscript>' +
  '<script type="module" src="/visualize/app.js"></script></body></html>'

export let entry = (main: string) =>
  `import { boot } from ${JSON.stringify(main)}\nboot()`

let text = async (url: URL, signal: AbortSignal) => {
  let response = await fetch(url, { signal })
  if (!response.ok) throw new Error('asset unavailable')
  return await response.text()
}

/** The very same host policy protects HTML, every asset, metadata and leases.
 * No bundle or stylesheet is built until an authenticated request needs it. */
export let routes = (host: Hosting): Route[] => {
  let asset = (
    path: string,
    type: string,
    make: (signal: AbortSignal) => Promise<string>,
  ): Route => {
    let cached = kept(path, type, make, { closing: host.stopping })
    return { method: 'GET', path, handle: guarded(host, async (request) => {
      let response = await cached(request)
      // kept reports the build locally; its exception text is not page data.
      return response.status >= 500
        ? new Response('visualize asset unavailable', {
          status: 503, headers: { 'cache-control': 'no-store' },
        }) : response
    }) }
  }
  let page = asset('/visualize', 'text/html; charset=utf-8', () =>
    Promise.resolve(PAGE))
  return [
    page,
    { ...page, path: '/visualize/' },
    asset('/visualize/app.js', 'text/javascript; charset=utf-8', (signal) => {
      let main = new URL('./main.ts', import.meta.url)
      return bundle({ code: entry(main.href), at: main }, signal)
    }),
    asset('/visualize/styles.css', 'text/css; charset=utf-8', async (signal) =>
      (await stylesheet({ kits, theme: everforest })) + '\n' +
      (await text(new URL('./visualize.css', import.meta.url), signal))),
    ...Object.entries({ everforest, rosepine }).map(([name, theme]) =>
      asset(`/visualize/themes/${name}.css`, 'text/css; charset=utf-8',
        (signal) => text(theme.css, signal))),
    ...http(host),
  ]
}
