// How a document reads, in every interface: its title is the line the entity
// is known by, and its body is markdown. Portable @yaks/render renderers, so
// the same two views print in a terminal (@yaks/text) and mount in a browser
// (@yaks/preact); which one draws them is the caller's `h`.
//
// An empty title is no title: a comment carries a `doc` for its body alone, and
// a view that answered with an empty string would hide the fallback a more
// general `Title` gives (the entity's id).

import { parse } from '@yaks/query'
import { define, type Registry } from '@yaks/render'
import { BODY, DOC, TITLE } from './comp.ts'

let text = (b: Record<string, unknown>, prop: string): string => {
  let v = (b[DOC] as Record<string, unknown> | undefined)?.[prop]
  return typeof v == 'string' ? v : ''
}

/** `Title` and `Body` for anything that carries a `doc`. */
export let views: Registry = define([
  {
    view: 'Title',
    match: parse(`.${DOC}.${TITLE}`),
    render: (b, h) => h('span', null, text(b, TITLE)),
  },
  {
    view: 'Body',
    match: parse(`.${DOC}.${BODY}`),
    load: () => import('./body.ts').then((m) => m.body),
  },
])
