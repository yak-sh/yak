import { equal, test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import { parseHTML } from 'linkedom'
import { bindUpdates } from './updates-list-browser.ts'
import { cardsView, type UpdatesView } from './updates-view.ts'
import {
  offerRows,
  type Update,
  updateCards,
  updateOffers,
  updateRows,
} from './update-rows.ts'
import { graph } from './page-graph_fixture_test.ts'

let ADA = 'person-ada'
let SPACE = 'space-home'
let CLUB = 'space-club'
let home = { eid: SPACE, slug: 'home', operator: 'Elihu' }
let club = { eid: CLUB, slug: 'club', operator: 'Iris' }
let view: UpdatesView = { person: ADA, spaces: [home], apex: 'yaks.app' }
let update = (eid: string, at: string, more: Partial<Update> = {}) => ({
  eid,
  at: `2026-11-${at}T00:00:00Z`,
  needs: false,
  unread: false,
  dismissed: false,
  words: eid,
  ...more,
})

// The cards view as the server draws it from `updates`, in `at`.
let page = (updates: Update[], at = view) => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'updates', 'data-updates-view': JSON.stringify(at) },
      cardsView(at, updates.map((u) => ({ ...u, space: home })), () => []),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document.querySelector<HTMLElement>('[data-view]')!
}

let shown = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[data-key]')].map((c) =>
    `${c.dataset.key}${c.classList.contains('Update-new') ? '*' : ''}`
  )

let held = (cards: Update[], offers: Update[] = []) => {
  let g = graph((b) => Promise.resolve(b))
  g.set(updateCards(SPACE), updateRows(ADA, SPACE, cards))
  g.set(updateOffers(SPACE), offerRows(ADA, SPACE, offers))
  return g
}

test('the Updates cards draw again as the Operator and the directory write: what needs the person first, then the newest', () => {
  let old = update('old', '01')
  let root = page([old])
  let g = held([old])
  bindUpdates(root, g)
  g.set(
    updateCards(SPACE),
    updateRows(ADA, SPACE, [update('ask', '02', { needs: true }), old]),
  )
  g.set(
    updateOffers(SPACE),
    offerRows(ADA, SPACE, [
      update('friend', '03', { friend: { person: 'eli', suggested: false } }),
    ]),
  )
  equal(shown(root), ['ask', 'friend', 'old'])
  g.set(updateCards(SPACE), updateRows(ADA, SPACE, [old]))
  equal(shown(root), ['friend', 'old'], 'an answered question leaves')
})

test('a card drawn again keeps its actions’ id, and what was new when the page opened stays new', () => {
  let fresh = update('fresh', '02', { unread: true })
  let root = page([fresh])
  let g = held([fresh])
  let id = root.querySelector<HTMLElement>('[data-key=fresh]')!.dataset
    .inboxCard
  let redrawn = 0
  root.addEventListener('inbox:redrawn', () => redrawn++)
  bindUpdates(root, g)
  // Opening the page read it.
  g.set(
    updateCards(SPACE),
    updateRows(ADA, SPACE, [{ ...fresh, unread: false }]),
  )
  let card = root.querySelector<HTMLElement>('[data-key=fresh]')!
  equal([shown(root), card.dataset.inboxCard, redrawn], [['fresh*'], id, 1])
})

test('until every line has answered, the cards stay as the server drew them', () => {
  let one = update('one', '01')
  let root = page([one])
  let before = root.innerHTML
  let g = held([one])
  // The directory has not answered the offers yet.
  let watch = g.watch
  g.watch = (line) =>
    line == updateOffers(SPACE)
      ? Object.defineProperty(watch(line), 'ready', { value: false })
      : watch(line)
  bindUpdates(root, g)
  g.set(updateCards(SPACE), updateRows(ADA, SPACE, []))
  equal(root.innerHTML, before)
})

test('every space’s Updates together: each card names its space, and a space whose Operator refused keeps what it said', () => {
  let across = { ...view, spaces: [home, club], back: '/updates' }
  let root = page([], across)
  let g = held([update('mine', '01')])
  g.set(
    updateCards(CLUB),
    updateRows(ADA, CLUB, [update('theirs', '02', { needs: true })]),
  )
  let watch = g.watch
  g.watch = (line) =>
    line == updateOffers(CLUB)
      ? Object.defineProperties(watch(line), {
        ready: { value: false },
        refused: { value: 'away' },
      })
      : watch(line)
  bindUpdates(root, g)
  g.set(updateOffers(SPACE), [])
  equal(shown(root), ['theirs', 'mine'])
  equal(
    [...root.querySelectorAll('.Update_Where')].map((a) => a.textContent),
    ['club · Iris', 'home · Elihu'],
  )
})
