/**
 * What a space's Updates say at their head, of the day: the visits to the
 * person's apps in the last day and the busiest of them, and which of their
 * friends are on yaks.app now. The browser draws them from the tab's page
 * graph when Updates first show (./updates-day-browser.ts).
 *
 * ```ts
 * import { dayLine, friendsLine } from '@yaks/platform/updates-day'
 * import { equal } from '@yaks/testing'
 *
 * let apps = [{ eid: 'a', slug: 'a', title: 'Recipe box' }, { eid: 'b', slug: 'b', title: 'Chores' }]
 * equal(dayLine(apps, new Map([['a', 70], ['b', 16]])), 'In the last day, your apps had 86 visits. Recipe box was the busiest.')
 * equal(friendsLine([{ name: 'Ann', seen: { state: 'building', spaces: [{ slug: 'k', title: 'Kitchen' }], apps: [] } }]), 'Friends on yaks.app now: Ann is building in Kitchen.')
 * ```
 *
 * @module
 */
import { createElement as h } from 'react'
import { Card } from '@yaks/ui/Card'
import type { Befriended, Seen } from './account-rows.ts'

/** What the browser needs to say the day's lines of a space's Updates: the
 * person, the space, and whether its friends line is said there (in their
 * own space alone). Carried on the `DAY` slot as JSON. */
export type Day = { person: string; space: string; friends: boolean }

/** The slot the day's lines stand in, holding its `Day`. */
export let DAY = 'data-updates-day'

export let daySlot = (day: Day) =>
  h('div', { className: 'Update_Day', [DAY]: JSON.stringify(day) })

/** An app a day's visits are counted for. */
export type Counted = { eid: string; slug: string; title?: string }

let COUNT = new Intl.NumberFormat('en')

/** The Operator's word on the last day: the visits across `apps` by their
 * `views`, and the busiest of them, when there are any to count. The server
 * knows no one's clock, so it is the last day and not today. None where
 * visits are not counted. */
export let dayLine = (
  apps: Counted[],
  views: Map<string, number> | null | undefined,
): string => {
  let said: string[] = []
  if (views && apps.length) {
    let counted = apps.map((a) => ({ a, n: views.get(a.eid) ?? 0 }))
      .filter((c) => c.n > 0).sort((x, y) => y.n - x.n)
    let total = counted.reduce((sum, c) => sum + c.n, 0)
    said.push(
      total
        ? `In the last day, your apps had ${COUNT.format(total)} visit${
          total == 1 ? '' : 's'
        }.`
        : 'Nobody visited your apps in the last day.',
    )
    if (counted.length > 1) {
      said.push(`${counted[0].a.title || counted[0].a.slug} was the busiest.`)
    }
  }
  return said.join(' ')
}

// What one friend on yaks.app now is doing.
let doing = (name: string, s: Seen) =>
  s.state == 'building'
    ? `${name} is building${
      s.spaces.length ? ` in ${s.spaces.map((x) => x.title).join(', ')}` : ''
    }`
    : s.apps.length
    ? `${name} has ${s.apps.map((a) => a.title).join(', ')} open`
    : `${name} is online`

/** Which of `friends` are on yaks.app now, in a line; none when nobody is. */
export let friendsLine = (
  friends: Pick<Befriended, 'name' | 'seen'>[],
): string => {
  let here = friends.flatMap((f) =>
    f.seen && f.seen.state != 'away' ? [doing(f.name, f.seen)] : []
  )
  return here.length ? `Friends on yaks.app now: ${here.join('. ')}.` : ''
}

/** The day's lines as cards: the visits, then the friends on yaks.app now,
 * each only where it says something. */
export let dayCards = (day: string, friends: string) =>
  [day, friends].filter(Boolean).map((words) =>
    h(
      Card,
      { className: 'Update Update-day' },
      h('p', { className: 'Update_Words' }, words),
    )
  )
