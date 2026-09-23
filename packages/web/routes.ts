// The routes facet, exported as `@yaks/web/routes`: the addresses a person
// opens in a browser. `/` is home, and each entity is at its own id — `/T-9`,
// or `/T#8d83e663ef` for one the store has not numbered, whose `#` the browser
// keeps to itself, so the server sees `/T`. Every one of them answers the same
// page; the app reads the address and draws the rest (./app.ts).
//
// The id routes are one prefix per series letter the vocabulary uses, in both
// cases, rather than a catch-all: a host's routes are matched first and a
// catch-all would answer `/query` and `/ws` before @yaks/api could.
//
// `/web/*` is what that page loads: the app bundled for this host's plugins
// (./bundle.ts), its stylesheet, and the vocabulary exactly as the host loaded
// it, so the browser and the server read one set of components.

import type { Route } from '@yaks/api'
import { prefixOf } from '@yaks/id'
import type { Vocab } from '@yaks/vocab'
import { bundle, entry, type Plug } from './bundle.ts'

/** What this facet reads off the host it is composing into: the config that
 * named the plugins, and the vocabulary they loaded. */
export type Hosting = {
  config: { name?: string; plugins?: Plug[] }
  vocab: Vocab
}

let escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The one page every address answers with. */
export let shell = (name: string): string =>
  `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(name)}</title>
<link rel="stylesheet" href="/web/style.css">
<script type="module" src="/web/client.js"></script>
`

/** Every letter an id in this vocabulary can start with, in both cases. */
export let letters = (vocab: Vocab): string[] => {
  let letter = prefixOf(vocab)
  let upper = new Set(vocab.all.map((comp) => letter(comp)))
  return [...upper].flatMap((l) => [l, l.toLowerCase()]).sort()
}

let sha = async (text: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)

// A body the browser may keep, revalidated on each load by its hash.
let kept = async (request: Request, body: string, type: string) => {
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
let served = (type: string, make: () => Promise<string>) => {
  let made: Promise<string> | undefined
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

/** `/`, an id route per series letter, and `/web/*`. */
export let routes = (host: Hosting): Route[] => {
  let name = host.config.name ?? 'yak'
  let page = shell(name)
  let html = () =>
    new Response(page, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  let file = (path: string) => async () =>
    (await fetch(new URL(path, import.meta.url))).text()
  let vocab = JSON.stringify(host.vocab.docs)
  return [
    { method: 'GET', path: '/', handle: html },
    ...letters(host.vocab).flatMap((l): Route[] => [
      { method: 'GET', path: `/${l}-*`, handle: html },
      { method: 'GET', path: `/${l}`, handle: html },
    ]),
    {
      method: 'GET',
      path: '/web/client.js',
      handle: served(
        'text/javascript; charset=utf-8',
        () => bundle(entry(name, host.config.plugins ?? [])),
      ),
    },
    {
      method: 'GET',
      path: '/web/style.css',
      handle: served('text/css; charset=utf-8', file('./style.css')),
    },
    {
      method: 'GET',
      path: '/web/vocab.json',
      handle: served('application/json', () => Promise.resolve(vocab)),
    },
  ]
}
