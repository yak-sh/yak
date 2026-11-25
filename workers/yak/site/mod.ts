// The site's own pages: the home page, pricing, help, the legal pages and
// the style guide, each drawn from the kit's parts (@yaks/ui) in a frame of
// the site's (frame.tsx).
//
// They are the files of the home app (apps/home, workers/yak site.ts `HOME`),
// which answers them at the apex: gen.ts writes them there (`drawn`), the
// pre-commit hook stages them with the change that drew them, and
// the box's deploy catch-up releases them once main's head is live
// (packages/admin service.ts `RELEASED`). The deploy's build (../assets.ts)
// writes every page into public/ too, with the style guide, which is no page
// of the app's: the Worker's own file answers a page until the app does,
// whenever it can't, and while the app's is another drawing (site.ts
// `sitePage`, drawing.ts). Those are made, not kept, as `_ui.css` is:
// public/*.html is gitignored.
import { type FunctionComponent, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { createHash } from 'node:crypto'
import { DRAWING } from '@yaks/platform/drawing'
import { AcceptableUse } from './acceptable-use.tsx'
import { Churches } from './churches.tsx'
import { Cookies } from './cookies.tsx'
import { Games } from './games.tsx'
import { Help } from './help.tsx'
import { DESCRIBE, Home, StoryHome } from './home.tsx'
import { Operator } from './operator.tsx'
import { Organizations } from './organizations.tsx'
import { Pricing } from './pricing.tsx'
import { Privacy } from './privacy.tsx'
import { StyleGuide } from './style-guide.tsx'
import { Terms } from './terms.tsx'
import { Townships } from './townships.tsx'

/** Each page by the file it is served from. */
export let PAGES: Record<string, FunctionComponent> = {
  'index.html': StoryHome,
  // The Operator's home page, asking for a number or, until one can be
  // texted, an email (site.ts `drawn`).
  'operator.html': () => h(Operator, { by: 'text' }),
  'operator-email.html': () => h(Operator, { by: 'email' }),
  // The home page that leads with the app a visitor gets (home.tsx
  // `DESCRIBE`), and the landing pages for a church office, a township and
  // any organization's (variant.ts).
  'build.html': () => h(Home, { pitch: DESCRIBE }),
  'churches.html': Churches,
  'organizations.html': Organizations,
  'townships.html': Townships,
  // The games landing page, unlisted (games.tsx).
  'games.html': Games,
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

/** A page's file, as a browser is sent it, naming its drawing (drawing.ts). */
export let page = (name: string) => {
  let html = renderToString(h(PAGES[name], {}))
  let hash = createHash('sha256').update(html).digest('hex').slice(0, 10)
  return `<!doctype html>\n${
    html.replace('<head>', `<head><meta name="${DRAWING}" content="${hash}">`)
  }\n`
}

// The site's files a page loads (its sheet, its scripts, the mascot) are
// yaks.app's, not the app's, so the app's pages name yaks.app as their base:
// they load the same files at its own address as at the apex, and its release
// holds none of them.
let based = (html: string) =>
  html.replace('<head>', '<head><base href="https://yaks.app/">')

/** The home app's pages, each by its file's name. Its copy.json is the
 * source of their words, and never drawn here. */
export let drawn = () =>
  Object.fromEntries(APP.map((name) => [name, based(page(name))]))
