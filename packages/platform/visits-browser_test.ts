import { equal, test } from '@yaks/testing'
import { sideApps } from './side-rows.ts'
import { visitCounts } from './visit-counts.ts'
import { bindVisits } from './visits-browser.ts'
import { graph } from './page-graph_fixture_test.ts'
import {
  NINE,
  NONE,
  page,
  RECIPES,
  rows,
  SPACE,
} from './visits_fixture_test.ts'

let bound = (held = rows()) => {
  let root = page()
  let g = graph((b) => Promise.resolve(b))
  g.set(sideApps(SPACE), held.apps)
  g.set(visitCounts(SPACE), held.counts)
  bindVisits(root, g)
  let set = (next: ReturnType<typeof rows>) => {
    g.set(sideApps(SPACE), next.apps)
    g.set(visitCounts(SPACE), next.counts)
  }
  return { root, set }
}
let titles = (root: HTMLElement) =>
  [...root.querySelectorAll('.Card_Title')].map((t) => t.textContent)

test('an app renamed or made elsewhere redraws the page, with the views read again for it', () => {
  let { root, set } = bound()
  equal(titles(root), ['Recipes'])
  set(rows([{ ...RECIPES, title: 'Dinners' }]))
  equal(titles(root), ['Dinners'])
  let notes = { eid: 'notes', slug: 'notes', title: 'Notes' }
  set(rows([RECIPES, notes], new Map([[RECIPES.eid, NINE], [notes.eid, NONE]])))
  equal(titles(root), ['Recipes', 'Notes'])
  set(rows([], new Map()))
  equal(root.textContent!.includes('No visits yet'), true)
})

test('views that stop being countable say so in place of the charts', () => {
  let { root, set } = bound()
  set(rows([RECIPES], null))
  equal(root.textContent!.includes('not switched on'), true)
  equal(root.querySelector('.Chart'), null)
})
