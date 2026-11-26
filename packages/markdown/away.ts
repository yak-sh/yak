/**
 * Whether a link leaves the site its page is on, decided once for every link
 * drawn: Markdown (`render` and `blocks`), every @yaks/ui part given an `href`
 * (`el`), and the anchors a page writes by hand, through its one document
 * script (@yaks/web/away). A link that leaves opens in a new tab with
 * `rel="noopener"`, so the person's own tab stays where it was.
 *
 * A page's {@link Site} is its own host and the hosts that count as the same
 * app, such as the yaks.app platform's apex for its pages; `www.` is the same
 * host. A link to an http or https address on any other host leaves, a space's
 * site under yaks.app included. A relative link, mailto:, tel: and sms: stay.
 *
 * ```ts
 * import { leaves } from '@yaks/markdown/away'
 * import { equal } from '@yaks/testing'
 *
 * let site = ['yaks.app']
 * equal(leaves('https://discord.com/x', site), true)
 * equal(leaves('https://ada.yaks.app/notes/', site), true)
 * equal(leaves('https://www.yaks.app/pricing', site), false)
 * equal(leaves('/manage/ada/apps', site), false)
 * equal(leaves('mailto:ada@example.com', site), false)
 * ```
 *
 * @module
 */

/** The hosts that are a page's own site. Preact draws it from the `Site`
 * context (@yaks/markdown/site). */
export type Site = readonly string[]

/** Where the page is, as far as this process can see: its location's host in
 * a browser, and none in a server drawing a page with no `Site` given, so
 * there every address leaves. */
export let here = (): Site => {
  let host = globalThis.location?.hostname
  return host ? [host] : []
}

let bare = (host: string) => host.toLowerCase().replace(/^www\./, '')

/** Whether `href` leads off `site` to another site's http or https address. */
export let leaves = (href: unknown, site: Site = here()): boolean => {
  if (typeof href != 'string') return false
  let to = URL.parse(href.startsWith('//') ? `https:${href}` : href)
  return !!to && /^https?:$/.test(to.protocol) &&
    !site.some((host) => bare(host) == bare(to.hostname))
}

/** What a link that leaves carries. */
export const AWAY = { target: '_blank', rel: 'noopener' } as const

/** A link's own props, with {@link AWAY} where it leaves and names no target
 * of its own; a rel it names is kept. */
export let away = <P extends Record<string, unknown>>(
  props: P,
  site?: Site,
): P =>
  props.target == null && leaves(props.href, site)
    ? { ...props, ...AWAY, ...props.rel ? { rel: props.rel } : {} }
    : props
