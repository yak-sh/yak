import { equal, test } from '@yaks/testing'
import {
  DIARY,
  holder,
  page,
  roster,
  SPACE,
  watched,
} from './people_fixture_test.ts'

// Each card's title, and each of its rows: who, and the buttons beside them.
let cards = (root: HTMLElement) =>
  [...root.querySelectorAll('.Card')].map((c) => [
    c.querySelector('.Card_Title')?.textContent,
    ...[...c.querySelectorAll('li')].map((li) =>
      [
        li.querySelector('.Rows_Name')?.textContent ??
          li.querySelector('span')?.textContent,
        ...[...li.querySelectorAll('button')].map((b) => b.textContent),
      ].join(' | ')
    ),
  ])

test('the People page lists members, then each app with a guest or an invitation, each with what the owner may do', () => {
  let { root } = page(watched({
    holders: roster(
      holder('bo', 'editor'),
      holder('cy', 'viewer', 'invite'),
      holder('ann', 'editor', 'grant', DIARY.eid),
    ),
  }))
  equal(cards(root).slice(1), [
    [
      'Members · every app',
      'ada',
      'bo | Remove',
      'cy | Send again | Withdraw',
    ],
    ['Diary · this app only', 'ann | Remove'],
  ])
  let cy = [...root.querySelectorAll('li')][2]
  equal(cy.textContent!.includes('not accepted yet'), true)
  equal(
    cy.querySelector('[data-people=inviteAgain] [name=again]')
      ?.getAttribute('value'),
    holder('cy', 'viewer', 'invite').place,
  )
  let off = [...root.querySelectorAll('[data-people=memberRemove]')].map((f) =>
    [...f.querySelectorAll('input')].map((i) => i.getAttribute('value'))
  )
  equal(off, [
    ['bo@example.com'],
    ['cy@example.com'],
    ['ann@example.com', DIARY.slug],
  ])
})

test('an invitation may name a friend, or an address, and one app', () => {
  let alone = page().root
  equal(alone.querySelector('[name=friend]'), null)
  equal(alone.querySelector('[name=invite]')?.hasAttribute('required'), true)
  let { root } = page(watched({ friends: ['fay'] }))
  equal(
    [...root.querySelectorAll('[name=friend] option')].map((o) =>
      o.textContent
    ),
    ['Someone else, by email', 'fay'],
  )
  equal(root.querySelector('[name=invite]')?.hasAttribute('required'), false)
  equal(
    [...root.querySelectorAll('[name=app] option')].map((o) => o.textContent),
    ['Every app here', 'Diary'],
  )
})

test('an Operator let in is listed with a Remove, and only spaces not already in are offered', () => {
  let spaces = [
    { ...SPACE, title: 'Gift shop' },
    { eid: 'space-farm', slug: 'farm', title: 'Farm' },
    { eid: 'space-bake', slug: 'bake', title: '' },
  ]
  let { root } = page(watched({
    spaces,
    admitted: [{
      operator: 'space-farm',
      slug: 'farm',
      title: 'Farm',
      role: 'viewer',
    }],
  }))
  let operators = cards(root).find((c) => c[0] == 'Operators from other spaces')
  equal(operators, [
    'Operators from other spaces',
    'Farm’s Operator · only looks | Remove',
  ])
  equal(
    [...root.querySelectorAll('[name=operator] option')].map((o) => [
      o.getAttribute('value'),
      o.textContent,
    ]),
    [['space-bake', 'bake']],
  )
  let alone = page(watched({ spaces: [spaces[0]] })).root
  equal(
    cards(alone).some((c) => c[0] == 'Operators from other spaces'),
    false,
  )
})
