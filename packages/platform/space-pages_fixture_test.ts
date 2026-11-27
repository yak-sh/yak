import type { Bundle } from '@yaks/graph'
import { renderToStaticMarkup as renderToString } from 'react-dom/server'
import { createElement as h } from 'react'
import { parseHTML } from 'linkedom'
import type { Domain } from './domain-pages.ts'
import { appRows, sideApps } from './side-rows.ts'
import {
  type Binned,
  binnedRows,
  domainRows,
  settingsRow,
  spaceDomains,
  type SpaceSettings,
  spaceSettings,
  spaceTrash,
} from './space-pages.ts'
import {
  type Held,
  heldRows,
  type SpacePage,
  spacePageView,
  type SpaceView,
} from './space-pages-view.ts'

export let SPACE = 'space-ada'
export let ADA = 'person-ada'

/** Ada's space's `page`, as the server says it beside the rows. */
export let spaceView = (
  page: SpacePage = 'settings',
  over: Partial<SpaceView> = {},
): SpaceView => ({
  person: ADA,
  space: SPACE,
  page,
  apex: 'yaks.app',
  checkout: true,
  ...over,
})

/** Ada's space's settings. */
export let settings = (over: Partial<SpaceSettings> = {}): SpaceSettings => ({
  slug: 'ada',
  title: 'Ada',
  home: '',
  byline: false,
  paying: true,
  included: true,
  ...over,
})

/** A domain the space holds, pointed at nothing. */
export let domain = (over: Partial<Domain> = {}): Domain => ({
  name: 'ada.test',
  destination: '',
  canPoint: true,
  canTransfer: true,
  ...over,
})

/** The rows a page is drawn from, by line. */
export let held = (
  {
    s = settings(),
    apps = [] as { eid: string; slug: string; title: string }[],
    domains = [] as Domain[],
    binned = [] as Binned[],
  } = {},
): Held => ({
  settings: [settingsRow(SPACE, s)],
  apps: appRows(ADA, SPACE, apps),
  page: [...domainRows(SPACE, domains), ...binnedRows(SPACE, binned)],
})

/** Each line's rows in a page graph, from `rows`. */
export let lines = (rows: Held): [string, Bundle[]][] => [
  [spaceSettings(SPACE), rows.settings],
  [sideApps(SPACE), rows.apps],
  [spaceDomains(SPACE), (rows.page ?? []).filter((r) => r.ownedDomain)],
  [spaceTrash(SPACE), (rows.page ?? []).filter((r) => r.binned)],
]

/** The page `view` drawn from `rows` as a server draws it. */
export let page = (view = spaceView(), rows = held()): HTMLElement => {
  let html = renderToString(
    h(
      'div',
      { 'data-view': 'space-page', 'data-space-view': JSON.stringify(view) },
      spacePageView(view, heldRows(view, rows)!),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document.querySelector<HTMLElement>('[data-view]')!
}
