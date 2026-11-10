/** A whole page as the worker answers it: the head a browser and a search
 * engine read, the header and footer every page wears (chrome.ts), and what
 * the page holds between them, drawn from the kit's parts and serialized. */
import { type ComponentChildren, h, type VNode } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Skip } from '@yaks/ui/parts'
import { Bottom, type Place, Top } from './chrome.ts'

export { type Place, placed } from './chrome.ts'

/** What a page says of itself, and what it holds. */
export type Sheet = {
  place: Place
  title: string
  description?: string
  /** `noindex` for a page that is one visitor's */
  robots?: string
  /** the header offers a sign-in */
  account?: boolean
  /** seconds after which a waiting page asks again */
  refresh?: number
  children?: ComponentChildren
}

/** A whole page, as HTML. */
export let page = (
  { place, title, description, robots, account, refresh, children }: Sheet,
): string =>
  '<!doctype html>' + renderToString(
    h(
      'html',
      { lang: 'en' },
      h(
        'head',
        {},
        h('meta', { charset: 'utf-8' }),
        h('meta', {
          name: 'viewport',
          content: 'width=device-width,initial-scale=1',
        }),
        h('title', {}, title),
        description && h('meta', { name: 'description', content: description }),
        robots && h('meta', { name: 'robots', content: robots }),
        refresh &&
          h('meta', { 'http-equiv': 'refresh', content: String(refresh) }),
        h('link', {
          rel: 'icon',
          type: 'image/svg+xml',
          href: place.at('/favicon.svg'),
        }),
        // The two faces every page opens in, asked for before the stylesheet
        // that names them is read.
        ['Nunito-Regular', 'Fredoka-SemiBold'].map((face) =>
          h('link', {
            rel: 'preload',
            as: 'font',
            type: 'font/ttf',
            crossorigin: '',
            href: place.at(`/look/fonts/${face}.ttf`),
          })
        ),
        h('link', { rel: 'stylesheet', href: place.at('/look.css') }),
        h('link', {
          rel: 'alternate',
          type: 'application/rss+xml',
          href: place.at('/blog.rss'),
          title: 'CrayonBloom ideas',
        }),
      ),
      h(
        'body',
        {},
        h(Skip, { href: '#main' }, 'Skip to content'),
        h(Top, { place, account }),
        children,
        h(Bottom, { place }),
      ),
    ) as VNode,
  )

/** A page, answered. A visitor's own page is never kept by a cache. */
export let answered = (sheet: Sheet, status = 200): Response =>
  new Response(page(sheet), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...(sheet.robots && { 'cache-control': 'no-store, private' }),
    },
  })
