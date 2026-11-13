import { type Application, application } from './app.ts'
// The routes facet, exported as `@yaks/web/routes`: the addresses a person
// opens in a browser. `/` is the root canvas, and each entity is at its own id — `/T-9`, or `/%23abc123` for one the
// store has not numbered. Every one of them answers the same page, and the app
// reads the address and draws the rest (main.tsx).
//
// The id routes are one prefix per series letter the vocabulary uses, in both
// cases. Any other path is a name an id may be written as (`/lemon-cake`, an
// alias), resolved the way every door resolves an id (Graph.address): the page
// when it names an entity, and the same page answered 404 when it names
// nothing, which the app draws as its 404 face. That route is a catch-all, and
// @yaks/api lets the route naming a path most closely answer it, so `/query`,
// `/ws` and every other plugin's route stay theirs.
//
// `/web/*` is what that page loads: the canvas (./canvas.ts), its stylesheet (@yaks/ui's in its default theme and skin, then this
// package's own), icons and manifest. The vocabulary is @yaks/api's `/vocab`.
//
// The page (./page.ts) carries the tracker's page reporter (@yaks/tracker/page)
// inline, ahead of its own code, as yaks.app weaves it into every app's page
// (workers/yak/page-script.ts). What it catches it posts to `/api/report`,
// which reads the body as yaks.app's door does (@yaks/tracker/report
// `received`) and hands each break to the host's own telemetry.

import { queryRedirect } from '@yaks/query'
import { applier, type Authenticate, type Route } from '@yaks/api'
import type { Graph, ReadOpts } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { addressId } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'
import { type Body, type Kept, kept } from '@yaks/cli/page'
import { OUTDATED, RUNS } from './outlived.ts'
import { made } from './canvas.ts'
import { page as html } from './page.ts'
import { preload } from './preload.ts'
import { person } from '@yaks/cli/host'
import type { Config } from '@yaks/cli/config'
import { type Context, received } from '@yaks/tracker/report'
import type { Vault } from '@yaks/secrets'
import { authorization } from './authorize.ts'
import { bytes, text } from '@yaks/api/asset'

/** What this facet reads off the host it is composing into: the vocabulary
 * its plugins loaded, and the graph a name is resolved in. */
export type Hosting = {
  config?: Config
  vocab: Vocab
  graph: Graph
  who?: Authenticate
  vault?: Vault
  /** aborts as the host closes, ending the app's build if it is still going */
  stopping?: AbortSignal
  /** where the page and the app's build are handed to start ahead of the
   * first request, as the host warms (@yaks/host `Host.early`) */
  early?: (make: () => Promise<unknown>) => void
  /** the host's telemetry, where what a page reports is sent */
  report?: (error: unknown, context?: Partial<Context>) => unknown
}

/** Every letter an id's page path can start with, in both cases. Any letter:
 * the number names the entity, and an id keeps the letter it was printed with
 * after its entity's components change. */
export let letters: string[] = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
  .flatMap((l) => [l, l.toLowerCase()])

let here = (path: string) => new URL(path, import.meta.url)

// @yaks/ui's stylesheet carries every component's CSS, so it loads when the
// stylesheet is first asked for, not before the server listens.
let styles = async (app: Application) =>
  (await Promise.all([
    import('@yaks/ui').then((ui) => ui.stylesheet(ui.composition)),
    app.styles ? text(app.styles) : '',
  ]))
    .join('\n')

let files: [string, string, () => Promise<Body>][] = [
  [
    'manifest.webmanifest',
    'application/manifest+json',
    () => text(here('./manifest.webmanifest')),
  ],
  ...[
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'apple-touch-icon.png',
  ]
    .map((
      name,
    ): [string, string, () => Promise<Uint8Array<ArrayBuffer>>] => [
      name,
      'image/png',
      () => bytes(here(`./${name}`)),
    ]),
]

// Whether a path names an entity to whoever asks: one segment, resolved to an
// eid the graph holds, alive or deleted (a deleted entity's page reads its
// history), read as the API's doors read for that person, so what their scope
// hides answers 404 as a name nothing carries does. A name no plugin resolves
// is taken as an eid, and one a plugin recognises but finds naming nothing is
// refused: both are no entity.
let names = async (
  graph: Graph,
  path: string,
  opts: ReadOpts,
): Promise<boolean> => {
  let id = addressId(decodeURIComponent(path.slice(1)))
  if (!id || id.includes('/')) return false
  try {
    let eid = (await graph.address([id], undefined, opts)).get(id) ?? id
    return (await graph.get([eid], undefined, opts)).length > 0
  } catch {
    return false
  }
}

// The page's bundle, one per host, which its routes serve and its filter
// compares a page's against. Made as the host warms, once it listens, so the
// first page load finds it built and the listening waits on none of the views.
let bundles = new WeakMap<Hosting, Kept>()
let bundle = (host: Hosting, options: Options): Kept => {
  let built = bundles.get(host) ?? kept(
    '/web/app.js',
    'text/javascript; charset=utf-8',
    (signal) => made(host.config?.plugins ?? [], options, signal),
    { early: host.early, closing: host.stopping },
  )
  bundles.set(host, built)
  return built
}

