/**
 * Dressing a browser page in kits and a theme: each look's stylesheets linked
 * ahead of the page's own, so the page's sheet, which sets its own colours
 * and type in the theme's names (`--bg`, `--accent`, `--font`), wins.
 *
 * ```ts ignore
 * import { kits } from '@yaks/ui/ui'
 * import { wear } from '@yaks/ui/wear'
 * await wear(kits.base) // then render, so nothing paints undressed
 * ```
 *
 * @module
 */

import type { Kit, Stylesheet, Theme } from './theme.ts'

/** A kit, whose every piece brings its sheet, or a theme, which brings one. */
export type Look = Kit | Pick<Theme, 'css'>

/** The sheets `looks` bring, in order, each once. */
export let sheets = (...looks: Look[]): string[] => [
  ...new Set(
    looks.flatMap((look) =>
      typeof look.css == 'function'
        ? [(look.css as Stylesheet)().href]
        : Object.values(look as Kit).map((piece) => piece.css().href)
    ),
  ),
]

/** Link the sheets `looks` bring into `doc`, before its first stylesheet,
 * settling once each has loaded or failed. A sheet already linked is left. */
export let wear = (...looks: Look[]): Promise<void> => wearIn(document, looks)

/** {@link wear} into a given document. */
export let wearIn = (doc: Document, looks: Look[]): Promise<void> => {
  let linked = new Set(
    [...doc.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')]
      .map((l) => l.href),
  )
  let first = doc.querySelector('link[rel=stylesheet],style')
  return Promise.all(
    sheets(...looks).filter((href) => !linked.has(href)).map((href) =>
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
