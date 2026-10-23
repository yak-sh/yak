// How a tool reads, in every interface: a registered tool (`tool{name,
// description}`) by what callers call it and the first line of what it does,
// so a list holding one (a persona that contains it, to offer it) says which
// tool it is; and the `content{body}` a tool answers for a person, shown as it
// was written, line for line. A portable
// @yaks/render renderer, so `yak` prints it (@yaks/text) and a browser or a
// terminal app mounts it (@yaks/preact); which one draws it is the caller's
// `h`.
//
// The body goes out as preformatted lines with an explicit break between each,
// because a text backend drops the control bytes of every literal, newlines
// included: a break is structure, and structure is what survives.

import { parse } from '@yaks/query/core'
import { define, type H, type Registry, type RenderContext } from '@yaks/render'

let lines = <Node>(b: Record<string, unknown>, h: H<Node>): Node => {
  let body = (b.content as { body?: unknown } | undefined)?.body
  return h(
    'pre',
    null,
    String(body).split('\n').flatMap((line, i) =>
      i ? [h('br', null), line] : [line]
    ),
  )
}

let said = parse('.content.body')

let named = (b: Record<string, unknown>, prop: string): string => {
  let v = (b.tool as Record<string, unknown> | undefined)?.[prop]
  return typeof v == 'string' ? v : ''
}

// A tool in a list: what callers call it, what it does in a line, and where it
// opens, as the kit lays a tile out (packages/ui/Tile.ts).
let tile = <Node>(
  b: Record<string, unknown> & { entity: { eid: string } },
  h: H<Node>,
  ctx: RenderContext<Node>,
): Node => {
  let link = (ctx as { link?: (eid: string) => string | undefined }).link
  let does = named(b, 'description').split('\n').find((l) => l.trim()) ?? ''
  return h(
    'a',
    {
      class: 'Tile',
      href: link?.(b.entity.eid),
      'data-tool': named(b, 'name'),
    },
    h(
      'span',
      { class: 'Tile_Text' },
      h(
        'span',
        { class: 'Tile_Line' },
        h('span', { class: 'Tile_Kind' }, 'tool'),
        ' ',
        h('span', { class: 'Tile_Title' }, named(b, 'name')),
      ),
      does ? [' ', h('span', { class: 'Tile_Sub' }, does)] : null,
    ),
  )
}

let tool = parse('.tool.name')

/** `Title`, `Tile` and `List.Tile` for a registered tool; `Tile` and `Page`
 * for an entity that carries a tool's text. */
export let views: Registry = define([
  {
    view: 'Title',
    match: tool,
    render: (b, h) => h('span', null, named(b, 'name')),
  },
  { view: 'Tile', match: tool, render: tile },
  { view: 'List.Tile', match: tool, render: tile },
  { view: 'Tile', match: said, render: lines },
  { view: 'Page', match: said, render: lines },
])
