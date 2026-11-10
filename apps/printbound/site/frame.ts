/** What every page wears around what it says: the head a browser and an
 * engine read, the bar across the top and the foot. A page is drawn inside
 * `Page`; the studio, whose page is a file, takes `Top` and `Bottom` alone.
 *
 * Every link is written from the app's own address (`base`, ending in a
 * slash), so a page reads the same at printbound.net and under a space's
 * mount. */
import { type ComponentChildren, type FunctionComponent, h } from 'preact'
import { Button, Skip } from '@yaks/ui/parts'
import { Foot, Mast, Wordmark } from './parts.ts'

let SPARK =
  'M12 1.5c.55 4.9 2.6 6.95 7.5 7.5.55.06.55.94 0 1-4.9.55-6.95 2.6-7.5 7.5-.06.55-.94.55-1 0-.55-4.9-2.6-6.95-7.5-7.5-.55-.06-.55-.94 0-1 4.9-.55 6.95-2.6 7.5-7.5.06-.55.94-.55 1 0Z'

/** PrintBound's name, linking home where it is given somewhere to go. */
export let Name: FunctionComponent<{ href?: string; size?: number }> = (
  { href, size = 24 },
) =>
  h(
    Wordmark,
    href ? { href, 'aria-label': 'PrintBound home' } : { as: 'span' },
    h(
      Wordmark.Mark,
      { 'aria-hidden': true },
      h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, focusable: 'false' },
        h('path', { d: SPARK, fill: 'currentColor' }),
        h('circle', {
          cx: 19.5,
          cy: 4.5,
          r: 1.3,
          fill: 'currentColor',
          opacity: .65,
        }),
      ),
    ),
    h(Wordmark.Text, {}, 'Print', h(Wordmark.Bound, {}, 'Bound')),
  )

/** The bar across the top. The site's pages name the home page's bands; the
 * studio names the shelf and where to sign in. */
export let Top: FunctionComponent<{ base: string; studio?: boolean }> = (
  { base, studio },
) => {
  let to = (path = '') => base + path
  return h(
    Mast,
    {},
    h(
      Mast.Inner,
      {},
      h(Name, { href: to() }),
      studio
        ? h(
          Mast.Nav,
          { 'aria-label': 'Primary' },
          h(Mast.Link, { href: to('studio') }, 'Your books'),
          h(
            Mast.Link,
            { href: to('print-your-chatgpt-book') },
            'Printing guide',
          ),
          h(
            Button,
            { href: 'https://yaks.app/login', 'data-account': true },
            'Sign in to order',
          ),
        )
        : h(
          Mast.Nav,
          { 'aria-label': 'Primary' },
          h(Mast.Link, { href: to('#how') }, 'How it works'),
          h(Mast.Link, { href: to('#gifts') }, 'Gifts'),
          h(Mast.Link, { href: to('#make') }, 'What you can make'),
          h(Mast.Link, { href: to('#pricing') }, 'Pricing'),
          h(
            Mast.Link,
            { mod: 'quiet', href: to('make-a-picture-book-in-chatgpt') },
            'Read the free guide',
          ),
          h(Button, { mod: 'go', href: to('studio#new') }, 'Start your book'),
        ),
    ),
  )
}

/** The foot. */
export let Bottom: FunctionComponent<{ base: string }> = ({ base }) => {
  let to = (path = '') => base + path
  return h(
    Foot,
    {},
    h(
      Foot.Inner,
      {},
      h(
        Foot.Brand,
        {},
        h(Name, { size: 22 }),
        h(Foot.Tag, {}, 'The image-books you make with AI, printed for real.'),
      ),
      h(
        Foot.Nav,
        { 'aria-label': 'Footer' },
        h('a', { href: to('#how') }, 'How it works'),
        h('a', { href: to('#gifts') }, 'Gifts'),
        h('a', { href: to('#pricing') }, 'Pricing'),
        h('a', { href: to('studio') }, 'Your books'),
        h(
          'a',
          { href: to('make-a-picture-book-in-chatgpt') },
          'Picture-book guide',
        ),
        h('a', { href: to('print-your-chatgpt-book') }, 'Printing guide'),
        h('a', { href: to('can-you-print-ai-images') }, 'Copyright guide'),
        h('a', { href: to('terms') }, 'Terms'),
        h('a', { href: to('privacy') }, 'Privacy'),
        h('a', { href: to('refund') }, 'Refunds'),
        h('a', { href: to('contact') }, 'Contact'),
      ),
      h(
        Foot.Legal,
        {},
        `© ${
          new Date().getFullYear()
        } PrintBound · Yak Shaving LLC · Questions? `,
        h('a', { href: 'mailto:hello@printbound.net' }, 'hello@printbound.net'),
        ' · Printed one book at a time.',
      ),
    ),
  )
}

/** What a page says of itself in its head. */
export type About = {
  /** the address the app is opened at, ending in a slash */
  base: string
  /** the tab's title */
  head: string
  description: string
  /** its place in the app: '' is the home page */
  path: string
}

/** A whole page: its head, the bar, what it says, the foot. */
export let Page: FunctionComponent<
  About & { children?: ComponentChildren; data?: unknown }
> = ({ base, head, description, path, data, children }) => {
  let to = (path = '') => base + path
  let image = to('og.png')
  return h(
    'html',
    { lang: 'en' },
    h(
      'head',
      {},
      h('meta', { charset: 'utf-8' }),
      h('meta', {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      }),
      h('title', {}, head),
      description && h('meta', { name: 'description', content: description }),
      h('link', { rel: 'canonical', href: to(path) }),
      h('meta', { property: 'og:type', content: 'website' }),
      h('meta', { property: 'og:site_name', content: 'PrintBound' }),
      h('meta', { property: 'og:title', content: head }),
      description &&
        h('meta', { property: 'og:description', content: description }),
      h('meta', { property: 'og:url', content: to(path) }),
      h('meta', { property: 'og:image', content: image }),
      h('meta', { name: 'twitter:card', content: 'summary_large_image' }),
      h('meta', { name: 'twitter:image', content: image }),
      h('meta', { name: 'theme-color', content: '#0d1330' }),
      h('link', {
        rel: 'icon',
        href: to('favicon.svg'),
        type: 'image/svg+xml',
      }),
      ...['fraunces-latin', 'newsreader-latin'].map((font) =>
        h('link', {
          rel: 'preload',
          href: to(`fonts/${font}.woff2`),
          as: 'font',
          type: 'font/woff2',
          crossorigin: '',
        })
      ),
      h('link', { rel: 'stylesheet', href: to('look.css') }),
      data
        ? h('script', {
          type: 'application/ld+json',
          dangerouslySetInnerHTML: { __html: JSON.stringify(data) },
        })
        : null,
    ),
    h(
      'body',
      {},
      h(Skip, { href: '#main' }, 'Skip to content'),
      h(Top, { base }),
      children,
      h(Bottom, { base }),
    ),
  )
}
