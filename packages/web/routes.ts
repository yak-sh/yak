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
// `/web/*` is what that page loads: the app bundled from main.tsx (@yaks/cli
// `bundle`), its stylesheet (@yaks/ui's in Everforest, then this package's
// own), icons and manifest. The vocabulary is @yaks/api's `/vocab`.
//
// The page carries the tracker's page reporter (@yaks/tracker/page) inline,
// ahead of its own code, as yaks.app weaves it into every app's page
// (workers/yak/page-script.ts). What it catches it posts to `/api/report`,
// which reads the body as yaks.app's door does (@yaks/tracker/report
// `broken`) and hands each break to the host's own telemetry.

import { queryRedirect } from '@yaks/query'
import { type Authenticate, type Route, write } from '@yaks/api'
import type { Graph, ReadOpts } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { addressId } from '@yaks/id'
import { everforest, kits, stylesheet } from '@yaks/ui'
import type { Vocab } from '@yaks/vocab'
import { type Body, bundle, kept } from '@yaks/cli/page'
import { preload } from './preload.ts'
import { person } from '@yaks/cli/host'
import { type Config, located, subpath, used } from '@yaks/cli/config'
import { broken, type Context } from '@yaks/tracker/report'
import type { Registry } from '@yaks/render'
import type { Vault } from '@yaks/secrets'
import { authorization } from './authorize.ts'

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
  /** the host's telemetry, where what a page reports is sent */
  report?: (error: unknown, context?: Partial<Context>) => unknown
}

/** Every letter an id's page path can start with, in both cases. Any letter:
 * the number names the entity, and an id keeps the letter it was printed with
 * after its entity's components change. */
export let letters: string[] = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
  .flatMap((l) => [l, l.toLowerCase()])

let here = (path: string) => new URL(path, import.meta.url)
let text = (path: string) => () => fetch(here(path)).then((r) => r.text())
let bytes = (path: string) => () =>
  fetch(here(path)).then(async (r) => new Uint8Array(await r.arrayBuffer()))

// The page reporter as a script element at the page's root, where its door
// `api/report` is. `</script` in its text would end the element early; `<\/`
// is the same string to JavaScript.
let reporter = async () => {
  let code = await text(import.meta.resolve(located('@yaks/tracker/page')))()
  return `<script data-yak-at="/">${
    code.replace(/<\/(script)/gi, '<\\/$1')
  }</script>`
}

/** The page, its reporter first in its head. */
let html = async () => {
  let [page, script] = await Promise.all([text('./index.html')(), reporter()])
  return page.replace('<head>', `<head>${script}`)
}

let styles = async (app: Application) =>
  (await Promise.all([
    stylesheet({ kits, theme: everforest }),
    app.styles ? fetch(app.styles).then((r) => r.text()) : '',
  ]))
    .join('\n')

let files: [string, string, () => Promise<Body>][] = [
  [
    'manifest.webmanifest',
    'application/manifest+json',
    text('./manifest.webmanifest'),
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
      bytes(`./${name}`),
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

/** The page at every entity's address, and `/web/*`. */
export type Options = { home?: { title: string; query: string }; app?: string }

export let routes = (host: Hosting, options: Options = {}): Route[] => {
  let cached = kept('/', 'text/html; charset=utf-8', html)
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
    { method: 'GET', path: '/', handle: page },
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
        return write(host.graph, request, { by, via: via?.via ?? via?.by })
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
      // reporter caps what one page load sends.
      handle: async (request) => {
        let breaks = broken(await request.text())
        let by = breaks.length ? await owner() : undefined
        let agent = request.headers.get('user-agent')
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
                ...agent ? { agent } : {},
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
    {
      method: 'GET',
      path: '/web/app.js',
      // Started with the host, so the first page load finds it built.
      handle: kept(
        '/web/app.js',
        'text/javascript; charset=utf-8',
        async (signal) => {
          let specs: string[] = []
          for (let plug of host.config?.plugins ?? []) {
            let plugin = used(plug)
            let facet = await subpath<
              {
                views?: Registry
                inspectViews?: unknown[]
                destinations?: unknown[]
                home?: unknown
                tabs?: unknown[]
              }
            >(plugin, 'views')
            if (
              facet?.views || facet?.inspectViews || facet?.destinations ||
              facet?.home || facet?.tabs
            ) {
              specs.push(import.meta.resolve(located(`${plugin}/views`)))
            }
          }
          let chosen = await app()
          let main = chosen.mount
          let code = [
            `import ${
              JSON.stringify(new URL('./browser.ts', import.meta.url).href)
            }`,
            `import { mount } from ${JSON.stringify(main.href)}`,
            ...specs.map((s, i) =>
              `import * as f${i} from ${JSON.stringify(s)}`
            ),
            `await mount([${specs.map((_, i) => `f${i}`).join(',')}], ${
              JSON.stringify(options.home) ?? 'undefined'
            })`,
          ].join('\n')
          return bundle({ code, at: chosen.entry }, signal)
        },
        { early: true, closing: host.stopping },
      ),
    },
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
