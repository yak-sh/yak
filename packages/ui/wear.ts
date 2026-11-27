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

import { addresses, kits, linenAddresses, linenAsset, themes } from './kit.ts'
import type { Composition } from './theme.ts'

/** Link the sheets `c` dresses a page in (`addresses`), before the page's
 * first stylesheet, settling once each has loaded or failed. */
export let wear = (c: Composition): Promise<void> => wearIn(document, c)

// Compiled browser packages carry the kit beside the original CSS. Outside
// that catalog the original stylesheet URLs stand on their own.
let combined = (
  at: string,
  c: Composition,
  wanted: string[],
): string | undefined => {
  if (c.kits != kits || c.theme != themes.linen || c.skin) return
  let bundle = new URL(linenAsset, at)
  if (!/^\/__packages\/[a-f0-9]{64}\/resources\//.test(bundle.pathname)) return
  let stock = linenAddresses()
  if (
    stock.length == wanted.length && stock.every((href, i) => wanted[i] == href)
  ) {
    return bundle.href
  }
}

let linkSheet = (
  doc: Document,
  before: Element | null,
  href: string,
  forget = false,
) =>
  new Promise<boolean>((done) => {
    let link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = () => done(true)
    link.onerror = () => {
      if (forget) link.remove()
      done(false)
    }
    doc.head.insertBefore(link, before)
  })

/** {@link wear} into a given document. A sheet already linked is left. */
export let wearIn = async (
  doc: Document,
  c: Composition,
  moduleUrl = import.meta.url,
): Promise<void> => {
  let linked = new Set(
    [...doc.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')]
      .map((l) => l.href),
  )
  let first = doc.querySelector('link[rel=stylesheet],style')
  let wanted = addresses(c)
  let bundle = combined(moduleUrl, c, wanted)
  if (bundle && linked.has(bundle)) return
  if (
    bundle && wanted.every((href) => !linked.has(href)) &&
    await linkSheet(doc, first, bundle, true)
  ) return
  await Promise.all(
    wanted.filter((href) => !linked.has(href)).map((href) =>
      linkSheet(doc, first, href)
    ),
  )
}
