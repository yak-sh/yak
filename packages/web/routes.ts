// The routes facet, exported as `@yaks/web/routes`: the addresses a person
// opens in a browser. `/` is the root canvas, `/admin` the component tables,
// and each entity is at its own id — `/T-9`, or `/%23abc123` for one the
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
// `/web/*` is what that page loads: the app bundled from main.tsx, its
// stylesheet, icons and manifest, and the vocabulary exactly as the host
// loaded it, so the browser and the server read one set of components.

import type { Route } from '@yaks/api'
import { dead, type Graph } from '@yaks/graph'
import { prefixOf } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'
import { bundle } from './bundle.ts'
import { type Body, kept } from './kept.ts'

/** What this facet reads off the host it is composing into: the vocabulary
 * its plugins loaded, and the graph a name is resolved in. */
export type Hosting = {
  vocab: Vocab
  graph: Graph
  /** aborts as the host closes, ending the app's build if it is still going */
  stopping?: AbortSignal
}

/** Every letter an id in this vocabulary can start with, in both cases. */
export let letters = (vocab: Vocab): string[] => {
  let letter = prefixOf(vocab)
  let upper = new Set(vocab.all.map((comp) => letter(comp)))
  return [...upper].flatMap((l) => [l, l.toLowerCase()]).sort()
}

let here = (path: string) => new URL(path, import.meta.url)
let text = (path: string) => () => fetch(here(path)).then((r) => r.text())
let bytes = (path: string) => () =>
  fetch(here(path)).then(async (r) => new Uint8Array(await r.arrayBuffer()))

let files: [string, string, () => Promise<Body>][] = [
  ['styles.css', 'text/css; charset=utf-8', text('./styles.css')],
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

// Whether a path names an entity: one segment, resolved to an eid, and that
// entity alive. A name no plugin resolves is taken as an eid, and one a plugin
// recognises but finds naming nothing is refused: both are no entity.
let names = async (graph: Graph, path: string): Promise<boolean> => {
  let id = decodeURIComponent(path.slice(1))
  if (!id || id.includes('/')) return false
  try {
    let eid = (await graph.address([id])).get(id) ?? id
    let [row] = await graph.get([eid])
    return !!row && !dead(row)
  } catch {
    return false
  }
}

/** The page at every entity's address, `/web/*`, and the vocabulary. */
export let routes = (host: Hosting): Route[] => {
  let page = kept('/', 'text/html; charset=utf-8', text('./index.html'))
  let vocab = JSON.stringify(host.vocab.docs)
  let named = async (request: Request) => {
    if (await names(host.graph, new URL(request.url).pathname)) {
      return page(request)
    }
    let lost = await page(new Request(request.url))
    return new Response(lost.body, { status: 404, headers: lost.headers })
  }
  return [
    { method: 'GET', path: '/*', handle: named },
    { method: 'GET', path: '/', handle: page },
    { method: 'GET', path: '/admin', handle: page },
    { method: 'GET', path: '/admin/*', handle: page },
    { method: 'GET', path: '/%23*', handle: page },
    ...letters(host.vocab).flatMap((l): Route[] => [
      { method: 'GET', path: `/${l}-*`, handle: page },
      { method: 'GET', path: `/${l}`, handle: page },
    ]),
    {
      method: 'GET',
      path: '/web/app.js',
      // Started with the host, so the first page load finds it built.
      handle: kept('/web/app.js', 'text/javascript; charset=utf-8', bundle, {
        early: true,
        closing: host.stopping,
      }),
    },
    ...files.map(([name, type, make]): Route => ({
      method: 'GET',
      path: `/web/${name}`,
      handle: kept(`/web/${name}`, type, make),
    })),
    {
      method: 'GET',
      path: '/web/vocab.json',
      handle: kept(
        '/web/vocab.json',
        'application/json',
        () => Promise.resolve(vocab),
      ),
    },
  ]
}
