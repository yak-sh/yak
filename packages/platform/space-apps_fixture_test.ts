import type { Bundle } from '@yaks/graph'
import { renderToString } from 'preact-render-to-string'
import { createElement as h } from 'react'
import { parseHTML } from 'linkedom'
import { type AppsView, appsView } from './space-apps-view.ts'
import { AGENTS, agentsOf, agentsRow } from './agents.ts'
import {
  brokenApps,
  brokenRows,
  type Listed,
  listedOf,
  listedRows,
  type Plain,
  spaceApps,
} from './space-apps.ts'

export let SPACE = 'space-ada'
export let ADA = 'person-ada'

/** Ada's space's Apps page, as the server says it beside the rows. */
export let appsAt = (over: Partial<AppsView> = {}): AppsView => ({
  person: ADA,
  space: { eid: SPACE, slug: 'ada' },
  host: 'ada.yaks.app',
  agent: 'https://yaks.app/agent',
  sift: { q: '', sort: '' },
  ...over,
})

// Ten apps, each a day newer than the one before, named out of order.
export let NAMES = [
  'Kite',
  'Ark',
  'Jam',
  'Bee',
  'Ivy',
  'Cod',
  'Hut',
  'Dew',
  'Gem',
  'Elm',
]

/** The first `n` of them, each made by Ada. */
export let apps = (n: number): Listed[] =>
  NAMES.slice(0, n).map((title, i) => ({
    eid: `a${i}`,
    slug: title.toLowerCase(),
    title,
    made: {
      at: `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      by: ADA,
    },
  }))

/** A break, as the dashboard says it. */
export let broke = (said: string): Plain => ({
  said,
  where: 'page /',
  times: 2,
  at: '2026-11-20T00:00:00Z',
  fix: `fix-${said}`,
})

/** Each line's rows in a page graph: the apps, what is broken in each, and
 * how many agents Ada connected, none until known. */
export let lines = (
  listed: Listed[],
  broken: Record<string, Plain[]> = {},
  agents?: number,
): [string, Bundle[]][] => [
  [spaceApps(SPACE), listedRows(ADA, SPACE, listed)],
  [brokenApps(SPACE), brokenRows(ADA, SPACE, new Map(Object.entries(broken)))],
  [
    AGENTS,
    agents == undefined ? [] : [
      agentsRow(
        ADA,
        Array.from({ length: agents }, (_, i) => ({
          id: `agent-${i}`,
          name: `Agent ${i}`,
        })),
      ),
    ],
  ],
]

/** The Apps view drawn from those rows as a server draws it. */
export let page = (
  view = appsAt(),
  ...rows: Parameters<typeof lines>
): HTMLElement => {
  let all = lines(...rows).flatMap(([, held]) => held)
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'apps', 'data-apps-view': JSON.stringify(view) },
      appsView(view, {
        apps: listedOf(all, SPACE, all),
        agents: agentsOf(all)?.length,
      }),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document.querySelector<HTMLElement>('[data-view]')!
}

/** The names of the apps `at` lists, in order. */
export let names = (at: HTMLElement) =>
  [...at.querySelectorAll('#apps > li .Rows_Open')].map((a) => a.textContent)
