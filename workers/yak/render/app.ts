// The app library's Tile: the worker owns its markup, and each host supplies h.
// Gallery wording is page context because its visibility depends on the viewer,
// and so is `at`, the space's own address, on a page that is not there, and
// `errors`, the count of open ones its owner's dashboard marks.
//
// The title is the tile's link, stretched over the whole card, so the error
// mark can be a link of its own: to where the dashboard says what broke.

import { parse } from '@yaks/query'
import type { Renderer } from '@yaks/render'

export let app: Renderer = {
  view: 'Tile',
  match: parse('.app'),
  render: (b, h, ctx) => {
    let a = b.app as { slug: string; access?: string | null }
    let doc = b.doc as { title?: string } | undefined
    let errors = Number(ctx.errors ?? 0)
    let tag = (text: string) => h('span', { class: 'Apps_Tag' }, text)
    return h(
      'div',
      { class: 'Apps_Item' },
      '\n',
      h('img', {
        src: `${ctx.at ?? ''}/${a.slug}/icon.png`,
        width: 44,
        height: 44,
        alt: '',
      }),
      '\n',
      h(
        'a',
        {
          class: 'Apps_Open',
          href: `${ctx.at ?? ''}/${a.slug}/`,
          target: '_blank',
          rel: 'noopener',
        },
        h('strong', null, doc?.title || a.slug),
      ),
      h('span', { class: 'Apps_Path' }, `/${a.slug}`),
      '\n',
      h(
        'span',
        { class: 'Apps_Tags' },
        errors
          ? h(
            'a',
            { class: 'Apps_Tag Apps_Tag-warn', href: `#fix-${a.slug}` },
            `${errors} ${errors == 1 ? 'error' : 'errors'}`,
          )
          : null,
        b.home ? tag('Homepage') : null,
        a.access ? tag(a.access) : null,
        ctx.gallery ? tag(String(ctx.gallery)) : null,
      ),
    )
  },
}
