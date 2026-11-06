// The app library's Tile, the kit's Card worn as the library's item.
// Gallery wording is page context because its visibility depends on the viewer,
// and so is `at`, the space's own address, on a page that is not there,
// `host`, the space's own host, said before the app's path on a page that is
// not about that one space, `errors`, the count of open ones its owner's
// dashboard marks, and `icon`, the picture to wear instead of the app's own,
// for a viewer the app's own would be refused to (a private app, before they
// are in).
//
// The title is the tile's link, stretched over the whole card, so the error
// mark can be a link of its own: to where the dashboard says what broke. `editor`
// asks for one more, to the app's data editor, on a page for who may open it.

import { parse } from '@yaks/query'
import type { ComponentRenderer } from '@yaks/preact'
import { Card } from '@yaks/ui/parts'
import { h } from 'preact'

export let app: ComponentRenderer = {
  view: 'Tile',
  match: parse('.app'),
  Render: ({ e: b, ...ctx }) => {
    let a = b.app as { slug: string; access?: string | null }
    let doc = b.doc as { title?: string } | undefined
    let errors = Number(ctx.errors ?? 0)
    let tag = (text: string) => h('span', { class: 'Apps_Tag' }, text)
    return h(
      Card,
      { as: 'div', class: 'Apps_Item' },
      h('img', {
        src: ctx.icon ?? `${ctx.at ?? ''}/${a.slug}/icon.png`,
        width: 44,
        height: 44,
        alt: '',
      }),
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
      h('span', { class: 'Apps_Path' }, `${ctx.host ?? ''}/${a.slug}`),
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
        ctx.editor
          ? h('a', {
            class: 'Apps_Tag Apps_Tag-link',
            href: `${ctx.at ?? ''}/${a.slug}/_web/data`,
            target: '_blank',
            rel: 'noopener',
          }, 'Edit data')
          : null,
        b.home ? tag('Homepage') : null,
        a.access ? tag(a.access) : null,
        ctx.gallery ? tag(String(ctx.gallery)) : null,
      ),
    )
  },
}
