// A picture carries the sheets that would otherwise block its first paint.
// Release sheets are flattened by the asset build. Resolve their URLs before
// moving the CSS from the release directory into the document.
let LINK = /<link\b[^>]*>/gi
let attribute = (name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
let REL = attribute('rel')
let HREF = attribute('href')
let MEDIA = attribute('media')
let URL_IN_CSS = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi

/** `css` with each address in it made whole against `at`, the sheet's own
 * address, so it means the same once moved into a document elsewhere.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   absolute('a{background:url(i.png)}b{mask:url("#m")}', 'https://yaks.app/_yak/p.css'),
 *   'a{background:url("https://yaks.app/_yak/i.png")}b{mask:url("#m")}',
 * )
 * ```
 */
export let absolute = (css: string, at: string | URL): string =>
  css.replace(
    URL_IN_CSS,
    (whole, _, href: string) =>
      /^(data:|#)/i.test(href)
        ? whole
        : `url("${new URL(href.trim(), at).href}")`,
  )

let value = (tag: string, attr: RegExp) =>
  tag.match(attr)?.slice(1).find(
    (s) => s != null,
  )

export let pictureSheets = async (
  html: string,
  at: URL,
  named: string | undefined,
  read: (url: string) => Promise<string>,
): Promise<string | undefined> => {
  let links = [...html.matchAll(LINK)].flatMap(([tag]) => {
    let rel = value(tag, REL)?.toLowerCase().split(/\s+/) ?? []
    let href = value(tag, HREF)
    return href && rel.includes('stylesheet')
      ? [{ tag, url: new URL(href, at), alternate: rel.includes('alternate') }]
      : []
  })
  if (
    links.some(({ url, alternate }) =>
      alternate || !named || url.origin != at.origin ||
      !url.pathname.startsWith(named)
    )
  ) return
  let styles = new Map(
    await Promise.all(links.map(async ({ tag, url }) => {
      let css = await read(url.href)
      if (/@import\b|<\/style/i.test(css)) {
        throw new Error('The picture cannot carry the sheet at ' + url.pathname)
      }
      return [
        tag,
        `<style${tag.match(MEDIA)?.[0] ?? ''}>${absolute(css, url)}</style>`,
      ] as const
    })),
  )
  return html.replace(LINK, (tag) => styles.get(tag) ?? tag)
}
