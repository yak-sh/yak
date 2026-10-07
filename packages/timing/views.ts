/** How a trace and a span read wherever one is drawn by name: its title, a
 * row in a list, a link, a card's bar, and a span's page. Portable renderers
 * through the host's hyperscript, so a terminal lists the rows a browser
 * does. A trace's page, which reads its spans, is ./inspect.ts.
 * @module
 */
import { define, type H, type Registry, type RenderContext } from '@yaks/render'
import { parse } from '@yaks/query'
import type { Bundle } from '@yaks/graph'
import type { Shown } from '@yaks/render/views'
import { amount, axes, comp, hue, metric, number, str } from './readings.ts'

type Ctx<Node> = RenderContext<Node> & Partial<Shown<Node>>
let shown = <Node>(ctx: RenderContext<Node>) => ctx as Ctx<Node>
let when = <Node>(s: Ctx<Node>, at: unknown) => s.when?.(str(at)) ?? str(at)

// What is there, a dot between each.
let dotted = <T>(parts: (T | string | null | undefined)[]): (T | string)[] =>
  parts.filter((p): p is T | string => !!p)
    .flatMap((p, i) => i ? [' · ', p] : [p])

// A tile as the kit lays one out (packages/ui/Tile.ts): the title line over
// a sub.
let tile = <Node>(
  h: H<Node>,
  href: string | undefined,
  line: (Node | string | null)[],
  sub: (Node | string | null | undefined)[],
): Node =>
  h(
    href ? 'a' : 'div',
    { class: 'Tile', href },
    h(
      'span',
      { class: 'Tile_Text' },
      h('span', { class: 'Tile_Line' }, ...line),
      sub.some(Boolean)
        ? [' ', h('span', { class: 'Tile_Sub' }, ...dotted(sub))]
        : null,
    ),
  )

let named = (b: Bundle) => {
  let t = comp(b, 'trace')
  return str(t.name) || str(t.op)
}

// The store a trace ran against, by name where the host holds it.
let store = <Node>(e: Bundle, s: Ctx<Node>): string => {
  let d = comp(e, 'during'), eid = str(d.entity)
  if (!eid) return ''
  let held = s.get?.(eid)
  return held ? `store ${s.name?.(eid) ?? eid}` : ''
}

let traceTile = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>) => {
  let s = shown(ctx), t = comp(e, 'trace')
  return tile(h, s.link?.(e.entity.eid), [
    h('span', { class: 'Tile_Id' }, s.id?.(e) ?? ''),
    ' ',
    h('span', { class: 'Tile_Title' }, named(e)),
    ' ',
    h('span', { class: 'Tile_Kind' }, str(t.op)),
  ], ['box', when(s, t.at), store(e, s), str(comp(e, 'during').kind)])
}

/// measured({entity: {eid: 's'}, span: {op: 'rule', name: 'r'}, elapsed: {ms: 1.5}, rows_read: {n: 1450}})
///   -> ['1,450 rows read', '1.5 ms']
/** What a span measured, on each axis it recorded. */
export let measured = (e: Bundle): string[] =>
  axes.filter((a) => e[a]).map((a) => amount(a, metric(e, a)))

let spanName = (e: Bundle) => {
  let c = comp(e, 'span')
  return `${str(c.op)} ${str(c.name)}`.trim()
}

let spanTile = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>) => {
  let s = shown(ctx), c = comp(e, 'span')
  return tile(h, s.link?.(e.entity.eid), [
    h('span', { class: `Chip Chip-${hue(str(c.op))}` }, str(c.op)),
    ' ',
    h('span', { class: 'Tile_Title' }, str(c.name)),
    ' ',
    c.outcome == 'error' ? h('span', { class: 'Tile_Kind' }, 'failed') : null,
  ], [str(c.plugin), ...measured(e)])
}

// A span on a page of its own: what ran, where in the code, what it measured
// and the trace it is part of.
let spanPage = <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>) => {
  let s = shown(ctx), c = comp(e, 'span'), trace = str(c.trace)
  let held = trace ? s.get?.(trace) : undefined
  let start = number(comp(e, 'elapsed').start)
  return h(
    'article',
    null,
    h(
      'header',
      { class: 'Head' },
      h(
        'h1',
        { class: 'Head_Title' },
        str(c.name),
        ' ',
        h('span', { class: 'Head_Id' }, s.id?.(e) ?? ''),
        ' ',
        h('span', { class: 'Head_Kind' }, str(c.op)),
      ),
      h(
        'p',
        { class: 'Head_Sub' },
        ...dotted([
          c.plugin ? `in ${str(c.plugin)}` : '',
          str(c.package),
          c.outcome == 'error' ? 'failed' : '',
        ]),
      ),
      h(
        'p',
        { class: 'Head_Facts' },
        ...dotted([
          ...measured(e),
          start != null ? `began ${start} ms in` : '',
        ]),
      ),
    ),
    trace
      ? h(
        'p',
        null,
        'Part of ',
        h(
          'a',
          { href: s.link?.(trace) },
          held ? `${s.id?.(held) ?? ''} ${named(held)}`.trim() : 'its trace',
        ),
        '.',
      )
      : null,
  )
}

/** Draws a trace or a span by name. */
export let views: Registry = define([
  {
    view: 'Title',
    match: parse('.trace'),
    render: (e, h) => h('span', null, named(e)),
  },
  {
    view: 'Title',
    match: parse('.span'),
    render: (e, h) => h('span', null, spanName(e)),
  },
  ...['Tile', 'List.Tile'].flatMap((view) => [
    { view, match: parse('.trace'), render: traceTile },
    { view, match: parse('.span'), render: spanTile },
  ]),
  ...['.trace', '.span'].flatMap((q) => [
    {
      view: 'Card.Title',
      match: parse(q),
      render: <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>) =>
        h(
          'span',
          { class: 'CardTitle' },
          ctx.render?.('Id') ??
            h('span', { class: 'Id' }, shown(ctx).id?.(e) ?? ''),
          ' ',
          h(
            'span',
            { class: 'CardTitle_Text' },
            e.trace ? named(e) : spanName(e),
          ),
        ),
    },
    {
      view: 'Inline',
      match: parse(q),
      render: <Node>(e: Bundle, h: H<Node>, ctx: RenderContext<Node>) =>
        h(
          'a',
          { href: shown(ctx).link?.(e.entity.eid) },
          e.trace ? named(e) : spanName(e),
        ),
    },
  ]),
  { view: 'Page', match: parse('.span'), render: spanPage },
])

export { inspectViews } from './inspect.ts'

/** The page a browsing app's sidebar offers: every trace, newest first. */
export let destinations = [
  {
    key: 'traces',
    name: 'Traces',
    icon: 'activity',
    query: '.trace * .order=-trace.at',
  },
]
