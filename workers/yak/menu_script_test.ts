// The one listener behind a page's menus (public/menu.js), acted on as a
// person would, over the dashboard's space picker (pages.ts `chooser`).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { desk } from './desk-pages.ts'

let code = await Deno.readTextFile(
  new URL('./public/menu.js', import.meta.url),
)

let page = async () => {
  let html = await desk({
    space: 'dana',
    apps: [],
    name: 'dana',
    spaces: [
      { slug: 'dana', title: 'Dana', owner: true, own: true },
      { slug: 'grove', title: 'Grove', owner: true, own: false },
    ],
  }, {}).text()
  let { document } = parseHTML(html)
  let on: Record<string, (e: unknown) => void> = {}
  new Function('document', 'addEventListener', code)(
    document,
    (type: string, fn: (e: unknown) => void) => on[type] = fn,
  )
  let menu = document.querySelector('details[data-menu]') as HTMLDetailsElement
  let at = (q: string) => {
    let node = document.querySelector(q)
    assert(node, q)
    return node
  }
  let focused: Element | null = null
  ;(menu.querySelector('summary') as HTMLElement).focus = function () {
    focused = this
  }
  return {
    html,
    menu,
    opened: () => (menu.setAttribute('open', ''), menu),
    isOpen: () => menu.hasAttribute('open'),
    click: (q: string) => on.click({ target: at(q) }),
    focus: (q: string) => on.focusin({ target: at(q) }),
    key: (key: string, q = '.Menu_Item') => on.keydown({ key, target: at(q) }),
    focused: () => focused,
  }
}

// linkedom's details does not reflect `open`; a browser's does.
let reflect = (menu: HTMLDetailsElement) =>
  Object.defineProperty(menu, 'open', {
    get: () => menu.hasAttribute('open'),
    set: (v) => menu.toggleAttribute('open', v),
  })

test('the page that draws a menu loads its script', async () => {
  let { html } = await page()
  assert(html.includes('/menu.js'))
})

test('a click outside the open menu closes it; one inside leaves it open', async () => {
  let p = await page()
  reflect(p.opened())
  p.click('.Menu_Ask')
  assertEquals(p.isOpen(), true)
  p.click('main')
  assertEquals(p.isOpen(), false)
})

test('focus moving outside the open menu closes it', async () => {
  let p = await page()
  reflect(p.opened())
  p.focus('.Menu_Item')
  assertEquals(p.isOpen(), true)
  p.focus('.Desk_Foot button[type="submit"]')
  assertEquals(p.isOpen(), false)
})

test('Escape closes the open menu and gives focus back to its summary', async () => {
  let p = await page()
  reflect(p.opened())
  p.key('Tab')
  assertEquals(p.isOpen(), true)
  p.key('Escape')
  assertEquals(p.isOpen(), false)
  assertEquals(p.focused(), p.menu.querySelector('summary'))
})
