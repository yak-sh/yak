import { equal, test } from '@yaks/testing'
import { dayLine, friendsLine } from './updates-day.ts'

test('the last day in a line: visits and the busiest app', () => {
  let apps = ['Recipe box', 'Chores', 'Book club']
    .map((title, i) => ({ eid: `a${i}`, slug: `a${i}`, title }))
  let line = (views: [string, number][] | undefined, of = apps) =>
    dayLine(of, views && new Map(views))
  equal(
    line([['a0', 70], ['a1', 16]]),
    'In the last day, your apps had 86 visits. Recipe box was the busiest.',
  )
  equal(line([['a2', 1]]), 'In the last day, your apps had 1 visit.')
  equal(line([]), 'Nobody visited your apps in the last day.')
  // Visits not switched on, or no apps to count: nothing to say.
  equal(line(undefined), '')
  equal(dayLine(apps, null), '')
  equal(line([['a0', 5]], []), '')
})

test('friends on yaks.app now in a line: what each is doing, and none who are away', () => {
  let seen = (state: 'building' | 'online' | 'away', more = {}) => ({
    state,
    spaces: [],
    apps: [],
    ...more,
  })
  equal(
    friendsLine([
      { name: 'Ann', seen: seen('online') },
      {
        name: 'Bo',
        seen: seen('online', {
          apps: [{ slug: 'r', title: 'Recipes', space: 'k' }],
        }),
      },
      { name: 'Cy', seen: seen('away') },
      { name: 'Dee' },
    ]),
    'Friends on yaks.app now: Ann is online. Bo has Recipes open.',
  )
  equal(friendsLine([{ name: 'Cy', seen: seen('away') }]), '')
})
