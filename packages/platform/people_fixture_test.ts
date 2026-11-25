// A space's People page as the server draws it, and the rows it is drawn
// from, for the view's and the browser's tests.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import type { Bundle } from '@yaks/graph'
import {
  type Admitted,
  admittedRows,
  type Holder,
  holderRows,
  invitableRows,
} from './people-rows.ts'
import {
  peopleLines,
  peopleRows,
  type PeopleView,
  peopleView,
  type Watched,
} from './people-view.ts'
import { appRows, spaceRows } from './side-rows.ts'

export let ADA = 'person-ada'
export let SPACE = { eid: 'space-gift', slug: 'gift' }
export let view: PeopleView = { person: ADA, space: SPACE }
export let DIARY = { eid: 'app-diary', slug: 'diary', title: 'Diary' }

/** One place held: `who` in the space, or with `on`, in that app. */
export let holder = (
  who: string,
  role: Holder['role'],
  held: Holder['held'] = 'seat',
  on = SPACE.eid,
): Holder => ({
  place: `${held}-${who}-${on}`,
  held,
  on,
  person: `person-${who}`,
  name: who,
  email: `${who}@example.com`,
  role,
  sent: held == 'invite' ? '2026-10-14T09:00:00Z' : null,
})

/** Ada's own seat, then whoever else `more` names. */
export let roster = (...more: Holder[]) => [holder('ada', 'owner'), ...more]

/** What the page watches, by its lines, from what the test names. */
export let watched = (
  at: {
    holders?: Holder[]
    admitted?: Admitted[]
    friends?: string[]
    spaces?: { eid: string; slug: string; title: string }[]
  } = {},
): Watched => ({
  holders: holderRows(ADA, SPACE.eid, at.holders ?? roster()),
  admitted: admittedRows(ADA, SPACE.eid, at.admitted ?? []),
  apps: appRows(ADA, SPACE.eid, [{ ...DIARY, source: null }]),
  spaces: spaceRows(
    ADA,
    (at.spaces ?? [{ ...SPACE, title: 'Gift shop' }]).map((s) => ({
      ...s,
      owner: true,
      own: s.eid == SPACE.eid,
    })),
  ),
  friends: invitableRows(
    ADA,
    (at.friends ?? []).map((name) => ({ person: `person-${name}`, name })),
  ),
})

/** Each line the page watches, with its rows. */
export let byLine = (rows: Watched): [string, Bundle[]][] =>
  Object.entries(peopleLines(view)).map(([name, line]) => [
    line,
    rows[name as keyof Watched],
  ])

/** The page as the server draws it from `rows`. */
export let page = (rows: Watched = watched()) => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'people', 'data-people-view': JSON.stringify(view) },
      peopleView(view, peopleRows(view, rows)),
    ),
  )
  let { document, window } = parseHTML(`<html><body>${html}</body></html>`)
  return {
    document,
    window,
    root: document.querySelector<HTMLElement>('[data-view]')!,
  }
}
