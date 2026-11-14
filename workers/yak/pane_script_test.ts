// The layers a page opens by its address (public/pane.js), pressed as a
// person would on a dashboard page: the menu opens and closes by replacing
// the address's fragment, so no press adds a history entry, and coming Back
// to a page whose address names a layer takes the layer off.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { desk } from './desk-pages.ts'

let code = await Deno.readTextFile(
  new URL('./public/pane.js', import.meta.url),
)

let page = async (hash = '', how = 'navigate') => {
  let html = await desk({ space: 'dana', apps: [], name: 'dana' }, {}).text()
  let { document } = parseHTML(html)
  let on: Record<string, (e: unknown) => void> = {}
  let base = 'https://yaks.app/dana'
  let replaced: string[] = []
  let location = {
    hash,
    get href() {
      return base + this.hash
    },
    replace(to: string) {
      replaced.push(to)
      this.hash = to == '#' ? '' : to
    },
  }
  let performance = { getEntriesByType: () => [{ type: how }] }
  new Function('document', 'addEventListener', 'location', 'performance', code)(
    document,
    (type: string, fn: (e: unknown) => void) => on[type] = fn,
    location,
    performance,
  )
  let press = (sel: string, keys = {}) => {
    let prevented = false
    on.click({
      target: document.querySelector(sel),
      button: 0,
      defaultPrevented: false,
      preventDefault: () => void (prevented = true),
      ...keys,
    })
    return prevented
  }
  let show = (persisted = false) => on.pageshow({ persisted })
  return { html, location, replaced, press, show }
}

test('a page with a layer loads its script', async () => {
  assert((await page()).html.includes('/pane.js'))
})

test('the menu opens and closes in place, adding no history entry', async () => {
  let p = await page()
  assert(p.press('.Frame_Menu[data-pane]'))
  assertEquals(p.location.hash, '#menu')
  assert(p.press('#menu .Sidebar_Close'))
  assertEquals([p.location.hash, p.replaced], ['', ['#menu', '#']])
})

test('a press with a modifier key is left to the browser', async () => {
  let p = await page()
  assert(!p.press('.Frame_Menu[data-pane]', { metaKey: true }))
  assertEquals(p.replaced, [])
})

test('coming Back to a page with its menu open takes the menu off', async () => {
  for (
    let [hash, how, persisted, want] of [
      ['#menu', 'back_forward', false, ['#']],
      ['#menu', 'navigate', true, ['#']],
      ['#menu', 'navigate', false, []],
      ['#content', 'back_forward', false, []],
    ] as const
  ) {
    let p = await page(hash, how)
    p.show(persisted)
    assertEquals(p.replaced, [...want], `${hash} ${how} ${persisted}`)
  }
})
