// The directory as the platform's admin reads it (admin.ts): a person, a
// space or an app, drawn as a row saying what it uses and as a page of its
// own. A row's components say who or what it is; what it uses is counted over
// the whole directory by the page (admin.ts `uses`) and rides as context,
// since a space's apps and a person's budget are other rows. So do the names
// of what it points at: a reference is drawn by name and links to its page.

import { parse } from '@yaks/query'
import type { Child, Context, H, Renderer } from '@yaks/render'
import { day } from '../html.ts'
import { count, dollars, size } from '../meter.ts'

/** What one row uses, as the page counted it. */
export type Uses = {
  /** dollars spent this month, and the budget they come out of */
  spend?: { spent: number; limit?: number }
  /** this month's requests */
  requests?: number
  /** bytes held: databases and files */
  storage?: number
  /** apps held, the trash left out */
  apps?: number
  /** when anything here was last used */
  active?: string | null
  /** nobody's work: every way in is a test account */
  test?: boolean
}

/** Something a row points at, by the name a person reads. */
export type Ref = { eid: string; name: string }

type Comp = Record<string, unknown> | undefined
let str = (v: unknown) => typeof v == 'string' ? v : ''
let num = (v: unknown) => typeof v == 'number' ? v : 0
let uses = (ctx: Context): Uses => (ctx.uses ?? {}) as Uses
let at = (ctx: Context, eid: string) => `${str(ctx.base)}/${eid}`

let spend = (s?: Uses['spend']) =>
  s == null
    ? ''
    : s.limit == null
    ? dollars(s.spent)
    : `${dollars(s.spent)} of ${dollars(s.limit)}`
let when = (iso?: string | null) => iso ? day(iso) : 'never'

let tag = <N>(h: H<N>, text: string, warn = false) =>
  h('span', { class: `Apps_Tag${warn ? ' Apps_Tag-warn' : ''}` }, text)
let tags = <N>(
  h: H<N>,
  b: Record<string, unknown>,
  u: Uses,
  ...more: string[]
) => [
  ...more.filter(Boolean).map((t) => tag(h, t)),
  u.test ? tag(h, 'test') : null,
  b.trashed ? tag(h, 'in the trash', true) : null,
]

// A row: its name, stretched over the row as its link, a line under it, and
// what it uses, each figure under the word for it.
let row = <N>(
  h: H<N>,
  ctx: Context,
  eid: string,
  name: string,
  sub: string,
  marks: Child<N>[],
  figures: [string, string][],
) =>
  h(
    'div',
    { class: 'Directory_Row' },
    h(
      'div',
      { class: 'Directory_Who' },
      h(
        'a',
        { class: 'Directory_Open', href: at(ctx, eid) },
        h('strong', null, name),
      ),
      h('span', { class: 'Directory_Sub' }, sub),
      h('span', { class: 'Apps_Tags' }, ...marks),
    ),
    h(
      'dl',
      { class: 'Directory_Uses' },
      ...figures.map(([key, value]) =>
        h('div', null, h('dt', null, key), h('dd', null, value))
      ),
    ),
  )

let link = <N>(h: H<N>, ctx: Context, r: Ref) =>
  h('a', { href: at(ctx, r.eid) }, r.name)
let refs = <N>(h: H<N>, ctx: Context, all: Ref[]) =>
  all.length
    ? all.flatMap((r, i) => i ? [', ', link(h, ctx, r)] : [link(h, ctx, r)])
    : 'none'

// A page's facts, each a word and what it is; a fact with nothing to say is
// left out rather than said empty.
let facts = <N>(h: H<N>, all: [string, Child<N>][]) =>
  h(
    'dl',
    { class: 'Fields Directory_Facts' },
    ...all.filter(([, v]) => v !== '' && v != null).map(([key, value]) =>
      h('div', null, h('dt', null, key), h('dd', null, value))
    ),
  )

let personOf = (b: Record<string, unknown>) => {
  let email = str((b.email as Comp)?.address)
  return {
    email,
    name: str((b.doc as Comp)?.title) || email.split('@')[0] || 'Someone',
  }
}

let person: Renderer = {
  view: 'Directory.List.Tile',
  match: parse('.person'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let p = personOf(b)
    return row(h, ctx, b.entity.eid, p.name, p.email, tags(h, b, u), [
      ['Spent', spend(u.spend)],
      ['Storage', size(u.storage ?? 0)],
      ['Apps', count(u.apps ?? 0)],
      ['Last active', when(u.active)],
    ])
  },
}

