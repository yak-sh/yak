// A long apps list's search and order (public/sift.js), acted on as a person
// would over the dashboard's apps page, and the same asked of the page itself
// with its form sent (desk-pages.ts `sifted`).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { desk } from './desk-pages.ts'

let code = await Deno.readTextFile(new URL('./public/sift.js', import.meta.url))

// Ten apps, each a day newer than the one before, named out of order.
let NAMES = [
  'Kite',
  'Ark',
  'Jam',
  'Bee',
  'Ivy',
  'Cod',
  'Hut',
  'Dew',
  'Gem',
  'Elm',
]
let apps = (n: number) =>
  NAMES.slice(0, n).map((title, i) => ({
    eid: `a${i}`,
    slug: title.toLowerCase(),
    title,
    made: {
      at: `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      by: 'u',
    },
  }))
let html = (n: number, sift?: { q: string; sort: string }) =>
  desk({ space: 'ada', apps: apps(n), view: 'apps', sift }).text()
let names = (document: Document, all = false) =>
  [...document.querySelectorAll('#apps > li')]
    .filter((r) => all || !r.hasAttribute('hidden'))
    .map((r) => r.querySelector('.Rows_Open')!.textContent)

let page = async () => {
  let { document } = parseHTML(await html(10))
  let location = new URL('https://yaks.app/manage/ada/apps')
  let history = {
    state: null,
    replaceState: (_s: unknown, _t: string, to: URL) =>
      location.href = String(to),
  }
  new Function('document', 'location', 'history', code)(
    document,
    location,
    history,
  )
  let form = document.querySelector('form[data-sift]')!
  let set = (q: string, value: string) => {
    let field = form.querySelector(q) as HTMLInputElement
    // linkedom's select has no value to set; a browser's does.
    if (field.localName == 'select') {
      Object.defineProperty(field, 'value', { value, configurable: true })
    } else field.value = value
    form.dispatchEvent(new document.defaultView!.Event('input'))
  }
  return {
    document,
    location,
    type: (q: string) => set('input[name=q]', q),
    order: (by: string) => set('select[name=sort]', by),
    none: () => document.querySelector('[data-none]')!.hasAttribute('hidden'),
  }
}

test('a short list has no search; a long one loads its script', async () => {
  let short = await html(8)
  assert(!short.includes('form method="get"') && !short.includes('/sift.js'))
  assert((await html(10)).includes('/sift.js'))
})

test('the newest change comes first, and the order can be by name', async () => {
  let p = await page()
  assertEquals(names(p.document), [...NAMES].reverse())
  p.order('name')
  assertEquals(names(p.document), [...NAMES].sort())
  assertEquals(p.location.searchParams.get('sort'), 'name')
  p.order('changed')
  assertEquals(names(p.document), [...NAMES].reverse())
  assertEquals(p.location.search, '')
})

test('typing keeps the apps whose name or address holds every word, the rest after them', async () => {
  let p = await page()
  p.type('e')
  assertEquals(names(p.document), ['Elm', 'Gem', 'Dew', 'Bee', 'Kite'])
  assertEquals(names(p.document, true).slice(0, 5), names(p.document))
  assertEquals(p.location.searchParams.get('q'), 'e')
  p.type('E M')
  assertEquals(names(p.document), ['Elm', 'Gem'])
  assertEquals(p.none(), true)
  p.type('zebra')
  assertEquals(names(p.document), [])
  assertEquals(p.none(), false)
  p.type('')
  assertEquals(names(p.document), [...NAMES].reverse())
})

test('the form sent asks the page for the same', async () => {
  let { document } = parseHTML(await html(10, { q: 'E M', sort: 'name' }))
  assertEquals(names(document), ['Elm', 'Gem'])
  assertEquals(
    (document.querySelector('input[name=q]') as HTMLInputElement).getAttribute(
      'value',
    ),
    'E M',
  )
  assert(document.querySelector('option[value=name][selected]'))
  let { document: none } = parseHTML(await html(10, { q: 'zebra', sort: '' }))
  assertEquals(names(none), [])
  assert(!none.querySelector('[data-none]')!.hasAttribute('hidden'))
})
