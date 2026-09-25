// How a tool's text reads, in every interface: the `content{body}` a tool
// answers for a person is shown as it was written, line for line. A portable
// @yaks/render renderer, so `yak` prints it (@yaks/text) and a browser or a
// terminal app mounts it (@yaks/preact); which one draws it is the caller's
// `h`.
//
// The body goes out as preformatted lines with an explicit break between each,
// because a text backend drops the control bytes of every literal, newlines
// included: a break is structure, and structure is what survives.

import { parse } from '@yaks/query'
import { define, type H, type Registry } from '@yaks/render'

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

/** `Tile` and `Page` for an entity that carries a tool's text. */
export let views: Registry = define([
  { view: 'Tile', match: said, render: lines },
  { view: 'Page', match: said, render: lines },
])
