// The site's own pages: the home page, pricing, help, the legal pages and
// the style guide, each drawn from the kit's parts (@yaks/ui) in a frame of
// the site's (frame.tsx), and written into public/ by the deploy's build
// (client-assets.ts) under the name the assets binding serves it at. They
// are made, not kept, as `_ui.css` is: public/*.html is gitignored.
import * as io from '@yaks/file/io'
import { type FunctionComponent, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { join } from 'node:path'
import { AcceptableUse } from './acceptable-use.tsx'
import { Churches } from './churches.tsx'
import { Cookies } from './cookies.tsx'
import { Help } from './help.tsx'
import { Home } from './home.tsx'
import { Operator } from './operator.tsx'
import { Organizations } from './organizations.tsx'
import { Pricing } from './pricing.tsx'
import { Privacy } from './privacy.tsx'
import { StyleGuide } from './style-guide.tsx'
import { Terms } from './terms.tsx'

/** Each page by the file it is served from. */
export let PAGES: Record<string, FunctionComponent> = {
  'index.html': Home,
  // The Operator's home page, asking for a number or, until one can be
  // texted, an email (site.ts `drawn`).
  'operator.html': () => h(Operator, { by: 'text' }),
  'operator-email.html': () => h(Operator, { by: 'email' }),
  // The landing pages for a church office and for any organization's
  // (variant.ts).
  'churches.html': Churches,
  'organizations.html': Organizations,
  'pricing.html': Pricing,
  'help.html': Help,
  'terms.html': Terms,
  'privacy.html': Privacy,
  'cookies.html': Cookies,
  'acceptable-use.html': AcceptableUse,
  'style-guide.html': StyleGuide,
}

/** A page's file, as a browser is sent it. */
export let page = (name: string) =>
  `<!doctype html>\n${renderToString(h(PAGES[name], {}))}\n`

/** Write every page into public/. */
export let written = (to = new URL('../public/', import.meta.url).pathname) =>
  Promise.all(
    Object.keys(PAGES).map((name) =>
      io.writeTextFile(join(to, name), page(name))
    ),
  )
