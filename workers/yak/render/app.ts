// The app library's Tile, drawn from the kit's card and its parts.
// Gallery wording is page context because its visibility depends on the viewer,
// and so is `at`, the space's own address, on a page that is not there,
// `host`, the space's own host, said before the app's path on a page that is
// not about that one space, `errors`, the count of open ones its owner's
// dashboard marks, and `icon`, the picture to wear instead of the app's own,
// for a viewer the app's own would be refused to (a private app, before they
// are in).
//
// The title opens the app; the error mark links to what broke. `editor`
// asks for one more, to the app's data editor, on a page for who may open it.
// `made` and `deployed` are when it was made and last deployed and by whom,
// said as one muted line with the names `writers` gives (stamps.ts).

import { parse } from '@yaks/query'
import type { ComponentRenderer } from '@yaks/preact'
import { Button, Card, Chip, Chips, State } from '@yaks/ui/parts'
import { h } from 'preact'
import { type Stamp, stamped, type Writers } from '../stamps.ts'

export let app: ComponentRenderer = {
  view: 'Tile',
  match: parse('.app'),
  Render: ({ e: b, ...ctx }) => {
    let a = b.app as { slug: string; access?: string | null }
    let doc = b.doc as { title?: string } | undefined
    let errors = Number(ctx.errors ?? 0)
    let tags = [b.home ? 'Homepage' : null, a.access, ctx.gallery].filter(
      Boolean,
    )
    let names = (ctx.writers ?? new Map()) as Writers
    let stamp = (what: string, s: unknown) =>
      s ? [what, ' ', stamped(h, s as Stamp, names)] : null
    let made = [stamp('Made', ctx.made), stamp('Deployed', ctx.deployed)]
      .filter(Boolean).flatMap((part, i) => i ? [' · ', part] : [part])
    return h(
      Card,
      null,
      h(
        Card.Head,
        null,
        h(Card.Mark, {
          as: 'img',
          src: ctx.icon ?? `${ctx.at ?? ''}/${a.slug}/icon.png?display`,
          width: 24,
          height: 24,
          alt: '',
        }),
        h(
          Card.Title,
          null,
          h('a', {
            href: `${ctx.at ?? ''}/${a.slug}/`,
            target: '_blank',
            rel: 'noopener',
          }, doc?.title || a.slug),
        ),
        errors
          ? h(
            State,
            { mod: 'negative', href: `#fix-${a.slug}` },
            `${errors} ${errors == 1 ? 'error' : 'errors'}`,
          )
          : null,
        ctx.editor
          ? h(
            Card.Actions,
            null,
            h(Button, {
              href: `${ctx.at ?? ''}/${a.slug}/_web/data`,
              target: '_blank',
              rel: 'noopener',
            }, 'Edit data'),
          )
          : null,
      ),
      h(Card.Sub, null, `${ctx.host ?? ''}/${a.slug}`),
      made.length ? h(Card.Sub, null, made) : null,
      tags.length
        ? h(Chips, null, tags.map((t) => h(Chip, null, String(t))))
        : null,
    )
  },
}
