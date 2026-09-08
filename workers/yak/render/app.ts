// The app library's Tile: the worker owns its markup, and each host supplies h.
// Gallery wording is page context because its visibility depends on the viewer.

import { parse } from '@yaks/query'
import type { Renderer } from '@yaks/render'

export let app: Renderer = {
  view: 'Tile',
  match: parse('.app'),
  render: (b, h, ctx) => {
    let a = b.app as { slug: string; access?: string | null }
    let doc = b.doc as { title?: string } | undefined
    let tag = (text: string) => h('span', { class: 'Apps_Tag' }, text)
    return h(
      'a',
      {
        class: 'Apps_Item',
        href: `/${a.slug}/`,
        target: '_blank',
        rel: 'noopener',
      },
      '\n',
      h('img', { src: `/${a.slug}/icon.png`, width: 44, height: 44, alt: '' }),
      '\n',
      h('strong', null, doc?.title || a.slug),
      h('span', { class: 'Apps_Path' }, `/${a.slug}`),
      '\n',
      h(
        'span',
        { class: 'Apps_Tags' },
        b.home ? tag('Homepage') : null,
        a.access ? tag(a.access) : null,
        ctx.gallery ? tag(String(ctx.gallery)) : null,
      ),
    )
  },
}
