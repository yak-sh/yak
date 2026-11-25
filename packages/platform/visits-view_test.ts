import { equal, test } from '@yaks/testing'
import { NINE, NONE, page, RECIPES } from './visits_fixture_test.ts'

let html = (at: HTMLElement) => at.outerHTML

test('an app’s visits are a bar per day and three lists, drawn as markup', () => {
  let at = page()
  equal(at.querySelector('.Report_Total')?.textContent, '9 visits')
  // One rect per day, the tallest full height and the empty day flat.
  equal(at.querySelectorAll('.Chart_Bar').length, 3)
  equal(html(at).includes('height="40.00"'), true)
  equal(html(at).includes('height="0.00"'), true)
  equal(
    [...at.querySelectorAll('.Report_Label')].map((l) => l.textContent),
    ['/dinner', 'news.example.com', 'US'],
  )
  equal(
    [...at.querySelectorAll('.Report_Span span')].map((s) => s.textContent),
    ['Sep 4th, 2026', 'Sep 6th, 2026'],
  )
  equal(
    at.querySelector('.Card_Title a')?.getAttribute('href'),
    'https://adas.yaks.test/recipes/',
  )
})

test('an app nobody opened says so, with no chart', () => {
  let at = page([RECIPES], new Map([[RECIPES.eid, NONE]]))
  equal(at.querySelector('.Report_Total')?.textContent, '0 visits')
  equal(at.querySelector('.Chart'), null)
})

test('a platform that cannot count says one sentence, and a space with no apps says there is nothing yet', () => {
  let off = page([RECIPES], null)
  equal(off.textContent!.includes('not switched on'), true)
  equal(off.querySelector('.Chart'), null)
  equal(page([], new Map()).textContent!.includes('No visits yet'), true)
})

test('an app not yet counted is left out until it is', () => {
  let notes = { eid: 'notes', slug: 'notes', title: 'Notes' }
  let at = page([RECIPES, notes], new Map([[RECIPES.eid, NINE]]))
  equal(at.querySelectorAll('.Report').length, 1)
})
