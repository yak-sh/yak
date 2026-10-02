// A secret's public face is its config key and optional human title, never
// its value (not even the vault handle). Shared by browser and terminal lists.
import { parse } from '@yaks/query'
import { define, type Registry } from '@yaks/render'

export let views: Registry = define([
  {
    view: 'Title',
    match: parse('.secret'),
    render: (b, h) =>
      h('span', null, (b.secret as { name?: string }).name ?? ''),
  },
  {
    view: 'Title',
    match: parse('.secret .doc.title'),
    render: (b, h) =>
      h(
        'span',
        null,
        (b.doc as { title?: string }).title,
        ' · ',
        (b.secret as { name?: string }).name ?? '',
      ),
  },
  {
    view: 'Tile',
    match: parse('.secret'),
    render: (b, h, ctx) =>
      h('a', {
        class: 'Tile',
        href: `/${b.entity.eid}`,
      }, h('span', { class: 'Tile_Title' }, ctx.render?.('Title'))),
  },
])
