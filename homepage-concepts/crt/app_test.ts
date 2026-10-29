// The shipped concept runs on a document with scroll inputs and a local clock.
import { clock, equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'

let html = await Deno.readTextFile(new URL('index.html', import.meta.url))
let code = await Deno.readTextFile(new URL('app.js', import.meta.url))
let script = new Function(
  'document',
  'matchMedia',
  'scrollY',
  'scrollTo',
  'requestAnimationFrame',
  'addEventListener',
  'setTimeout',
  'clearTimeout',
  code,
)
let page = () => {
  let { document } = parseHTML(html)
  let time = clock()
  let $ = (selector: string) => document.querySelector<HTMLElement>(selector)!
  let top = 0
  let scroll = () => {}
  // Layout is an input; this document does not calculate or paint it.
  Object.assign($('.story'), { getBoundingClientRect: () => ({ top }) })
  Object.defineProperty($('.story'), 'offsetHeight', { value: 1000 })
  Object.defineProperty($('.scene'), 'offsetHeight', { value: 100 })
  script(
    document,
    () => ({ matches: true }),
    0,
    () => {},
    (callback: () => void) => callback(),
    (type: string, callback: () => void) => {
      if (type === 'scroll') scroll = callback
    },
    (callback: () => void, delay: number) => time.after(delay, callback),
    (cancel?: () => void) => cancel?.(),
  )
  return {
    $,
    time,
    scroll: (offset: number) => {
      top = -offset
      scroll()
    },
  }
}
let stages = page()
let filters = page()
let apps = page()

test('CRT version controls and scroll inputs update conversation, recipes, and disk versions', () => {
  equal(stages.$('#page-number').textContent, '01 / 03')
  equal(stages.$('#app-screen').querySelectorAll('.recipe-card').length, 3)
  stages.$('[data-stage="1"]').click()
  equal(stages.$('#page-number').textContent, '02 / 03')
  ok(stages.$('#conversation').textContent.includes('vegetarian'))
  stages.scroll(800)
  equal(stages.$('#page-number').textContent, '03 / 03')
  equal(stages.$('[data-versions=recipes]').querySelectorAll('del').length, 2)
  equal(
    stages.$('#app-screen').querySelectorAll('.shopping-list input').length,
    5,
  )
})

test('CRT recipe filters show quick recipes and restore the collection', () => {
  filters.$('[data-stage="1"]').click()
  filters.$('[data-filter=quick]').click()
  equal(
    filters.$('#app-screen').querySelectorAll('.recipe-card:not([hidden])')
      .length,
    1,
  )
  filters.$('[data-filter=all]').click()
  equal(
    filters.$('#app-screen').querySelectorAll('.recipe-card:not([hidden])')
      .length,
    3,
  )
})

test('CRT disk selection changes the app, conversation, and selected control', async () => {
  for (
    let [app, brand] of [['garden', 'Out in the garden'], [
      'club',
      'The reading room',
    ], ['recipes', 'The recipe box']]
  ) {
    apps.$(`[data-app=${app}]`).click()
    await apps.time.advance(0)
    equal(apps.$('.app-brand').textContent, brand)
    equal(apps.$(`[data-app=${app}]`).getAttribute('aria-pressed'), 'true')
    equal(
      apps.$('#selection-text').textContent.includes('is in the drive'),
      true,
    )
    equal(apps.$('#app-screen').classList.contains('changing'), false)
  }
})
