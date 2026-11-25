import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import { parseHTML } from 'linkedom'
import type { Matches, Tapping } from './operator-matches.ts'
import { type MatchesView, matchesView } from './operator-matches-view.ts'

export let SPACE = 'space-ada'
export let ADA = 'person-ada'
export let AT = 'https://yaks.test/ada/matches'

/** Ada's own space's Matches page, as the server says it beside the row. */
export let matchesViewOf = (round = ''): MatchesView => ({
  person: ADA,
  space: { eid: SPACE, slug: 'ada', operator: 'Elihu' },
  round,
})

/** A round of two drafts, `left` pairs left to pick in, and pair `n` next
 * where any are left. */
export let tapping = (
  { round = 'covers', left = 1, n = 1 } = {},
): Tapping => ({
  round,
  title: 'Covers',
  parts: [],
  ...left
    ? {
      card: {
        n,
        first: { entity: { eid: 'warm' }, label: 'Side A' },
        second: { entity: { eid: 'plain' }, label: 'Side B' },
      },
    }
    : {},
  left,
  picked: left ? 0 : 1,
  places: [],
})

/** The Matches page as `view` asks it, drawn from `read` as a server draws
 * it. */
export let page = (
  view = matchesViewOf(),
  read: Matches = { rounds: [] },
): HTMLElement => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'matches', 'data-matches-view': JSON.stringify(view) },
      matchesView(view, read),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document.querySelector<HTMLElement>('[data-view]')!
}
