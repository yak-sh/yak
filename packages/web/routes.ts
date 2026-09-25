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

/** What this facet reads off the host it is composing into: the vocabulary
 * its plugins loaded. */
export type Hosting = { vocab: Vocab }

/** Every letter an id in this vocabulary can start with, in both cases. */
export let letters = (vocab: Vocab): string[] => {
  let letter = prefixOf(vocab)
  let upper = new Set(vocab.all.map((comp) => letter(comp)))
  return [...upper].flatMap((l) => [l, l.toLowerCase()]).sort()
}

let sha = async (body: string | Uint8Array<ArrayBuffer>) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof body == 'string' ? new TextEncoder().encode(body) : body,
      ),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)

// A body the browser may keep, revalidated on each load by its hash.
let kept = async (request: Request, body: string | Uint8Array<ArrayBuffer>, type: string) => {
  let tag = `"${await sha(body)}"`
  let headers = {
    'content-type': type,
    'cache-control': 'no-cache',
    etag: tag,
  }
  return request.headers.get('if-none-match') == tag
    ? new Response(null, { status: 304, headers })
    : new Response(body, { headers })
}

// A body made on its first request and kept for the life of the process. A
// failure is not kept: the next request tries again, and says why meanwhile.
let served = (
  type: string,
  make: () => Promise<string | Uint8Array<ArrayBuffer>>,
  early = false,
) => {
  let made: Promise<string | Uint8Array<ArrayBuffer>> | undefined
  if (early) made = make()
  return async (request: Request) => {
    try {
      return await kept(request, await (made ??= make()), type)
    } catch (e) {
      made = undefined
      console.error(e)
      return new Response(String((e as Error).message ?? e), { status: 500 })
    }
  }
}

let here = (path: string) => new URL(path, import.meta.url)
let text = (path: string) => () => fetch(here(path)).then((r) => r.text())
let bytes = (path: string) => () =>
  fetch(here(path)).then(async (r) => new Uint8Array(await r.arrayBuffer()))

let files: [string, string, () => Promise<string | Uint8Array<ArrayBuffer>>][] = [
  ['styles.css', 'text/css; charset=utf-8', text('./styles.css')],
  ['manifest.webmanifest', 'application/manifest+json', text('./manifest.webmanifest')],
  ...['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']
    .map((name): [string, string, () => Promise<Uint8Array<ArrayBuffer>>] => [name, 'image/png', bytes(`./${name}`)]),
]

/** The page at every entity's address, `/web/*`, and the vocabulary. */
export let routes = (host: Hosting): Route[] => {
  let page = served('text/html; charset=utf-8', text('./index.html'))
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
      handle: served('text/javascript; charset=utf-8', bundle, true),
    },
    ...files.map(([name, type, make]): Route => ({
      method: 'GET',
      path: `/web/${name}`,
      handle: served(type, make),
    })),
    {
      method: 'GET',
      path: '/web/vocab.json',
      handle: served('application/json', () => Promise.resolve(vocab)),
    },
  ]
}
