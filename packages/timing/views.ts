/** Portable trace and span readings. Query-backed pages are supplied through
 * the existing inspector views contract, in this same domain facet. */
import { define, type H, type Registry, type RenderContext } from '@yaks/render'
import { parse } from '@yaks/query'
import type { Bundle } from '@yaks/graph'
import type { Shown } from '@yaks/render/views'
import {
  comp,
  format,
  labels,
  metric,
  metrics,
  number,
  str,
} from './readings.ts'
type Context<Node> = RenderContext<Node> & Partial<Shown<Node>>
let span = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = ctx as Context<Node>, code = comp(e, 'span')
  return h(
    'div',
    { class: 'Tile' },
    h('span', { class: 'Tile_Title' }, `${str(code.op)} · ${str(code.name)}`),
    h(
      'span',
      { class: 'Tile_Sub' },
      [code.plugin, code.package, code.outcome].filter(Boolean).join(' · '),
    ),
    h(
      'span',
      { class: 'Tile_Note' },
      metrics.filter((n) => e[n]).map((n) =>
        `${format(metric(e, n))} ${labels[n]}`
      ).join(' · '),
    ),
    e.elapsed
      ? h(
        'span',
        { class: 'Tile_Note' },
        `start +${format(number(comp(e, 'elapsed').start))} ms`,
      )
      : null,
    s.link ? h('a', { href: s.link(str(code.trace)) }, 'Trace') : null,
  )
}
let trace = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>): Node => {
  let s = ctx as Context<Node>, t = comp(e, 'trace'), d = comp(e, 'during')
  return h(
    'a',
    { class: 'Tile', href: s.link?.(e.entity.eid) ?? `/${e.entity.eid}` },
    h('span', { class: 'Tile_Title' }, `${str(t.op)} · ${str(t.name)}`),
    h(
      'span',
      { class: 'Tile_Sub' },
      ['space', 'entity', 'app', 'kind', 'process'].filter((k) => d[k]).map(
        (k) =>
          `${k == 'entity' ? 'store' : k} ${s.name?.(str(d[k])) ?? str(d[k])}`,
      ).join(' · '),
    ),
    h('span', { class: 'Tile_Note' }, s.when?.(str(t.at)) ?? str(t.at)),
  )
}
export let views: Registry = define([
  ...['Tile', 'List.Tile', 'Inline', 'Timing.Trace.Tile'].map((view) => ({
    view,
    match: parse('.trace'),
    render: trace,
  })),
  ...['Tile', 'List.Tile', 'Full', 'Page', 'Timing.Span'].map((view) => ({
    view,
    match: parse('.span'),
    render: span,
  })),
])
export { inspectViews } from './inspect.ts'
