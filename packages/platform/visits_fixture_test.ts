import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { appRows } from './side-rows.ts'
import { type Counted, countRows } from './visit-counts.ts'
import { type VisitsView, visitsView } from './visits-view.ts'
import type { MarkedApp } from './routes.ts'

export let ADA = 'a1d0c6e8-0000-4000-8000-000000000001'
export let SPACE = 'a1d0c6e8-0000-4000-8000-0000000000a5'
export let RECIPES: MarkedApp = {
  eid: 'recipes',
  slug: 'recipes',
  title: 'Recipes',
}
export let VIEW: VisitsView = {
  person: ADA,
  space: SPACE,
  site: 'https://adas.yaks.test',
}

/** Nine visits over three days, one of them empty. */
export let NINE: Counted = {
  days: 3,
  bots: false,
  total: 9,
  split: { people: 9, bots: 40, verified: 2 },
  daily: [
    { day: '2026-09-04', views: 2 },
    { day: '2026-09-05', views: 0 },
    { day: '2026-09-06', views: 7 },
  ],
  pages: [{ name: '/dinner', views: 6 }],
  from: [{ name: 'news.example.com', views: 4 }],
  countries: [{ name: 'US', views: 9 }],
}

export let NONE: Counted = {
  days: 3,
  bots: false,
  total: 0,
  split: { people: 0, bots: 0, verified: 0 },
  daily: [],
  pages: [],
  from: [],
  countries: [],
}

/** The space's apps and their views as the page graph holds them; counts
 * null where the platform cannot count. */
export let rows = (
  apps: MarkedApp[] = [RECIPES],
  counts: Map<string, Counted> | null = new Map([[RECIPES.eid, NINE]]),
) => ({ apps: appRows(ADA, SPACE, apps), counts: countRows(SPACE, counts) })

/** The Visits page drawn from `apps` and `counts`, as a server draws it. */
export let page = (
  apps: MarkedApp[] = [RECIPES],
  counts: Map<string, Counted> | null = new Map([[RECIPES.eid, NINE]]),
): HTMLElement => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'visits', 'data-visits-view': JSON.stringify(VIEW) },
      visitsView(VIEW, apps, counts),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document.querySelector<HTMLElement>('[data-view]')!
}
