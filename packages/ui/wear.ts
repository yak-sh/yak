/**
 * Dressing a browser page in a composition: its theme, what every theme
 * derives, and each part's sheet, linked ahead of the page's own stylesheet,
 * so the page, which sets its own colours and type in the theme's names
 * (`--bg`, `--accent`, `--font`, `--size`), wins.
 *
 * ```ts ignore
 * import { kits, themes } from '@yaks/ui/ui'
 * import { wear } from '@yaks/ui/wear'
 * await wear({ kits, theme: themes.linen }) // then render: nothing paints undressed
 * ```
 *
 * @module
 */

import { addresses } from './kit.ts'
import type { Composition } from './theme.ts'

/** Link the sheets `c` dresses a page in (`addresses`), before the page's
 * first stylesheet, settling once each has loaded or failed. */
export let wear = (c: Composition): Promise<void> => wearIn(document, c)

/** {@link wear} into a given document. A sheet already linked is left. */
export let wearIn = (doc: Document, c: Composition): Promise<void> => {
  let linked = new Set(
    [...doc.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')]
      .map((l) => l.href),
  )
  let first = doc.querySelector('link[rel=stylesheet],style')
  return Promise.all(
    addresses(c).filter((href) => !linked.has(href)).map((href) =>
      new Promise<void>((done) => {
        let link = doc.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.onload = link.onerror = () => done()
        doc.head.insertBefore(link, first)
      })
    ),
  ).then(() => {})
}
