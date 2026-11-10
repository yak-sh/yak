/** What every CrayonBloom page wears around what it says: the header with
 * its places (`Top`) and the footer (`Bottom`). The worker draws them into
 * the pages it answers (frame.ts) and the studio draws them in the browser.
 * Every address a page names goes through `place.at`, so the same page
 * serves at crayonbloom.com and under a preview's mount. */
import { h } from 'preact'
import { Button } from '@yaks/ui/parts'
import { Foot } from '../look/parts/Foot.ts'
import { Mast } from '../look/parts/Mast.ts'

/** Where a page is served: `at` turns an app path (`/studio`) into the
 * address a visitor's browser asks for, and `path` is the page's own. */
export type Place = { at: (path: string) => string; path: string }

/** The place of an app path under the address a visitor asked for: the
 * worker's, for a request it has stripped the mount from. */
export let placed = (address: string, path: string): Place => {
  let slashed = (text: string) => text.replace(/\/{2,}/g, '/')
  let asked = slashed(new URL(address).pathname)
  path = slashed(path).replace(/(.)\/$/, '$1')
  let whole = asked.replace(/(.)\/$/, '$1').replace(/\.html$/, '')
  let root = path == '/'
    ? whole.replace(/\/$/, '')
    : whole.endsWith(path)
    ? whole.slice(0, -path.length)
    : ''
  return { at: (to) => root + to, path }
}

let NAV = [
  ['/coloring-pages', 'Coloring pages'],
  ['/pricing', 'Pricing'],
  ['/blog', 'Blog'],
  ['/faq', 'FAQ'],
]

let Brand = ({ place }: { place: Place }) =>
  h(
    Mast.Brand,
    { href: place.at('/'), 'aria-label': 'CrayonBloom, home' },
    h(Mast.Mark, {
      src: place.at('/icon.svg'),
      alt: '',
      width: 48,
      height: 48,
    }),
    h(Mast.Name, {}, 'CrayonBloom'),
  )

/** The header. `account` adds the sign-in a person orders with. */
export let Top = ({ place, account }: { place: Place; account?: boolean }) =>
  h(
    Mast,
    {},
    h(
      Mast.Inner,
      {},
      h(Brand, { place }),
      h(
        Mast.Nav,
        { 'aria-label': 'Main navigation' },
        NAV.map(([to, said]) =>
          h(Mast.Link, {
            href: place.at(to),
            'aria-current': place.path == to || place.path.startsWith(to + '/')
              ? 'page'
              : undefined,
          }, said)
        ),
        account &&
          h(Mast.Link, {
            href: 'https://yaks.app/login',
            'data-account': true,
          }, 'Sign in to order'),
        h(Button, { href: place.at('/studio') }, 'Your books'),
      ),
    ),
  )

let COLS: [string, [string, string][]][] = [
  ['Product', [
    ['/coloring-pages', 'Coloring pages'],
    ['/blog', 'Blog'],
    ['/pricing', 'Pricing'],
    ['/faq', 'FAQ'],
  ]],
  ['Company', [
    ['/contact', 'Contact'],
    ['/refunds', 'Refunds & shipping'],
  ]],
  ['Legal', [
    ['/privacy', 'Privacy'],
    ['/terms', 'Terms'],
    ['/acceptable-use', 'Acceptable use'],
  ]],
]

/** The footer. */
export let Bottom = ({ place }: { place: Place }) =>
  h(
    Foot,
    {},
    h(
      Foot.Inner,
      {},
      h(
        Foot.About,
        {},
        h(Brand, { place }),
        h(
          'p',
          {},
          'Turn bedtime ideas, classroom themes, and family jokes into printable coloring books.',
        ),
      ),
      h(
        Foot.Cols,
        {},
        COLS.map(([name, links]) =>
          h(
            Foot.Col,
            { 'aria-label': name },
            h(Foot.Heading, {}, name),
            links.map(([to, said]) =>
              h(Foot.Link, { href: place.at(to) }, said)
            ),
          )
        ),
      ),
    ),
    h(
      Foot.Fine,
      {},
      h(
        'span',
        {},
        `© ${
          new Date().getFullYear()
        } CrayonBloom. Built by a parent, drawn for kids.`,
      ),
      h('span', {}, 'Operated by Yak Shaving LLC'),
    ),
  )
