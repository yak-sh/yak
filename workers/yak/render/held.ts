// A place somebody holds in a space or an app, or is offered and has yet to
// take: a `member` seat, a `grant` on one app, an `invite` to either (the
// dashboard's People page, people.ts). The row says where they stand; who
// they are lives on their own person row, so their name and address ride as
// page context, the way the app Tile's address does.

import { parse } from '@yaks/query'
import type { ComponentRenderer } from '@yaks/preact'
import type { Context } from '@yaks/render'
import { Rows } from '@yaks/ui/parts'
import { type ComponentChildren, h } from 'preact'
import { Time } from '@yaks/ui/parts'

// A row's main part: the name, then one line of where they stand, their
// address first.
let who = (ctx: Context, ...standing: ComponentChildren[]) =>
  h(
    Rows.Main,
    null,
    h(Rows.Name, null, String(ctx.name || ctx.email || 'Someone')),
    h(Rows.Meta, null, ctx.email ? `${ctx.email} · ` : null, ...standing),
  )

export let seat: ComponentRenderer = {
  view: 'Tile',
  match: parse('.member'),
  Render: ({ e, ...ctx }) => who(ctx, (e.member as { role: string }).role),
}

export let guest: ComponentRenderer = {
  view: 'Tile',
  match: parse('.grant'),
  Render: ({ e, ...ctx }) => who(ctx, (e.grant as { access: string }).access),
}

export let invitation: ComponentRenderer = {
  view: 'Tile',
  match: parse('.invite'),
  Render: ({ e, ...ctx }) => {
    let i = e.invite as { role: string; sent?: string | null }
    return who(
      ctx,
      `${i.role} · `,
      h(
        'span',
        { class: 'People_Waiting' },
        i.sent ? ['invited ', h(Time, { at: i.sent }), ', '] : 'invited, ',
        'not accepted yet',
      ),
    )
  },
}