/**
 * Whether `request` is the socket of a page running older code than the
 * bundle tagged `now`. A page names the tag it loaded with (./outlived.ts
 * `running`); one that names none is a page from before it did, told by its
 * browser's `origin`, which a terminal or extension never sends as http(s).
 * Never before the bundle is made, nor for a page that cannot tell its tag.
 *
 * ```ts
 * import { behind } from '@yaks/web/routes'
 * import { equal } from '@yaks/testing'
 *
 * let ws = (query: string, origin?: string) =>
 *   new Request(`https://box.example/ws${query}`, {
 *     headers: origin ? { origin } : {},
 *   })
 * let page = 'https://box.example'
 * equal(behind(ws('?runs="a"'), '"b"'), true)
 * equal(behind(ws('?runs="b"'), '"b"'), false)
 * equal(behind(ws('?runs='), '"b"'), false)
 * equal(behind(ws('', page), '"b"'), true)
 * equal(behind(ws(''), '"b"'), false)
 * equal(behind(ws('', 'chrome-extension://abc'), '"b"'), false)
 * equal(behind(ws('?runs="a"'), undefined), false)
 * ```
 */
export let behind = (request: Request, now: string | undefined): boolean => {
  let url = new URL(request.url)
  if (url.pathname != '/ws' || !now) return false
  let runs = url.searchParams.get(RUNS)
  if (runs != null) return !!runs && runs != now
  return /^https?:/.test(request.headers.get('origin') ?? '')
}

/** Refuses the socket of a page running older code than the bundle served
 * now ({@link behind}): the page reloads on that refusal (@yaks/browse
 * live.ts), onto the code that reads what the server now sends. */
export let filter =
  (host: Hosting, options: Options = {}) => (request: Request): void => {
    if (!behind(request, bundle(host, options).tag())) return
    throw Object.assign(new Refused(OUTDATED.message), { name: OUTDATED.name })
  }

/** The page at every entity's address, and `/web/*`. */
export type Options = { home?: { title: string; query: string }; app?: string }

export let routes = (host: Hosting, options: Options = {}): Route[] => {
  // Made as the host warms.
  let cached = kept('/', 'text/html; charset=utf-8', html, {
    early: host.early,
  })
  let owner = () =>
    person({
      graph: host.graph,
      config: host.config ?? { db: ':memory:', plugins: [] },
    })
  let page = async (request: Request) => {
    let url = new URL(request.url)
    let redirect = url.pathname == '/' || url.pathname == '/inspect'
      ? queryRedirect(url)
      : undefined
    if (redirect) {
      return new Response(null, {
        status: 308,
        headers: { location: redirect },
      })
    }
    return preload(await cached(request))
  }
  let app = () => application(host.config?.plugins ?? [], options.app)
  let named = async (request: Request) => {
    let person = (await host.who?.(request))?.by ?? null
    if (await names(host.graph, new URL(request.url).pathname, { person })) {
      return page(request)
    }
    let lost = await page(new Request(request.url))
    return new Response(lost.body, { status: 404, headers: lost.headers })
  }
  return [
    ...host.vault && host.vocab.comp('connection')
      ? [authorization({ ...host, vault: host.vault })]
      : [],
    { method: 'GET', path: '/*', handle: named },
    {
      method: 'GET',
      path: '/',
      handle: page,
      says: 'the canvas: open it in a browser',
    },
    {
      method: 'GET',
      path: '/inspect',
      handle: (request) => {
        let url = new URL(request.url)
        url.pathname = '/'
        return new Response(null, {
          status: 308,
          headers: {
            location: queryRedirect(url) ?? '/' + url.search + url.hash,
          },
        })
      },
    },
    {
      method: 'POST',
      path: '/web/apply',
      handle: async (request) => {
        let by = await owner()
        // This door is the configured person's keyboard, in both web and TUI.
        // The API owns admission, stamps and writes; the page owns attribution.
        // A graph that names no person has no keyboard here to write as.
        if (!by) {
          throw new Refused(
            'This graph names no person for its page to write as',
          )
        }
        let via = await host.who?.(request)
        let writer = { by, via: via?.via ?? via?.by }
        return applier({ graph: host.graph, authenticate: () => writer })
          .apply(request)
      },
    },
    {
      method: 'GET',
      path: '/web/owner',
      handle: async () => Response.json({ owner: await owner() }),
    },
    {
      method: 'POST',
      path: '/api/report',
      // Whoever is looking at the page is the configured person, and the
      // reporter caps what one page load sends. A page telling of its own
      // outdated code (./outlived.ts `OUTDATED`) is no break.
      handle: async (request) => {
        let breaks = (await received(request))
          .filter((b) => !b.message.includes(OUTDATED.message))
        let by = breaks.length ? await owner() : undefined
        for (let b of breaks) {
          await host.report?.(
            Object.assign(
              new Error(b.message, b.cause ? { cause: b.cause } : undefined),
              { stack: b.stack },
            ),
            {
              mechanism: b.mechanism,
              breadcrumbs: b.breadcrumbs,
              tags: {
                entrypoint: 'browser report',
                request: b.request,
                ...by ? { user_id: by } : {},
                ...b.agent ? { agent: b.agent } : {},
              },
            },
          )
        }
        return new Response(null, { status: 204 })
      },
    },
    { method: 'GET', path: '/%23*', handle: page },
    ...letters.flatMap((l): Route[] => [
      { method: 'GET', path: `/${l}-*`, handle: page },
      { method: 'GET', path: `/${l}`, handle: page },
    ]),
    { method: 'GET', path: '/web/app.js', handle: bundle(host, options) },
    {
      method: 'GET',
      path: '/web/styles.css',
      handle: kept(
        '/web/styles.css',
        'text/css; charset=utf-8',
        async () => styles(await app()),
      ),
    },
    ...files.map(([name, type, make]): Route => ({
      method: 'GET',
      path: `/web/${name}`,
      handle: kept(`/web/${name}`, type, make),
    })),
  ]
}
