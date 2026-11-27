import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { addresses, kits, linenAsset, themes } from './kit.ts'
import { beside, type Kit, type Piece } from './theme.ts'
import { wearAssets } from './wear-build.ts'
import { wearIn } from './wear.ts'

let at = beside('https://app.test/ui/')
let piece = (css: string) => ({ css: at(css) }) as Piece
let kit: Kit = { Button: piece('Button.css'), Field: piece('Field.css') }
let theme = { css: at('linen.css'), colors: {} } as never
let c = { kits: { base: kit }, theme }

let browserModule = `https://app.test/__packages/${
  'a'.repeat(64)
}/resources/@yaks/ui/wear.ts`
let linen = { kits, theme: themes.linen }

test('a composition dresses a page in its theme, what every theme derives, then each part', () => {
  let [first, derived, ...parts] = addresses(c)
  assertEquals(first, 'https://app.test/ui/linen.css')
  assertEquals(derived.endsWith('/derived.css'), true)
  assertEquals(parts.slice(-2), [
    'https://app.test/ui/Button.css',
    'https://app.test/ui/Field.css',
  ])
})

test("sheets go ahead of the page's own and settle once each loads", async () => {
  let { document } = parseHTML(
    '<html><head><link rel="stylesheet" href="https://app.test/ui/Field.css"><style>body{}</style></head><body></body></html>',
  )
  let worn = false
  let done = wearIn(document, c, browserModule).then(() => worn = true)
  let hrefs = [...document.querySelectorAll('link')].map((l) =>
    l.getAttribute('href')!
  )
  assertEquals(hrefs.slice(0, -1), addresses(c).slice(0, -1))
  assertEquals(hrefs.at(-1), 'https://app.test/ui/Field.css')
  let added = [...document.querySelectorAll('link')].slice(
    0,
    -1,
  ) as HTMLLinkElement[]
  added.slice(1).forEach((l) => l.onload!(new Event('load')))
  await Promise.resolve()
  assertEquals(worn, false)
  added[0].onerror!(new Event('error'))
  await done
  assertEquals(worn, true)
})

test('the compiled stock Linen composition loads one sheet ahead of app styles', async () => {
  let { document } = parseHTML(
    '<html><head><style>body{}</style></head></html>',
  )
  let done = wearIn(document, linen, browserModule)
  let bundle = document.head.firstElementChild as HTMLLinkElement
  assertEquals(
    [...document.querySelectorAll('link')].map((link) => link.href),
    [
      new URL('wear-linen.css', browserModule).href,
    ],
  )
  assertEquals(bundle.nextElementSibling?.tagName, 'STYLE')
  bundle.onload!(new Event('load'))
  await done
})

test('a compiled page loads its separate sheets if the combined sheet is unavailable', async () => {
  let { document } = parseHTML('<html><head></head></html>')
  let done = wearIn(document, linen, browserModule)
  let bundle = document.querySelector<HTMLLinkElement>('link')!
  bundle.onerror!(new Event('error'))
  await Promise.resolve()
  let links = [...document.querySelectorAll<HTMLLinkElement>('link')]
  assertEquals(links.map((link) => link.href), addresses(linen))
  for (let link of links) link.onload!(new Event('load'))
  await done
})

test('the built sheet keeps the original cascade and relative image addresses', async () => {
  let sheets = addresses(linen).map((href) => new URL(href))
  let icon = './illustration.svg'
  let rule = (sheet: URL) =>
    `/* ${sheet.pathname.split('/').at(-1)} */
.icon { background: url("${icon}") }`
  let bundle = (await wearAssets((sheet) => Promise.resolve(rule(sheet))))[
    linenAsset
  ]
  assertEquals(bundle, sheets.map(rule).join('\n'))
  let compiledBundle = new URL(linenAsset, browserModule)
  for (let sheet of sheets) {
    let compiledSheet = new URL(
      sheet.pathname.split('/').at(-1)!,
      browserModule,
    )
    assertEquals(new URL('.', sheet).href, new URL('.', sheets[0]).href)
    assertEquals(
      new URL(icon, compiledSheet).href,
      new URL(icon, compiledBundle).href,
    )
  }
})
