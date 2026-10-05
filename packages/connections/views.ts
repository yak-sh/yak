// A connection's public face, shared by browser and terminal: its integration,
// account and status, followed by the apps whose uses links the host holds.
import { parse } from '@yaks/query'
import { define, type H, type Registry, type RenderContext } from '@yaks/render'
import type { Shown } from '@yaks/render/views'
import { integrationEid } from './integrations.ts'
import type { Bundle } from '@yaks/render'

type Connection = { integration: string; account?: string; status: string }
let connection = (b: Bundle) => b.connection as Connection
let needs = (b: Bundle) => [integrationEid(connection(b).integration)]
let match = parse('.connection .connection.integration .connection.status')

let title = <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = ctx as RenderContext<Node> & Shown<Node>
  let c = connection(b)
  let integration = s.get?.(integrationEid(c.integration))?.integration as
    | { title?: string }
    | undefined
  return h(
    'span',
    null,
    [integration?.title || c.integration, c.account, c.status]
      .filter(Boolean).join(' · '),
  )
}

let using = <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = ctx as RenderContext<Node> & Shown<Node>
  let apps = s.related?.(b.entity.eid, 'uses') ?? []
  return h(
    'span',
    null,
    apps.length ? ' · used by ' : '',
    apps.map((app, i) => [
      i ? ', ' : '',
      s.show(app, 'Title') ?? s.name(app.entity.eid),
    ]),
  )
}

let page = <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node =>
  h(
    'article',
    { class: 'Page' },
    h('h1', { class: 'Page_Title' }, ctx.render?.('Title'), using(b, h, ctx)),
  )

let uses = <Node>(b: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = ctx as RenderContext<Node> & Shown<Node>
  let edge = b.edge as { from: string; to: string }
  let name = (eid: string) => {
    let held = s.get?.(eid)
    return held ? s.show(held, 'Title') ?? s.name(eid) : s.name(eid)
  }
  return h('span', null, name(edge.from), ' uses ', name(edge.to))
}

/** Connections draw by their public fields, even when they also wear secret. */
export let views: Registry = define([
  { view: 'Title', match, needs, render: title },
  { view: 'Card.Title', match, needs, render: title },
  {
    view: 'Tile',
    match,
    needs,
    render: (b, h, ctx) =>
      h(
        'a',
        {
          class: 'Tile',
          href: (ctx as Shown<unknown>).link?.(b.entity.eid),
        },
        h(
          'span',
          { class: 'Tile_Title' },
          ctx.render?.('Title'),
          using(b, h, ctx),
        ),
      ),
  },
  { view: 'Page', match, needs, render: page },
  { view: 'Full', match, needs, render: page },
  {
    view: 'Tile',
    match: parse('.uses .edge'),
    render: uses,
  },
])
