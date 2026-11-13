// The site's own pages: the home page, pricing, help, the legal pages and
// the style guide, each drawn from the kit's parts (@yaks/ui) in a frame of
// the site's (frame.tsx).
//
// They are the files of the home app (apps/home, workers/yak site.ts `HOME`),
// which answers them at the apex: `deno task content` writes them there
// (`drawn`, gen.ts), they are committed with the change that drew them, and
// `yak admin push apps/home --as admin@bot.yak.sh` releases them. The deploy's
// build (client-assets.ts) writes them into public/ too, with the style
// guide, which is no page of the app's (`deployed`): the Worker's own file
// answers a page until the app does, and whenever it can't (site.ts
// `sitePage`). Those are made, not kept, as `_ui.css` is: public/*.html is
// gitignored.
import * as io from '@yaks/file/io'
import { type FunctionComponent, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { join } from 'node:path'
import { AcceptableUse } from './acceptable-use.tsx'
import { Build } from './build.tsx'
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
import { Townships } from './townships.tsx'

/** Each page by the file it is served from. */
export let PAGES: Record<string, FunctionComponent> = {
  'index.html': Home,
  // The Operator's home page, asking for a number or, until one can be
  // texted, an email (site.ts `drawn`).
  'operator.html': () => h(Operator, { by: 'text' }),
  'operator-email.html': () => h(Operator, { by: 'email' }),
  // The home page that leads with the app a visitor gets, and the landing
  // pages for a church office, a township and any organization's
  // (variant.ts).
  'build.html': Build,
  'churches.html': Churches,
  'organizations.html': Organizations,
  'townships.html': Townships,
  'pricing.html': Pricing,
  'help.html': Help,
  'terms.html': Terms,
  'privacy.html': Privacy,
  'cookies.html': Cookies,
  'acceptable-use.html': AcceptableUse,
  'style-guide.html': StyleGuide,
}

// The page only the Worker serves: the kit's showcase, at /style-guide, which
// is no page of the home app's.
let OWN = ['style-guide.html']
let APP = Object.keys(PAGES).filter((name) => !OWN.includes(name))

/** Where the home app's files are kept. */
export let HOME = new URL('../../../apps/home/', import.meta.url)

/** A page's file, as a browser is sent it. */
export let page = (name: string) =>
  `<!doctype html>\n${renderToString(h(PAGES[name], {}))}\n`

/** The home app's pages, each by its file's name. Its copy.json is the
 * source of their words, and never drawn here. */
export let drawn = () =>
  Object.fromEntries(APP.map((name) => [name, page(name)]))

/** Write every page into public/, the Worker's own. */
export let deployed = (to = new URL('../public/', import.meta.url).pathname) =>
  Promise.all(
    Object.keys(PAGES).map((name) =>
      io.writeTextFile(join(to, name), page(name))
    ),
  )
