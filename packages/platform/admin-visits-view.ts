/**
 * The admin's Visits page (./admin-visits.ts): the platform's visits drawn as
 * a space's Visits page draws an app's (./visits-view.ts `chart`, `column`).
 * People first, a bar a day and the spaces and apps they opened most, each
 * opening on its space's admin page; then bots and agents, a bar a day; then
 * the platform's own test spaces, apart.
 *
 * @module
 */
import { h } from 'preact'
import { Card } from '@yaks/ui/Card'
import { Form } from '@yaks/ui/Form'
import { Report } from '@yaks/ui/Report'
import { count } from './standing.ts'
import { chart, column, type Linked } from './visits-view.ts'
import { counted, type Place, type PlatformVisits } from './admin-visits.ts'
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

/** The admin's Visits page from `v`, each place opening at `base/<space>`;
 * one sentence where the platform cannot count (`v` null). */
export let adminVisitsView = (
  v: PlatformVisits | null,
  base: string,
  now = Date.now(),
) => {
  if (!v) return h(Form.Hint, null, NOT_ON)
  let lines = (all: Place[], views: (p: Place) => number): Linked[] =>
    all.map((p) => ({
      name: p.name,
      views: views(p),
      href: `${base}/${encodeURIComponent(p.space)}`,
    })).filter((l) => l.views > 0)
  let people = sum(v.people)
  let others = sum(v.others)
  let tested = v.tests.people + v.tests.others
  return [
    h(
      Form.Hint,
      null,
      `The last ${v.days} days on every space, ${counted(v.at, now)}. ` +
        'Test spaces, whose every member is a test account, are counted apart.',
    ),
    report(
      'people',
      'People',
      people,
      people ? chart(v.people) : null,
      h(
        Report.Tops,
        null,
        column('Spaces', lines(v.spaces, (p) => p.people)),
        column('Apps', lines(v.apps, (p) => p.people)),
      ),
    ),
    report(
      'others',
      'Bots and agents',
      others,
      others ? chart(v.others) : null,
    ),
    report(
      'tests',
      'Test spaces',
      tested,
      h(
        Report.Tops,
        null,
        column('Spaces', lines(v.tests.spaces, (p) => p.people + p.others)),
      ),
    ),
  ]
}