let space: Renderer = {
  view: 'Directory.List.Tile',
  match: parse('.space'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let slug = str((b.space as Comp)?.slug)
    let tier = str((b.plan as Comp)?.tier)
    return row(
      h,
      ctx,
      b.entity.eid,
      slug,
      str(ctx.address),
      tags(h, b, u, tier == 'plus' ? 'Plus' : ''),
      [
        ['Spent', spend(u.spend)],
        ['Storage', size(u.storage ?? 0)],
        ['Apps', count(u.apps ?? 0)],
        ['Last active', when(u.active)],
      ],
    )
  },
}

let app: Renderer = {
  view: 'Directory.List.Tile',
  match: parse('.app'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let a = b.app as Comp
    let slug = str(a?.slug)
    let version = num(a?.version)
    return row(
      h,
      ctx,
      b.entity.eid,
      str((b.doc as Comp)?.title) || slug,
      `${str(ctx.space)}/${slug}`,
      tags(h, b, u, str(a?.access)),
      [
        ['Requests', count(u.requests ?? 0)],
        ['Storage', size(u.storage ?? 0)],
        ['Version', version ? `v${version}` : 'none'],
        ['Last active', when(u.active)],
      ],
    )
  },
}

let stamp = (b: Record<string, unknown>, comp: string) =>
  str((b[comp] as Comp)?.at)

let personPage: Renderer = {
  view: 'Directory.Page',
  match: parse('.person'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let p = personOf(b)
    let signed = b.signed_in as Comp
    return facts(h, [
      ['Email', p.email],
      ['Joined', day(stamp(b, 'created'))],
      [
        'Signed in',
        signed?.at
          ? `${day(str(signed.at))}${signed.via ? ` by ${signed.via}` : ''}`
          : 'never',
      ],
      ['Last active', when(u.active)],
      ['Spent this month', spend(u.spend)],
      ['Storage', size(u.storage ?? 0)],
      ['Apps', count(u.apps ?? 0)],
    ])
  },
}

let spacePage: Renderer = {
  view: 'Directory.Page',
  match: parse('.space'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let plan = b.plan as Comp
    let m = (b.meter as Comp) ?? {}
    let address = str(ctx.address)
    let owners = (ctx.owners ?? []) as Ref[]
    return facts(h, [
      ['Address', h('a', { href: `https://${address}/` }, address)],
      [
        'Plan',
        `${str(plan?.tier) == 'plus' ? 'Plus' : 'Free'}${
          plan?.status ? ` · ${plan.status}` : ''
        }`,
      ],
      ['Owners', refs(h, ctx, owners)],
      ['Made', day(stamp(b, 'created'))],
      ['Last active', when(u.active)],
      ['Spent this month', spend(u.spend)],
      ['Database', size(num(m.bytes))],
      ['Files', size(num(m.files))],
      ['Requests', count(num(m.requests))],
      ['Rows read', count(num(m.rows_read))],
      ['Rows written', count(num(m.rows_written))],
      ['Build seconds', count(num(m.seconds))],
      ['Letters', count(num(m.emails))],
      ['Metered', m.at ? `${str(m.month)}, read ${day(str(m.at))}` : 'never'],
    ])
  },
}

let appPage: Renderer = {
  view: 'Directory.Page',
  match: parse('.app'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let a = b.app as Comp
    let published = b.published as Comp
    let m = (b.meter as Comp) ?? {}
    let address = str(ctx.address)
    let from = ctx.from as Ref | undefined
    let deploys = ctx.deploys as { count: number; at: string } | undefined
    let visits = ctx.visits as number | null | undefined
    return facts(h, [
      ['Address', h('a', { href: `https://${address}/` }, address)],
      ['Space', ctx.home ? link(h, ctx, ctx.home as Ref) : ''],
      ['Access', str(a?.access)],
      ['Version', num(a?.version) ? `v${num(a?.version)}` : 'none'],
      [
        'Deploys',
        deploys
          ? `${count(deploys.count)}${
            deploys.at ? `, the last ${day(deploys.at)}` : ''
          }`
          : '',
      ],
      [
        'Published',
        published?.name
          ? `as ${published.name} v${num(published.version)}`
          : '',
      ],
      ['Installed from', from ? link(h, ctx, from) : ''],
      ['Made', day(stamp(b, 'created'))],
      ['Last active', when(u.active)],
      [
        'Visits, 30 days',
        visits === undefined
          ? ''
          : visits === null
          ? 'not counted here'
          : count(visits),
      ],
      ['Requests', count(num(m.requests))],
      ['Rows read', count(num(m.rows_read))],
      ['Rows written', count(num(m.rows_written))],
      ['Database', size(num(m.bytes))],
      ['Metered', m.at ? `${str(m.month)}, read ${day(str(m.at))}` : 'never'],
    ])
  },
}

export let directory = [person, space, app, personPage, spacePage, appPage]
