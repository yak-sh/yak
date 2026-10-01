/** The static guide composes the installed ./ui facets. Query links select
 * theme, skin and colour scheme without loading any client script. */
import type { Route } from '@yaks/api'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Contents, Guide, title } from './guide.ts'
import { kits, skins, stylesheet, themes } from './kit.ts'
import { Pairs } from './Pairs.ts'
import { Panes } from './Panes.ts'
import { Tabs } from './Tabs.ts'
import type { Composition, Contributions } from './theme.ts'

let schemes = ['system', 'light', 'dark']
let base: Contributions = { kits, themes, skins }
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

/** The guide's page, using contributions gathered by the page's host. */
export let page = async (
  theme = Object.keys(themes)[0],
  scheme = 'system',
  skin = 'base',
  contributed: Contributions = base,
): Promise<string> => {
  let available = {
    kits: { ...kits, ...contributed.kits },
    themes: { ...themes, ...contributed.themes },
    skins: { ...skins, ...contributed.skins },
    ux: contributed.ux,
  }
  let allThemes = available.themes ?? themes
  let allSkins = available.skins ?? skins
  let t = allThemes[theme] ? theme : Object.keys(allThemes)[0]
  let s = schemes.includes(scheme) ? scheme : 'system'
  let k = allSkins[skin] ? skin : 'base'
  let c: Composition = {
    kits: available.kits ?? kits,
    ux: available.ux,
    theme: allThemes[t],
    skin: allSkins[k],
  }
  let at = (theme: string, scheme: string, skin: string) =>
    `?${new URLSearchParams({
      theme,
      scheme,
      ...(skin != 'base' && { skin }),
    })}`
  let switches = h(
    Pairs,
    {},
    h(Pairs.Key, {}, 'theme'),
    h(
      Pairs.Value,
      {},
      tabs(Object.keys(allThemes), t, (pick) => at(pick, s, k)),
    ),
    h(Pairs.Key, {}, 'scheme'),
    h(Pairs.Value, {}, tabs(schemes, s, (pick) => at(t, pick, k))),
    h(Pairs.Key, {}, 'skin'),
    h(
      Pairs.Value,
      {},
      tabs(['base', ...Object.keys(allSkins)], k, (pick) => at(t, s, pick)),
    ),
  )
  let shell = h(
    Panes,
    {},
    h(
      Panes.Pane,
      { mod: 'nav' },
      h(Panes.Top, {}, switches),
      h(
        Panes.Body,
        {},
        h(Contents, {
          composition: c,
          entry: (stop: string) => ({ href: `#${stop}` }),
        }),
      ),
    ),
    h(
      Panes.Pane,
      { mod: 'main' },
      h(Panes.Body, {}, h(Guide, { composition: c })),
    ),
  )
  let forced = s == 'system' ? '' : ` style="color-scheme: ${s}"`
  return `<!doctype html><html${forced}><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${title}</title><style>${await stylesheet(c)}</style></head>` +
    `<body>${renderToString(shell)}</body></html>`
}

/** A host passes its gathered facets; a standalone guide shows the base. */
export let routes = (host?: { ui: Contributions }): Route[] => [{
  method: 'GET',
  path: '/ui',
  handle: async (req) => {
    let q = new URL(req.url).searchParams
    return new Response(
      await page(
        q.get('theme') ?? undefined,
        q.get('scheme') ?? undefined,
        q.get('skin') ?? undefined,
        host?.ui,
      ),
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  },
}]
