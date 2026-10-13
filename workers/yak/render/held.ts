// A place somebody holds in a space or an app, or is offered and has yet to
// take: a `member` seat, a `grant` on one app, an `invite` to either (the
// dashboard's People page, people.ts). The row says where they stand; who
// they are lives on their own person row, so their name and address ride as
// page context, the way the app Tile's address does.

import { parse } from '@yaks/query'
import type { Child, Context, H, Renderer } from '@yaks/render'
import { day } from '../html.ts'

let who = <N>(h: H<N>, ctx: Context, ...standing: Child<N>[]) =>
  h(
    'div',
    { class: 'People_Who' },
    h('strong', null, String(ctx.name || ctx.email || 'Someone')),
    ctx.email ? h('span', { class: 'People_Email' }, String(ctx.email)) : null,
    h('span', { class: 'People_Role' }, ...standing),
  )

export let seat: Renderer = {
  view: 'Tile',
  match: parse('.member'),
  render: (b, h, ctx) => who(h, ctx, (b.member as { role: string }).role),
}

export let guest: Renderer = {
  view: 'Tile',
  match: parse('.grant'),
  render: (b, h, ctx) => who(h, ctx, (b.grant as { access: string }).access),
}

export let invitation: Renderer = {
  view: 'Tile',
  match: parse('.invite'),
  render: (b, h, ctx) => {
    let i = b.invite as { role: string; sent?: string | null }
    return who(
      h,
      ctx,
      `${i.role} · `,
      h(
        'span',
        { class: 'People_Waiting' },
        i.sent ? `invited ${day(i.sent)}, ` : 'invited, ',
        'not accepted yet',
      ),
    )
  },
}
