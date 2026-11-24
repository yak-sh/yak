import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { addresses } from './kit.ts'
import { beside, type Kit, type Piece } from './theme.ts'
import { wearIn } from './wear.ts'

let at = beside('https://app.test/ui/')
let piece = (css: string) => ({ css: at(css) }) as Piece
let kit: Kit = { Button: piece('Button.css'), Field: piece('Field.css') }
let theme = { css: at('linen.css'), colors: {} } as never
let c = { kits: { base: kit }, theme }

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
  let done = wearIn(document, c).then(() => worn = true)
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
