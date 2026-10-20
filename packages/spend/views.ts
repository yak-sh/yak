/**
 * How a day's tally reads wherever one is drawn by name: its title, a row in
 * a list, a link. Portable renderers through the host's hyperscript, so a
 * terminal lists the days a browser does. The page that ranks a span's
 * tally, and a day's own page, are ./page.ts; the sidebar offers the page as
 * `Spend`, over the list of days.
 *
 * @module
 */
import { define, type H, type Registry, type RenderContext } from '@yaks/render'
import { parse } from '@yaks/query/core'
import type { Bundle } from '@yaks/graph'
import type { View } from '@yaks/inspect'
import type { Shown } from '@yaks/render/views'
import Coins from 'lucide/dist/esm/icons/coins.mjs'
import { ranked, type Spend, spendOf } from './tally.ts'
import { dollars, tokens } from './words.ts'

type Ctx<Node> = RenderContext<Node> & Partial<Shown<Node>>

let title = (s?: Spend) => s ? `Spend on ${s.day}` : 'Spend'

/// facts({ day: '2026-10-20', requests: 3, dollars: 1.5, tokens: [9e6, 0, 1e6, 0], parts: { skills: [9e6, 0, 0, 0, 1], input: [0, 0, 1e6, 0, 0.5] }, sessions: {}, tasks: {}, models: {}, entries: {} })
///   -> ['$1.50', '3 requests', '10M tokens', 'most on skills']
/** What a day's row says in a line. */
export let facts = (s: Spend): string[] => {
  let [top] = ranked(s.parts, 4)
  return [
    dollars(s.dollars),
    `${s.requests.toLocaleString('en-US')} requests`,
    `${tokens(s.tokens.reduce((a, b) => a + b, 0))} tokens`,
    ...top ? [`most on ${top[0]}`] : [],
  ]
}

let tile = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>) => {
  let s = spendOf(e)
  return h(
    'a',
    { class: 'Tile', href: (ctx as Ctx<Node>).link?.(e.entity.eid) },
    h(
      'span',
      { class: 'Tile_Text' },
      h(
        'span',
        { class: 'Tile_Line' },
        h('span', { class: 'Tile_Title' }, s?.day ?? ''),
      ),
      ' ',
      h('span', { class: 'Tile_Sub' }, s ? facts(s).join(' · ') : ''),
    ),
  )
}

/** Draws a day's tally by name. */
export let views: Registry = define([
  {
    view: 'Title',
    match: parse('.spend'),
    render: (e, h) => h('span', null, title(spendOf(e))),
  },
  ...['Tile', 'List.Tile'].map((view) => ({
    view,
    match: parse('.spend'),
    render: tile,
  })),
  {
    view: 'Inline',
    match: parse('.spend'),
    render: <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>) =>
      h(
        'a',
        { href: (ctx as Ctx<Node>).link?.(e.entity.eid) },
        title(spendOf(e)),
      ),
  },
])

/** The page and a day's page, loaded when first drawn. */
export let inspectViews = (): Promise<View[]> =>
  import('./page.ts').then((m) => m.inspectViews)

/** The page the sidebar offers: where the tokens went, over the days. */
export let destinations = [
  {
    key: 'spend',
    name: 'Spend',
    icon: 'coins',
    query: '.spend * .order=-spend.day',
    view: 'Spend.Page',
  },
]

/** The glyph it wears there. */
export let icons = { coins: Coins }
