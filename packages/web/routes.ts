// The routes facet, exported as `@yaks/web/routes`: the addresses a person
// opens in a browser. `/` is the root canvas, `/admin` the component tables,
// and each entity is at its own id — `/T-9`, or `/T%23abc123` for one the
// store has not numbered. Every one of them answers the same page, and the app
// reads the address and draws the rest (main.tsx).
//
// The id routes are one prefix per series letter the vocabulary uses, in both
// cases, rather than a catch-all: a host's routes are matched first, and a
// catch-all would answer `/query` and `/ws` before @yaks/api could.
//
// `/web/*` is what that page loads: the app bundled from main.tsx, its
// stylesheet, icons and manifest, and the vocabulary exactly as the host
// loaded it, so the browser and the server read one set of components.

import type { Route } from '@yaks/api'
import { prefixOf } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'
import { bundle } from './bundle.ts'
import { type Body, kept } from './kept.ts'

/** What this facet reads off the host it is composing into: the vocabulary
 * its plugins loaded. */
export type Hosting = { vocab: Vocab }

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

/** The page at every entity's address, `/web/*`, and the vocabulary. */
export let routes = (host: Hosting): Route[] => {
  let page = kept('/', 'text/html; charset=utf-8', text('./index.html'))
  let vocab = JSON.stringify(host.vocab.docs)
  return [
    { method: 'GET', path: '/', handle: page },
    { method: 'GET', path: '/admin', handle: page },
    { method: 'GET', path: '/admin/*', handle: page },
    { method: 'GET', path: '/%23*', handle: page },
    ...letters(host.vocab).flatMap((l): Route[] => [
      { method: 'GET', path: `/${l}-*`, handle: page },
      { method: 'GET', path: `/${l}%23*`, handle: page },
      { method: 'GET', path: `/${l}`, handle: page },
    ]),
    {
      method: 'GET',
      path: '/web/app.js',
      // Started with the host, so the first page load finds it built.
      handle: kept('/web/app.js', 'text/javascript; charset=utf-8', bundle, {
        early: true,
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
