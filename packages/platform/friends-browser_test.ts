import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { type Answer, paint } from './friends-browser.ts'

let NOW = Date.parse('2026-11-24T12:00:00Z')

// A Friends list as the server draws it, in name order.
let drawn = (...names: string[]) =>
  parseHTML(
    `<ul data-friends="/manage/account/friends">${
      names.map((n) =>
        `<li data-friend="${n}"><span data-friend-dot hidden></span><small data-friend-seen hidden></small></li>`
      ).join('')
    }</ul>`,
  ).document.querySelector('ul')!

let said = (list: Element) =>
  [...list.querySelectorAll<HTMLElement>('[data-friend]')].map((r) => {
    let dot = r.querySelector<HTMLElement>('[data-friend-dot]')!
    let seen = r.querySelector<HTMLElement>('[data-friend-seen]')!
    return [
      r.dataset.friend,
      dot.hidden ? '' : '●',
      seen.hidden ? '' : seen.textContent,
    ].filter(Boolean).join(' ')
  })

let painted = (list: Element, answer: Answer['friends']) => {
  let by = new Map(answer.map(({ person, ...s }) => [person, s]))
  paint(list, (p) => by.get(p), NOW)
  return said(list)
}

test('online friends come first with a dot, then the most recently active, then the hidden', () => {
  let list = drawn('ann', 'bo', 'cy', 'dee')
  equal(
    painted(list, [
      { person: 'ann' },
      { person: 'bo', state: 'away', last: '2026-11-21T12:00:00Z' },
      { person: 'cy', state: 'away', last: '2026-11-24T09:00:00Z' },
      { person: 'dee', state: 'online', last: '2026-11-24T11:59:00Z' },
    ]),
    [
      'dee ● Online now',
      'cy Active 3 hours ago',
      'bo Active 3 days ago',
      'ann',
    ],
  )
})

test('a friend who leaves loses the dot and moves down; one who arrives moves up', () => {
  let list = drawn('ann', 'bo')
  painted(list, [{ person: 'ann', state: 'building' }, { person: 'bo' }])
  equal(
    painted(list, [
      { person: 'ann', state: 'away', last: '2026-11-24T11:58:00Z' },
      { person: 'bo', state: 'online' },
    ]),
    ['bo ● Online now', 'ann Active 2 minutes ago'],
  )
})
