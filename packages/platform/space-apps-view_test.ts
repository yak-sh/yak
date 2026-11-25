import { equal, test } from '@yaks/testing'
import {
  apps,
  appsAt,
  broke,
  NAMES,
  names,
  page,
} from './space-apps_fixture_test.ts'

let search = (at: HTMLElement) => at.querySelector('form[data-find-apps]')

test('a short list has no search; a long one is searched and ordered, newest change first', () => {
  equal(search(page(appsAt(), apps(8))), null)
  let long = page(appsAt(), apps(10))
  equal(!!search(long), true)
  equal(names(long), [...NAMES].reverse())
  equal(
    [...long.querySelectorAll('h2')].map((t) => t.textContent),
    ['Connect your agent', '10 apps'],
  )
})

test('what the address asked for, the page answers sifted', () => {
  let asked = page(appsAt({ sift: { q: 'E M', sort: 'name' } }), apps(10))
  equal(names(asked), ['Elm', 'Gem'])
  equal(asked.querySelector('input[name=q]')?.getAttribute('value'), 'E M')
  equal(!!asked.querySelector('option[value=name][selected]'), true)
  let none = page(appsAt({ sift: { q: 'zebra', sort: '' } }), apps(10))
  equal(names(none), [])
  equal(
    none.textContent!.includes('No app here has that in its name or address.'),
    true,
  )
})

test('an app changed by someone else says who, by the name its row carries', () => {
  let [mine, theirs] = apps(2)
  let at = page(appsAt(), [mine, {
    ...theirs,
    deployed: { at: '2026-11-20T00:00:00Z', by: 'grace', name: 'Grace' },
  }])
  // Newest change first: Grace's deploy, then Ada's own app.
  let meta = [...at.querySelectorAll('#apps > li .Rows_Meta')].map((m) =>
    m.textContent!
  )
  equal(meta.map((m) => m.includes(' by ')), [true, false])
  equal(meta[0].includes('by Grace'), true)
})

test('an app with breaks wears a badge that opens what broke, and what to ask', () => {
  let at = page(appsAt(), apps(2), { a1: [broke('ark is not a function')] })
  let badge = at.querySelector('.Badge[popovertarget]')
  equal(badge?.textContent, '1 error')
  let fix = at.querySelector(`#${badge!.getAttribute('popovertarget')}`)!
  equal(fix.textContent!.includes('ark is not a function'), true)
  equal(fix.textContent!.includes('Fix the errors in my Ark app'), true)
})

test('the connect card shows while no agent is connected, and neither way until that is known', () => {
  let card = (agents?: number) =>
    page(appsAt(), apps(1), {}, agents).querySelector('[data-disconnected]')!
  equal(card(0).hasAttribute('hidden'), false)
  equal(card(2).hasAttribute('hidden'), true)
  equal(card().hasAttribute('hidden'), true)
  equal(card().hasAttribute('data-unsettled'), true)
})

test('with no app, the page says how to make the first, as an agent is connected or not', () => {
  let shown = (agents: number) =>
    [
      ...page(appsAt(), [], {}, agents).querySelectorAll(
        '.Empty :is([data-connected], [data-disconnected]):not([hidden])',
      ),
    ].map((d) => d.textContent!.includes('Try this'))
  equal(shown(1), [true])
  equal(shown(0), [false])
})
