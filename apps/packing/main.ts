/** The packing list's page: the kit's look, and the list over this app's
 * store. The iOS shell draws the same view natively (native/kit.tsx). */
import { h, render } from 'preact'
import { kits, themes } from '@yaks/ui/ui'
import { Packing, type Store } from './view.ts'

// client.js is served beside the page, so its URL is resolved at runtime.
let { apply, query }: Store = await import(
  new URL('api/client.js', document.baseURI).href
)

for (
  let url of [themes.gouache.css, ...Object.values(kits.base).map((p) => p.css)]
) {
  let link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = String(url)
  document.head.append(link)
}

render(
  h(Packing, { store: { query, apply } }),
  document.getElementById('app')!,
)
