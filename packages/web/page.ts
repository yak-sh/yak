// The page, exported as `@yaks/web/page`: what `/` and every entity's address
// answer (./routes.ts), ./index.html with the tracker's page reporter
// (@yaks/tracker/script) inline, first in its head, and what it wears beside
// its script (`dressing`): the stylesheet, the manifest and the icons.
//
// Both are files beside their modules, read as every file the web door serves
// is (@yaks/api/asset): a checkout reads them from disk, and a CLI from JSR
// from Deno's module cache, which fetched them from jsr.io once.

import { located } from '@yaks/cli/config'
import { text } from '@yaks/api/asset'
import type { Application } from './app.ts'
import type { Asset } from './assets.ts'

// The page reporter as a script element at the page's root, where its door
// `api/report` is. `</script` in its text would end the element early; `<\/`
// is the same string to JavaScript.
let reporter = async () => {
  let { script }: typeof import('@yaks/tracker/script') = await import(
    located('@yaks/tracker/script')
  )
  let code = await script()
  return `<script data-yak-at="/">${
    code.replace(/<\/(script)/gi, '<\\/$1')
  }</script>`
}

/** The page made from its files, its reporter first in its head. */
export let page = async (): Promise<string> => {
  let [html, script] = await Promise.all([
    text(new URL('./index.html', import.meta.url)),
    reporter(),
  ])
  return html.replace('<head>', `<head>${script}`)
}

let here = (name: string) => new URL(name, import.meta.url)

// @yaks/ui's stylesheet carries every component's CSS, so it loads when the
// stylesheet is first asked for, not before the server listens.
let styles = async (app: Application) =>
  (await Promise.all([
    import('@yaks/ui').then((ui) => ui.stylesheet(ui.composition)),
    app.styles ? text(app.styles) : '',
  ]))
    .join('\n')

/** What the page of `app` wears beside its script: @yaks/ui's stylesheet in
 * its default theme and skin, then the app's own, the manifest and the
 * icons. */
export let dressing = (app: () => Promise<Application>): Asset[] => [
  { name: 'styles.css', body: async () => styles(await app()) },
  ...[
    'manifest.webmanifest',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'apple-touch-icon.png',
  ].map((name) => ({ name, file: here(`./${name}`) })),
]
