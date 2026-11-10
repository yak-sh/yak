import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { stylesheet } from './look/look.ts'
import { placed } from './pages/chrome.ts'
import { ready } from './pages/free.ts'
import { home } from './pages/home.ts'
import { coloring } from './pages/themes.ts'
import themes from './pages/themes.json' with { type: 'json' }

let drawn = async (response: Response) =>
  parseHTML(await response.text()).document
let hrefs = (document: Document, selector: string) =>
  [...document.querySelectorAll(selector)].map((a) => a.getAttribute('href'))

test('the home page sends an idea to the studio under its mount', async () => {
  let place = placed('https://checks.yaks.app/preview/', '/')
  let document = await drawn(home(place))
  let form = document.querySelector('form')!
  equal(form.getAttribute('action'), '/preview/studio')
  equal(form.querySelector('textarea')!.getAttribute('name'), 'prompt')
  ok(
    hrefs(document, '.Chip').every((href) =>
      href!.startsWith('/preview/studio?prompt=')
    ),
  )
  equal(
    document.querySelector('link[rel=stylesheet]')!.getAttribute('href'),
    '/preview/look.css',
  )
})

test('a theme page offers each of its pages as a printable', async () => {
  let [theme] = themes
  let place = placed(
    'https://crayonbloom.com/coloring-pages/' + theme.slug,
    '/coloring-pages/' + theme.slug,
  )
  let document = await drawn(coloring(place)!)
  equal(document.querySelector('h1')!.textContent, theme.heading)
  equal(
    hrefs(document, 'figure a[href$=".pdf"]'),
    theme.pages.map((page) => page.pdf),
  )
  equal(
    document.querySelector('[aria-current=page]')!.textContent,
    'Coloring pages',
  )
  equal(coloring(placed('https://crayonbloom.com/x', '/x')), null)
})

test('a finished free page is one visitor’s, with its printable', async () => {
  let place = placed('https://crayonbloom.com/free_pages/t', '/free_pages/t')
  let response = ready(place, '/free_pages/t', 'A <b>fox</b>', true)
  equal(response.headers.get('cache-control'), 'no-store, private')
  let document = await drawn(response)
  equal(document.querySelector('.Lead_Lede')!.textContent, '“A <b>fox</b>”')
  ok(hrefs(document, 'main a').includes('/free_pages/t/download'))
  equal(
    document.querySelector('meta[name=robots]')!.getAttribute('content'),
    'noindex',
  )
})

test("the stylesheet holds the theme, the kit parts worn and the app's own", () => {
  for (let rule of ['--accent: #e8654e', '.Button:hover', '.Mast_Brand']) {
    ok(stylesheet.includes(rule), rule)
  }
})
