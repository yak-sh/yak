import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { beside, type Kit, type Piece } from './theme.ts'
import { sheets, wearIn } from './wear.ts'

let at = beside('https://app.test/ui/')
let piece = (css: string) => ({ css: at(css) }) as Piece
let kit: Kit = { Button: piece('Button.css'), Field: piece('Field.css') }
let theme = { css: at('linen.css') }

test('a look brings its sheets in order, each once', () => {
  assertEquals(sheets(theme, kit, { Again: piece('Button.css') }), [
    'https://app.test/ui/linen.css',
    'https://app.test/ui/Button.css',
    'https://app.test/ui/Field.css',
  ])
})

test("sheets go ahead of the page's own and settle once each loads", async () => {
  let { document } = parseHTML(
    '<html><head><link rel="stylesheet" href="https://app.test/ui/Field.css"><link rel="stylesheet" href="style.css"></head><body></body></html>',
  )
  let worn = false
  let done = wearIn(document, [theme, kit]).then(() => worn = true)
  let links = [...document.querySelectorAll('link')] as HTMLLinkElement[]
  assertEquals(links.map((l) => l.getAttribute('href')), [
    'https://app.test/ui/linen.css',
    'https://app.test/ui/Button.css',
    'https://app.test/ui/Field.css',
    'style.css',
  ])
  links[0].onload!(new Event('load'))
  await Promise.resolve()
  assertEquals(worn, false)
  links[1].onerror!(new Event('error'))
  await done
  assertEquals(worn, true)
})
