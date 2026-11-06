import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import type { App } from './directory.ts'
import { library } from './pages.ts'
import { chatPath } from './route.ts'
import { folds, type Plain, plain, type Seen } from './unseen.ts'

// Two reports of one throw, as the tracker holds them, are one break.
let chores = { eid: 'a1', slug: 'chores' } as App
let report = (eid: string): Seen => ({
  app: chores,
  hit: {
    kind: 'error',
    entity: { eid },
    error: {
      message: 'chores is not a function',
      at: `2026-10-14T00:0${eid}`,
    },
  },
})
let page = (errors: Plain[]) =>
  library(
    {
      space: 'fixme',
      apps: [
        { eid: 'a1', slug: 'chores', title: 'chores', errors },
        { eid: 'a2', slug: 'notes', title: 'notes' },
      ],
    } as Parameters<typeof library>[0],
    {},
  )

let reports = [report('1'), report('2')]
let errors = folds(reports).map(plain)
page([])
test('an app that throws is marked on the dashboard, with what to ask', () => {
  let html = page(errors)
  // One mark, on the app that broke, linking to what to do about it.
  assertEquals(html.match(/Apps_Tag-warn[^>]*>[^<]*/g)?.length, 1)
  assertMatch(
    html,
    /<strong>chores<\/strong>.*?<a class="Apps_Tag Apps_Tag-warn" href="#fix-chores">1 error<\/a>/s,
  )
  let fix = html.slice(html.indexOf('id="fix-chores"'))
  assertStringIncludes(fix, 'chores is not a function')
  assertStringIncludes(fix, '2 times')
  assertStringIncludes(fix, 'Fix the errors in my chores app on yaks.app')
})

test('a fixed app has no dashboard error mark or repair request', () => {
  assert(!/Apps_Tag-warn|class="Card Fix"/.test(page([])))
})

// What the space's Operator made of a break stands beside it (T-136297):
// working, its answer, or why it could not finish, with the way to its work.
let [broke] = errors
let shown = (operator?: Plain['operator']) => {
  let html = page([{ ...broke, operator }])
  return html.slice(html.indexOf('id="fix-chores"'))
}
test("a break says what the space's Operator made of it", () => {
  assert(!shown().includes('The Operator'), 'a break it never heard of')
})

test('a working Operator opens to its conversation about the break', () => {
  let html = shown({})
  assertStringIncludes(html, 'The Operator is fixing it.')
  assertStringIncludes(html, `href="${chatPath('fixme', broke.fix)}"`)
})

test('the dashboard shows the Operator answer about a break', () => {
  assertStringIncludes(
    shown({ answer: 'Defined chores and deployed.' }),
    'The Operator: Defined chores and deployed.',
  )
})

test('the dashboard keeps the reason its Operator could not fix a break', () => {
  assertStringIncludes(
    shown({ failed: 'This space has spent its model budget.' }),
    'The Operator could not fix it. This space has spent its model budget.',
  )
})
