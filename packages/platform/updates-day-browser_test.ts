import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import { bindDay } from './updates-day-browser.ts'
import { show } from './talk-views-browser.ts'
import { DAY, type Day } from './updates-day.ts'
import { VIEW } from './talk-views.ts'
import { appRows, sideApps } from './side-rows.ts'
import { dayRows, dayVisits } from './visit-counts.ts'
import { friendRows, FRIENDS } from './account-rows.ts'
import { graph } from './page-graph_fixture_test.ts'

// A chat page holding its space's Updates hidden, their day's slot bound to
// a page graph standing in for the tab's.
let page = (friends: boolean) => {
  let day: Day = { person: 'ada', space: 'club', friends }
  let { document } = parseHTML(`<html><body>
<section ${VIEW}="{}"><p>chat</p></section>
<section ${VIEW}="{}" hidden><div ${DAY}='${
    JSON.stringify(day)
  }'></div></section>
</body></html>`)
  let doc = document as unknown as Document
  let views = [...doc.querySelectorAll<HTMLElement>(`[${VIEW}]`)]
  let g = graph((b: Bundle[]) => Promise.resolve(b))
  bindDay(doc.querySelector<HTMLElement>(`[${DAY}]`)!, g)
  let said = () =>
    [...doc.querySelectorAll('.Update-day')].map((c) => c.textContent)
  return { g, said, updates: () => show(doc, views, views[1]) }
}

let apps = appRows('ada', 'club', [
  { eid: 'r', slug: 'recipes', title: 'Recipes' },
  { eid: 'c', slug: 'chores', title: 'Chores' },
])

test('Updates shown in place say the last day’s visits and the friends here, read only once they show', () => {
  let { g, said, updates } = page(true)
  equal(g.open, [], 'nothing is read while they stand hidden')
  updates()
  equal(g.open, [sideApps('club'), dayVisits('club'), FRIENDS])
  g.set(sideApps('club'), apps)
  g.set(dayVisits('club'), dayRows('club', new Map([['r', 4], ['c', 1]])))
  g.set(
    FRIENDS,
    friendRows('ada', [{
      person: 'bo',
      name: 'Bo',
      shared: [],
      seen: { state: 'online', spaces: [], apps: [] },
    }]),
  )
  equal(said(), [
    'In the last day, your apps had 5 visits. Recipes was the busiest.',
    'Friends on yaks.app now: Bo is online.',
  ])
})

test('outside their own space, Updates say no friends, and nothing of visits not counted', () => {
  let { g, said, updates } = page(false)
  updates()
  equal(g.open, [sideApps('club'), dayVisits('club')])
  g.set(sideApps('club'), apps)
  g.set(dayVisits('club'), dayRows('club', null))
  equal(said(), [])
})
