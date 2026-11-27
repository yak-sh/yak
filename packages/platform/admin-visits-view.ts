/**
 * The admin's Visits page (./admin-visits.ts): the platform's visits drawn as
 * a space's Visits page draws an app's (./visits-view.ts `chart`, `column`),
 * under the same tabs (`botTabs`): people's visits alone by default, a bar a
 * day and the spaces and apps they opened most, each opening on its space's
 * admin page; or every visit, bots' too, and then the likely bots, the
 * verified bots and the visits from before they were told apart, a bar a day
 * each. The split of people and bots is said
 * either way, and the platform's own test spaces are counted apart.
 *
 * @module
 */
import { createElement as h } from 'react'
import { Card } from '@yaks/ui/Card'
import { Form } from '@yaks/ui/Form'
import { Report } from '@yaks/ui/Report'
import { count } from './standing.ts'
import {
  botsAt,
  botTabs,
  chart,
  column,
  type Linked,
  says,
} from './visits-view.ts'
import { counted, type Place, type PlatformVisits } from './admin-visits.ts'
import { all, type Split } from './visitor.ts'
import { NOT_ON } from './visit-counts.ts'
import type { Day } from './visit-counts.ts'

let sum = (days: Day[]) => days.reduce((n, d) => n + d.views, 0)

let visits = (n: number) => [
  `${count(n)} `,
  h(Report.Unit, null, n == 1 ? 'visit' : 'visits'),
]

let report = (id: string, title: string, total: number, ...body: unknown[]) =>
  h(
    Report,
    { 'aria-labelledby': `visits-${id}` },
    h(
      Card.Head,
      null,
      h(Card.Title, { id: `visits-${id}` }, title),
      h(Report.Total, null, visits(total)),
    ),
    ...body as never[],
  )

/** The admin's Visits page from `v`, each place opening at `base/<space>`,
 * people's visits alone or every visit (`bots`); one sentence where the
 * platform cannot count (`v` null). */
export let adminVisitsView = (
  v: PlatformVisits | null,
  base: string,
  bots = false,
  now = Date.now(),
) => {
  if (!v) return h(Form.Hint, null, NOT_ON)
  let lines = (places: Place[], views: (p: Place) => number): Linked[] =>
    places.map((p) => ({
      name: p.name,
      views: views(p),
      href: `${base}/${encodeURIComponent(p.space)}`,
    })).filter((l) => l.views > 0)
  let total: Split = {
    people: sum(v.people),
    bots: sum(v.bots),
    verified: sum(v.verified),
    unknown: sum(v.unknown),
  }
  let by = bots ? all : (p: Place) => p.people
  let shown = bots
    ? v.people.map((d, i) => ({
      day: d.day,
      views: d.views + v.bots[i].views + v.verified[i].views +
        v.unknown[i].views,
    }))
    : v.people
  let bars = (id: string, title: string, days: Day[]) => {
    let n = sum(days)
    return report(id, title, n, n ? chart(days) : null)
  }
  return [
    h(
      Form.Hint,
      null,
      `The last ${v.days} days on every space, ${counted(v.at, now)}: ` +
        `${says(total)}. ` +
        'Test spaces, whose every member is a test account, are counted apart.',
    ),
    botTabs(bots, botsAt),
    report(
      'people',
      bots ? 'Every visit' : 'People',
      bots ? all(total) : total.people,
      sum(shown) ? chart(shown) : null,
      h(
        Report.Tops,
        null,
        column('Spaces', lines(v.spaces, by)),
        column('Apps', lines(v.apps, by)),
      ),
    ),
    bots ? bars('bots', 'Likely bots', v.bots) : null,
    bots ? bars('verified', 'Verified bots', v.verified) : null,
    bots && total.unknown ? bars('unknown', 'Unknown', v.unknown) : null,
    report(
      'tests',
      'Test spaces',
      all(v.tests.split),
      h(
        Report.Tops,
        null,
        column('Spaces', lines(v.tests.spaces, all)),
      ),
    ),
  ]
}
