import { equal, test } from '@yaks/testing'
import {
  matchesViewOf,
  page,
  tapping,
} from './operator-matches_fixture_test.ts'

let text = (at: Element | null) => at?.textContent?.replace(/\s+/g, ' ').trim()

test('the rounds each link to their own page with what is left to pick, and none says so', () => {
  let listed = page(matchesViewOf(), {
    rounds: [
      { round: 'covers', title: 'Covers', left: 2, of: 3 },
      { round: 'menus', title: '', left: 0, of: 1 },
    ],
  })
  equal(
    [...listed.querySelectorAll('li')].map((li) => [
      li.querySelector('a')?.getAttribute('href'),
      text(li),
    ]),
    [
      ['/ada/matches?round=covers', 'Covers · 2 to pick'],
      ['/ada/matches?round=menus', 'A round · nothing left to pick'],
    ],
  )
  equal(
    text(listed.querySelector('.Update_About')),
    'Elihu asks you to pick between drafts here before one is released.',
  )
  let none = page()
  equal(
    text(none.querySelector('.Talk_Hello h2, .Talk_Hello [class*=Empty]')),
    'Nothing to pick',
  )
})

test('a pair draws a picture by its bytes, an attempt by its parts, and a draft in its frame, each over its button', () => {
  let read = tapping()
  read.parts = ['answer']
  read.card!.first = {
    entity: { eid: 'pic' },
    artifact: { media_type: 'image/png', address: 'sha-1' },
    label: 'Side A',
  }
  read.card!.second = {
    entity: { eid: 'try' },
    writing: { output: { answer: 'Forty-two', notes: 'unseen' } },
    label: 'Side B',
  }
  let drawn = page(matchesViewOf('covers'), read)
  equal(
    drawn.querySelector('img')?.getAttribute('src'),
    '/ada/matches?round=covers&side=pic&sha=sha-1',
  )
  equal(text(drawn.querySelector('.Update_Prose')), 'Forty-two')
  equal(
    [...drawn.querySelectorAll('form[data-pick] button[name=chose]')].map((
      b,
    ) => [b.getAttribute('value'), text(b)]),
    [['first', 'Side A'], ['second', 'Side B'], ['neither', 'Neither']],
  )
  let draft = page(matchesViewOf('covers'), tapping())
  equal(
    draft.querySelector('iframe')?.getAttribute('src'),
    '/ada/updates?draft=warm',
  )
})

test('a round with nothing left says the picks settle it, and where each side stands', () => {
  let done = tapping({ left: 0 })
  done.places = [
    {
      eid: 'warm',
      label: 'Side A',
      shown: { entity: { eid: 'warm' } },
      measured: 'First of 2',
    },
  ]
  let drawn = page(matchesViewOf('covers'), done)
  equal(drawn.querySelector('form'), null)
  equal(
    text(drawn)!.includes(
      'Nothing left to pick here: your pick settles the rest.',
    ),
    true,
  )
  equal(text(drawn.querySelector('ol')), 'Side A: First of 2')
})
