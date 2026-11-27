/**
 * A space's Visits page (Manage, T-34497), drawn from rows: the space's apps
 * (./side-rows.ts `appsOf`) and each one's views (./visit-counts.ts). A block
 * an app: a bar per day for the window, then three short lists (the pages
 * people opened, the sites that sent them, the countries they were in) as
 * tables, because a table reads on a phone. The server draws it for the first
 * paint, and the browser draws it again as the rows move
 * (./visits-browser.ts).
 *
 * @module
 */
import { h, type VNode } from 'preact'
import { Card } from '@yaks/ui/Card'
import { Form } from '@yaks/ui/Form'
import { Report } from '@yaks/ui/Report'
import { Tabs } from '@yaks/ui/Tabs'
import { columns } from '@yaks/ui/chart'
import { day } from '@yaks/ui/relative'
import type { MarkedApp } from './routes.ts'
import { count } from './standing.ts'
import { empty } from './page-parts.ts'
import { type Counted, type Line, NOT_ON } from './visit-counts.ts'
import type { Split } from './visitor.ts'

/** What the Visits page says about itself beside the rows: whose page it is,
 * the space it counts (its eid), where its apps are served, and whether it
 * counts bots' visits beside people's. */
export type VisitsView = {
  person: string
  space: string
  site: string
  bots?: boolean
}

/** How many of a window's visits were people's, likely bots' and verified
 * bots' (@yaks/platform/visitor), in a line. */
/// says({ people: 1, bots: 1200, verified: 3 }) -> '1 person, 1,200 likely bots, 3 verified bots'
export let says = (s: Split) =>
  [
    `${count(s.people)} ${s.people == 1 ? 'person' : 'people'}`,
    `${count(s.bots)} likely bot${s.bots == 1 ? '' : 's'}`,
    `${count(s.verified)} verified bot${s.verified == 1 ? '' : 's'}`,
  ].join(', ')

/** The two ways visits are counted, each a link (`href`): people alone, the
 * default, or every visit with bots'. The Visits page and the admin's pages
 * draw the same tabs. */
export let botTabs = (bots: boolean, href: (bots: boolean) => string) =>
  h(
    Tabs,
    { role: 'group', 'aria-label': 'Visits counted' },
    h(Tabs.Tab, {
      href: href(false),
      mod: !bots && 'on',
      'aria-current': !bots ? 'true' : undefined,
    }, 'People'),
    h(Tabs.Tab, {
      href: href(true),
      mod: bots && 'on',
      'aria-current': bots ? 'true' : undefined,
    }, 'With bots'),
  )

/** Where a page's tabs go: its own address, with `?bots` or without. */
export let botsAt = (bots: boolean) => bots ? '?bots' : '?'

// Short enough for the ends of an axis.
let axisDay = (iso: string) => day(iso, 'UTC')

/** A bar a day over `days`, the first and last day under it: the chart every
 * visits report draws, a space's and the platform's (./admin-visits-view.ts). */
export let chart = (days: Counted['daily']) =>
  h(
    Report.Plot,
    null,
    columns(h as never, {
      from: days[0]?.day ?? '',
      values: days.map((d) => d.views),
      noun: 'visit',
    }) as VNode,
    h(
      Report.Span,
      null,
      h('span', null, axisDay(days[0]?.day ?? '')),
      h('span', null, axisDay(days[days.length - 1]?.day ?? '')),
    ),
  )

/** A line of a top list, with the page it opens where there is one. */
export type Linked = Line & { href?: string }

/** A short list under its heading, a name and its views a line; nothing for
 * an empty list. */
export let column = (head: string, rows: Linked[]) =>
  rows.length
    ? h(
      Report.Column,
      null,
      h(Report.Heading, null, head),
      h(
        Report.List,
        null,
        rows.map((r) =>
          h(
            Report.Item,
            null,
            h(
              Report.Label,
              { title: r.name },
              r.href ? h('a', { href: r.href }, r.name) : r.name,
            ),
            h(Report.Value, null, count(r.views)),
          )
        ),
      ),
    )
    : null

/** One app's block of the Visits page: its total, people's or every visit's
 * as `c` counts them, the split of people and bots, a bar per day and the
 * pages, sites and countries, served at `site`. The admin's page of the app
 * draws the same block (yaks.app's admin.ts). */
export let appVisits = (app: MarkedApp, c: Counted, site: string) =>
  h(
    Report,
    { 'aria-labelledby': `visits-${app.slug}`, 'data-key': app.eid },
    h(
      Card.Head,
      null,
      h(
        Card.Title,
        { id: `visits-${app.slug}` },
        h(Card.Link, {
          href: `${site}/${encodeURIComponent(app.slug)}/`,
          target: '_blank',
          rel: 'noopener',
        }, app.title || app.slug),
      ),
      h(
        Report.Total,
        null,
        `${count(c.total)} `,
        h(Report.Unit, null, c.total == 1 ? 'visit' : 'visits'),
      ),
    ),
    c.split ? h(Form.Hint, null, says(c.split)) : null,
    c.total
      ? [
        chart(c.daily),
        h(
          Report.Tops,
          null,
          column('Pages', c.pages),
          column('Came from', c.from),
          column('Countries', c.countries),
        ),
      ]
      : null,
  )

/** The Visits page: its tabs, then each of `apps` with its views in
 * `counts`, an app not yet counted left out until it is; one sentence where
 * the platform cannot count (`counts` null). */
export let visitsView = (
  view: VisitsView,
  apps: MarkedApp[],
  counts: Map<string, Counted> | null,
) =>
  !apps.length
    ? empty(
      'No visits yet',
      h('p', null, 'Your app visits will appear here once you have an app.'),
    )
    : counts == null
    ? h(Form.Hint, null, NOT_ON)
    : [
      botTabs(!!view.bots, botsAt),
      ...apps.flatMap((a) => {
        let c = counts.get(a.eid)
        return c ? [appVisits(a, c, view.site)] : []
      }),
    ]
