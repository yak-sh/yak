/**
 * The routes facet, exported as `@yaks/ui/routes`: `/ui` answers the style
 * guide (guide.ts) as one static page, the kit's stylesheet inline, in the
 * theme its `theme` names and the colour scheme its `scheme` names (`light`,
 * `dark`, or the system's). The page is `Panes`: beside the guide, a nav of
 * the guide's contents to jump to, under the switchers for each choice, so
 * every part is seen in every theme. The parts have no behaviour, so the
 * page needs no script.
 *
 * @module
 */

import type { Route } from '@yaks/api'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Contents, Guide, title } from './guide.ts'
import { stylesheet, themes } from './kit.ts'
import { Pairs } from './Pairs.ts'
import { Panes } from './Panes.ts'
import { Tabs } from './Tabs.ts'

// The colour schemes the page can be seen in: the system's, or one forced.
let schemes = ['system', 'light', 'dark']
let first: string = Object.keys(themes)[0]

let at = (theme: string, scheme: string) =>
  `?${new URLSearchParams({ theme, scheme })}`

// A row of tabs for each choice, the one showing on, each a link to the page
// with that one changed.
let tabs = (all: string[], on: string, href: (pick: string) => string) =>
  h(
    Tabs,
    {},
    all.map((pick) =>
      h(
        Tabs.Tab,
        { key: pick, href: href(pick), mod: pick == on && 'on' },
        pick,
      )
    ),
  )

/** The switchers: which theme, and which scheme. */
let Switch = ({ theme, scheme }: { theme: string; scheme: string }) =>
  h(
    Pairs,
    {},
    h(Pairs.Key, {}, 'theme'),
    h(Pairs.Value, {}, tabs(Object.keys(themes), theme, (t) => at(t, scheme))),
    h(Pairs.Key, {}, 'scheme'),
    h(Pairs.Value, {}, tabs(schemes, scheme, (s) => at(theme, s))),
  )

/** The guide beside its contents, the switchers over them. */
let Shell = ({ theme, scheme }: { theme: string; scheme: string }) =>
  h(
    Panes,
    {},
    h(
      Panes.Pane,
      { mod: 'nav' },
      h(Panes.Top, {}, h(Switch, { theme, scheme })),
      h(
        Panes.Body,
        {},
        h(Contents, { entry: (stop: string) => ({ href: `#${stop}` }) }),
      ),
    ),
    h(Panes.Pane, { mod: 'main' }, h(Panes.Body, {}, h(Guide, null))),
  )

/** The style guide's page, dressed in the theme named `theme` (the first,
 * unless one by that name is kept), in `scheme`. */
export let page = async (
  theme = first,
  scheme = 'system',
): Promise<string> => {
  let t = themes[theme] ? theme : first
  let s = schemes.includes(scheme) ? scheme : 'system'
  let forced = s == 'system' ? '' : ` style="color-scheme: ${s}"`
  return `<!doctype html><html${forced}><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${title}</title>` +
    `<style>${await stylesheet(themes[t])}</style></head>` +
    `<body>${renderToString(h(Shell, { theme: t, scheme: s }))}</body></html>`
}

/** `GET /ui`: the style guide, `?theme=` and `?scheme=` picking its look. */
export let routes = (): Route[] => [{
  method: 'GET',
  path: '/ui',
  handle: async (req) => {
    let q = new URL(req.url).searchParams
    return new Response(
      await page(q.get('theme') ?? undefined, q.get('scheme') ?? undefined),
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  },
}]
